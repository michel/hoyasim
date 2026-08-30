import * as pc from 'playcanvas'
import { createNavScreenTexture } from './nav-screen'
import { renderComponents } from './pc-utils'

// The props baked into (or planted onto) the PlayCanvas scene: the e-bike the
// camera rides and the traffic lights it stops at. Split from playcanvasApp so
// the boot/loop core stays readable; all placement values are hand-tuned
// against the current splat bundle.

// Entity names baked into the PlayCanvas scene JSON.
export const BIKE_ENTITY_NAME = 'Render'
export const RIG_ENTITY_NAME = 'waa'

// Container asset name (config.json) and the bike's local transform under the rig.
// Scale/rotation are tuned visually against the scene, not derived from the GLB.
const BIKE_ASSET_NAME = 'bike.glb'
// Tuned visually; don't go below ~1.45 — high-contrast cockpit detail that low
// in the lens's reading zone scatters into ghost copies under the soft blur.
const BIKE_SCALE = 1.05
// Vertical lift off the road, tuned visually so the bike sits in frame. Raises
// the cockpit out of the v03 capture's brick road (at 0 the model sat sunk to
// the handlebars); a full geometric wheel-seat (+0.29) shoves the bar into the
// camera, so this stays a framing knob, not a physics one.
const BIKE_Y = 0.12
// Material name (from bike.glb) of the e-bike's dashboard display. The texture is
// a near-white nav-map screenshot, so the screen is rendered unlit (see
// brightenBikeScreen) with the texture driven purely through emissive at BELOW 1
// — that keeps the bright map at a legible light-grey instead of letting ACES
// tonemapping clip it to a blown-out white panel. Lower = more detail/contrast,
// higher = brighter but washes out. Tuned visually.
const BIKE_SCREEN_MATERIAL = 'Screen'
const BIKE_SCREEN_EMISSIVE = 0.6

// The GLB models the left-hand traffic light; setupTrafficLight plants it plus a
// mirrored right-hand copy so the pair spans the road. TRAFFIC_LIGHT_Z is the single
// "down the road" knob — an absolute world Z, deliberately decoupled from LOOP_PERIOD
// so re-tuning the loop length doesn't drag the lights along with it. The bike's stop
// line is derived from it. X is the left light's lateral offset (0 = centred on the
// road); the right light mirrors it at -X. X/Y/scale/rotation are tuned visually.
const TRAFFIC_LIGHT_ASSET_NAME = 'trafficlight.glb'
// A mid-block crossing stop ~37% through the lap (moved 20% of the loop
// earlier from the crossroads at the user's request), leaving a long cruise
// after the green before the wrap.
const TRAFFIC_LIGHT_Z = -4.9
const TRAFFIC_LIGHT_X = 1.4
const TRAFFIC_LIGHT_SCALE = 0.33
// The bike stops this far ahead of (i.e. +Z of) the lights, eases off over
// SLOWDOWN units, and idles at the stop line for WAIT seconds each lap.
const TRAFFIC_LIGHT_STOP_OFFSET = 2.0
const TRAFFIC_LIGHT_SLOWDOWN = 3.3
const TRAFFIC_LIGHT_WAIT = 3

// Looks up a preloaded container asset (config.json) and instantiates its
// render hierarchy, or null when the asset is missing.
function instantiateContainer(
  app: pc.AppBase,
  assetName: string,
): pc.Entity | null {
  const resource = app.assets.find(assetName, 'container')?.resource as
    | pc.ContainerResource
    | undefined
  return resource?.instantiateRenderEntity() ?? null
}

// Plants the overhead traffic lights beside the road at the configured Z (parented
// to the world root — static, so the looping rig passes them once per lap): the
// left-hand GLB plus a right-hand mirror across the road centreline. A second
// pair stands one loop period further down, on the trailing tile's copy of the
// crossroads: right after the wrap the nearest pair sits at exactly the same
// relative distance as the far pair did just before it, so the lights loop as
// seamlessly as the splat does (with one pair they pop in at the snap).
export function setupTrafficLight(app: pc.AppBase, loopPeriod: number) {
  for (const dz of [0, -loopPeriod]) {
    plantTrafficLight(app, TRAFFIC_LIGHT_X, TRAFFIC_LIGHT_SCALE, dz)
    plantTrafficLight(app, -TRAFFIC_LIGHT_X, -TRAFFIC_LIGHT_SCALE, dz)
  }
}

// Instantiates one traffic-light container at lateral offset x, parents it to the
// world root, and drives its bulbs from the bike. A negative scaleX mirrors the model
// across the road centreline (X=0); paired with the negated x position that is an
// exact reflection, so the right light's arm still reaches over the road and its faces
// stay toward the oncoming bike (a 180° spin would face them away instead).
function plantTrafficLight(app: pc.AppBase, x: number, scaleX: number, dz = 0) {
  const light = instantiateContainer(app, TRAFFIC_LIGHT_ASSET_NAME)
  if (!light) return
  light.setLocalPosition(x, 0, TRAFFIC_LIGHT_Z + dz)
  light.setLocalScale(scaleX, TRAFFIC_LIGHT_SCALE, TRAFFIC_LIGHT_SCALE)
  app.root.addChild(light)
  setupTrafficLightCycle(app, light)
}

// The model ships three coloured bulbs (named green/red/yellow) that rest hidden
// at scale 0. Rather than free-run the baked clips, drive them from the bike so
// the signal actually matches its stop-and-go: green while riding, amber on the
// approach, red while idling at the stop line — the red → green → amber cycle the
// model was authored for, in sync with the lap.
function setupTrafficLightCycle(app: pc.AppBase, light: pc.Entity) {
  const rig = app.root.findByName(RIG_ENTITY_NAME)
  if (!(rig instanceof pc.Entity)) return
  // Bulb nodes by colour; the v02 model suffixes them ("red.001"), so match on
  // the base name rather than exactly.
  const bulb = (color: string) =>
    light.find((n) => n.name === color || n.name.startsWith(`${color}.`))[0] ??
    null
  const red = bulb('red')
  const green = bulb('green')
  const yellow = bulb('yellow')
  const stopZ = TRAFFIC_LIGHT_Z + TRAFFIC_LIGHT_STOP_OFFSET
  let prevZ = rig.getLocalPosition().z
  const setBulb = (b: pc.GraphNode | null, on: boolean) =>
    b?.setLocalScale(on ? 1 : 0, on ? 1 : 0, on ? 1 : 0)
  app.on('update', () => {
    const z = rig.getLocalPosition().z
    const moving = Math.abs(z - prevZ) > 1e-4
    prevZ = z
    const dist = z - stopZ
    const stopped = !moving && Math.abs(dist) < 0.5
    const approaching = moving && dist > 0 && dist <= TRAFFIC_LIGHT_SLOWDOWN
    setBulb(red, stopped)
    setBulb(yellow, approaching)
    setBulb(green, !stopped && !approaching)
  })
}

// Brightens the bike's textures by re-using each material's albedo map as an
// additive emissive source. Only StandardMaterials carrying a colour map are
// touched, and any material already driving its own emissive map is left alone.
// Renders the e-bike's dashboard screen as a clear, self-lit display showing
// the generated navigation screen (big type — the demo is about reading it
// through the lens). Driving the texture purely through emissive AND disabling
// lighting avoids the double-exposure (lit diffuse + emissive) that otherwise
// pushes the graphic past ACES tonemapping into a blown-out white panel.
function brightenBikeScreen(model: pc.Entity, device: pc.GraphicsDevice) {
  const screen = createNavScreenTexture(device)
  for (const r of renderComponents(model)) {
    for (const mi of r.meshInstances) {
      const m = mi.material
      if (!(m instanceof pc.StandardMaterial)) continue
      if (m.name !== BIKE_SCREEN_MATERIAL) continue
      if (screen) m.diffuseMap = screen
      m.emissiveMap = m.diffuseMap
      m.useLighting = false
      m.emissive.set(1, 1, 1)
      m.emissiveIntensity = BIKE_SCREEN_EMISSIVE
      m.update()
    }
  }
}

// Swaps the baked grey single-mesh render on the "Render" anchor for the full
// textured GLB hierarchy, so every mesh and material from the container shows.
export function setupBike(app: pc.AppBase) {
  const anchor = app.root.findByName(BIKE_ENTITY_NAME)
  if (!(anchor instanceof pc.Entity)) return
  if (anchor.render) anchor.removeComponent('render')
  const model = instantiateContainer(app, BIKE_ASSET_NAME)
  if (model) {
    brightenBikeScreen(model, app.graphicsDevice)
    anchor.addChild(model)
  }
  anchor.setLocalPosition(0, BIKE_Y, 0)
  // NOT a no-op knob: the scene JSON bakes rotation [177, 0, 180] on this
  // anchor — without this reset the bike renders turned around and tilted.
  anchor.setLocalEulerAngles(0, 0, 0)
  anchor.setLocalScale(BIKE_SCALE, BIKE_SCALE, BIKE_SCALE)
}

// The bike's stop line and approach envelope, consumed by the rig's forward
// script so the ride and the lights agree on where "stopped at the light" is.
export const TRAFFIC_LIGHT_STOP_Z = TRAFFIC_LIGHT_Z + TRAFFIC_LIGHT_STOP_OFFSET
export { TRAFFIC_LIGHT_SLOWDOWN, TRAFFIC_LIGHT_WAIT }
