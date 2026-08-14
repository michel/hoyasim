import * as pc from 'playcanvas'
import {
  type GlassesController,
  type LensProduct,
  type LensSide,
  setupLenses,
} from './glasses-pc'
import { setupImpairedVision } from './impaired-vision'
import { renderComponents } from './pc-utils'
import {
  CYCLE_FORWARD_BASE_SPEED,
  type LanePath,
  registerCycleForward,
} from './scripts/cycleForward'
import { type LookState, registerLookCamera } from './scripts/lookCamera'

const PROJECT_PREFIX = `${import.meta.env.BASE_URL}playcanvas/`
const CONFIG_FILENAME = `${PROJECT_PREFIX}config.json`
const SCENE_PATH = `${PROJECT_PREFIX}2483428.json`

// Mobile GPUs scale quadratically with pixel count; gsplat fill is the bottleneck.
// Touch devices render below CSS pixels and rely on browser upscaling; the
// lens already softens half the screen so the loss is hard to spot.
const MAX_PIXEL_RATIO_TOUCH = 0.5
const MAX_PIXEL_RATIO_DESKTOP = 1.5

// World magnification of the splat tiles (applied to the outer tile in
// setupScene, overriding the scene JSON's baked 5). Raised from 5 to 6 so the
// environment reads larger around the fixed-size bike/camera — the bike then
// sits in proper proportion instead of dwarfing the street. Every world-space
// constant below derives from it; the rig speed is scaled to match so the
// perceived riding pace is unchanged.
const OUTER_SCALE = 6.6
// The lap window spans exactly the cropped bundle's street (local z
// [-1.85, 3.25]): start at the north crop plane (OUTER_SCALE*3.25 - 11.64) and
// wrap at the south one — the wrap lands on the identical spot in the next
// tile copy, so the seams are only ever crossed at the moment of the snap.
const START_Z = 8.1
// The scene loops by tiling two copies of the splat LOOP_PERIOD apart (the rig
// rides one period, then snaps back). The two tiles sit LOOP_PERIOD/OUTER_SCALE
// apart in the splat's own local units. Since the 90-deg scene rotation the
// ride follows the capture's cross street, cropped to 5.10 local units with
// a 0.25-unit opacity feather at each end (see CROP_BOX/FADE in
// build-splat.sh) — the separation is (span - fade) * OUTER_SCALE so the two
// copies' feathered ends overlap in a crossfade instead of a visible seam.
const LOOP_PERIOD = 32.0
const TARGET_Z = START_Z - LOOP_PERIOD
// Inner gsplat is a child of the outer one; its local Z controls how far apart
// the two tiles sit in world space (multiplied by the outer's scale).
const INNER_LOCAL_Z = -LOOP_PERIOD / OUTER_SCALE
// World-space Y nudge applied to the outer tile (the inner tile rides along as its
// child, and the camera isn't parented to it). Lowers the whole environment so the
// bike sits on the road instead of clipping into it — make it more negative to drop
// the ground further, less to raise it.
const SPLAY_Z_OFFSET = -0.1

// Distance fog blends the far end of the splat into the sky, so the street's hard
// far edge — and LOD chunks streaming in — fade in instead of popping. The colour
// matches the horizon haze; START/END are world-space camera distances tuned so
// the near block stays crisp and the pop zone is fully dissolved by END.
const FOG_COLOR: [number, number, number] = [0.74, 0.83, 0.92]
const FOG_START = 9
const FOG_END = 30

// GUIDs and names baked into the PlayCanvas scene JSON.
const OUTER_SPLAT_GUID = '1b585588-7432-4d27-a6a1-fdffaa61fcec'
const INNER_SPLAT_GUID = '18cfe02a-5fc4-43a7-b9c6-f55bca10a8f1'
const BIKE_ENTITY_NAME = 'Render'
const RIG_ENTITY_NAME = 'waa'
const CAMERA_ENTITY_NAME = 'Camera'

// Container asset name (config.json) and the bike's local transform under the rig.
// Scale/rotation are tuned visually against the scene, not derived from the GLB.
const BIKE_ASSET_NAME = 'bike.glb'
// Tuned visually; don't go below ~1.45 — high-contrast cockpit detail that low
// in the lens's reading zone scatters into ghost copies under the soft blur.
const BIKE_SCALE = 1.2
const BIKE_EULER: [number, number, number] = [0, 0, 0]
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
const TRAFFIC_LIGHT_Z = -5.5
const TRAFFIC_LIGHT_X = 1.3
const TRAFFIC_LIGHT_Y = 0.0
const TRAFFIC_LIGHT_SCALE = 0.3
const TRAFFIC_LIGHT_EULER: [number, number, number] = [0, 0, 0]
// The bike stops this far ahead of (i.e. +Z of) the lights, eases off over
// SLOWDOWN units, and idles at the stop line for WAIT seconds each lap.
const TRAFFIC_LIGHT_STOP_OFFSET = 2.0
const TRAFFIC_LIGHT_SLOWDOWN = 3.3
const TRAFFIC_LIGHT_WAIT = 3

// The street's measured centerline wander (red-brick-path lane-follower over
// the cropped span), smoothed with a PERIODIC kernel around the whole loop so
// only the street's macro curve survives — sample noise read as weaving — and
// the first/last entries (one loop period apart) stay continuous for a
// seamless wrap. Zero-mean, so the tuned riding line is preserved on average.
// Re-derive when the bundle's lateral placement (SCENE_SHIFT/SCENE_YAW) or
// OUTER_SCALE changes.
const LANE_PATH: LanePath = [
  [8.1, 0.065],
  [6.5, 0.146],
  [4.9, 0.158],
  [3.3, 0.094],
  [1.7, 0.04],
  [0.1, 0.018],
  [-1.5, 0.024],
  [-3.1, 0.062],
  [-4.7, 0.095],
  [-6.3, 0.09],
  [-7.9, 0.047],
  [-9.5, -0.005],
  [-11.1, -0.045],
  [-12.7, -0.08],
  [-14.3, -0.111],
  [-15.9, -0.143],
  [-17.5, -0.178],
  [-19.1, -0.188],
  [-20.7, -0.122],
  [-22.3, -0.032],
  [-23.9, 0.065],
]

pc.dracoInitialize({
  jsUrl:
    'https://www.gstatic.com/draco/versioned/decoders/1.5.7/draco_wasm_wrapper.js',
  wasmUrl:
    'https://www.gstatic.com/draco/versioned/decoders/1.5.7/draco_decoder.wasm',
})

export interface BootedApp {
  app: pc.AppBase
  dispose: () => void
  putOnGlasses: () => Promise<void>
  takeOffGlasses: () => void
  setLensProduct: (side: LensSide, product: LensProduct) => void
}

// Wires the component systems, resource handlers, and input devices onto a fresh
// AppBase. AppBase (unlike pc.Application) wires none of these automatically.
function createApp(
  canvas: HTMLCanvasElement,
  device: pc.GraphicsDevice,
): pc.AppBase {
  const app = new pc.AppBase(canvas)
  const createOptions = new pc.AppOptions()
  createOptions.graphicsDevice = device

  createOptions.componentSystems = [
    pc.RenderComponentSystem,
    pc.CameraComponentSystem,
    pc.ScriptComponentSystem,
    pc.GSplatComponentSystem,
  ]

  createOptions.resourceHandlers = [
    pc.RenderHandler,
    pc.MaterialHandler,
    pc.TextureHandler,
    pc.JsonHandler,
    pc.ScriptHandler,
    pc.SceneHandler,
    pc.CubemapHandler,
    pc.HierarchyHandler,
    pc.ContainerHandler,
    pc.GSplatHandler,
  ]

  createOptions.elementInput = new pc.ElementInput(canvas, {
    useMouse: true,
    useTouch: true,
  })
  createOptions.keyboard = new pc.Keyboard(window)
  createOptions.mouse = new pc.Mouse(canvas)
  if (pc.platform.touch) createOptions.touch = new pc.TouchDevice(canvas)

  createOptions.assetPrefix = PROJECT_PREFIX
  createOptions.scriptPrefix = PROJECT_PREFIX
  createOptions.scriptsOrder = []
  // RenderComponentSystem asserts that a BatchManager exists. AppBase doesn't
  // wire one automatically (pc.Application does), so do it here to silence the
  // assert. We don't actually use batching.
  createOptions.batchManager = pc.BatchManager

  app.init(createOptions)
  return app
}

// Adapts PlayCanvas' node-style callbacks (configure/preload/loadScene) to a
// promise, mapping a truthy err to a rejection.
const asPromise = (run: (done: (err?: unknown) => void) => void) =>
  new Promise<void>((resolve, reject) =>
    run((err) => (err ? reject(new Error(String(err))) : resolve())),
  )

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

// Linear distance fog, applied scene-wide (the gsplat shader honours scene fog in
// pc 2.19+). Fades distant geometry into the horizon so far content dissolves in
// rather than popping at the splat's hard edge.
function setupFog(app: pc.AppBase) {
  app.scene.fog.type = pc.FOG_LINEAR
  app.scene.fog.color.set(...FOG_COLOR)
  app.scene.fog.start = FOG_START
  app.scene.fog.end = FOG_END
}

// The gsplat bakes lighting; dynamic shadows add cost without visible benefit.
// Strip shadow flags from every render component and light before the first frame.
function stripShadows(app: pc.AppBase) {
  for (const r of renderComponents(app.root)) {
    r.castShadows = false
    r.receiveShadows = false
  }
  for (const l of app.root.findComponents('light') as pc.LightComponent[]) {
    l.castShadows = false
  }
}

// Globally LOD-balance both tiles to stay under a target splat count, then tune
// streaming so the looping camera doesn't accumulate GPU memory over time.
function configureGsplat(app: pc.AppBase, tiles: pc.Entity[]) {
  // Mobile is fill-bound, so it gets a tighter budget than desktop. iOS gets
  // the tightest because thermal throttling kicks in after a couple of loop
  // cycles — less per-frame GPU work = slower heat buildup = stable FPS longer.
  app.scene.gsplat.splatBudget = pc.platform.ios
    ? 200_000
    : pc.platform.touch
      ? 500_000
      : 4_000_000
  // Mobile clamps to LOD 2/3. iOS Safari additionally pins to a single LOD
  // because Metal's WebGL texture allocator doesn't reclaim freed chunks
  // promptly — repeated load/evict cycles compound into FPS drift over time on
  // iPhone (not reproducible in desktop Chrome). Pinning to LOD 3 means the same
  // 3 chunk files are uploaded once and never churned, killing memory pressure.
  if (pc.platform.ios) {
    app.scene.gsplat.lodRangeMin = 3
    app.scene.gsplat.lodRangeMax = 3
  } else if (pc.platform.touch) {
    app.scene.gsplat.lodRangeMin = 2
  }
  // LOD streaming tuning:
  //   - underfill: draw a coarser cached LOD while the desired tier streams in.
  //   - cooldownTicks ~2s: evict off-screen chunks aggressively so panning
  //     doesn't accumulate GPU memory. Higher values caused steady FPS decay.
  //   - behindPenalty: trailing-tile chunks coarsen pre-emptively so the
  //     post-wrap LOD upgrade jump is smaller.
  //   - lodUpdateDistance: re-evaluate LOD only every 3m of camera motion.
  //   - radialSorting: cheaper sort that stays stable as the camera rotates in
  //     place (exactly what mobile head-look does).
  app.scene.gsplat.lodUnderfillLimit = 2
  app.scene.gsplat.cooldownTicks = 120
  app.scene.gsplat.lodBehindPenalty = 3
  app.scene.gsplat.lodUpdateDistance = 3
  app.scene.gsplat.radialSorting = true
  for (const e of tiles) {
    if (!e.gsplat) continue
    // Unified rendering is the default (and only) mode since pc 2.21, and the
    // bundle ships 0 SH bands, so no per-entity SH tuning is needed anymore.
    // Drop quality faster with distance — the trailing tile is usually far from
    // the camera as it loops around behind. Touch gets a steeper falloff.
    e.gsplat.lodBaseDistance = pc.platform.touch ? 0.5 : 1
    e.gsplat.lodMultiplier = pc.platform.touch ? 2 : 1.5
  }
}

// Per-frame gsplat culling. Each gsplat's sort is GPU-expensive even when its
// rasterized output is fully clipped. When a tile drifts beyond one full loop
// period from the camera, disable the entity so the sort is skipped entirely.
function setupTileCulling(app: pc.AppBase, cam: pc.Entity, tiles: pc.Entity[]) {
  // Threshold = the tile's north content extent from its origin
  // (OUTER_SCALE * 3.25 ≈ 19.5 world units) plus ~13 units of headroom, so a
  // tile re-enables while its nearest content is still distant enough for fog
  // to soften the stream-in. Deliberately NOT derived from LOOP_PERIOD — the
  // loop length tracks the rideable street, while this tracks the capture's
  // extent.
  const cullThreshold = 34.5
  app.on('update', () => {
    const camZ = cam.getPosition().z
    for (const tile of tiles)
      tile.enabled = Math.abs(tile.getPosition().z - camZ) < cullThreshold
  })
}

// Attaches the looping forward-cycle script to the rig captured from the scene.
function setupRig(app: pc.AppBase) {
  const rig = app.root.findByName(RIG_ENTITY_NAME)
  if (!(rig instanceof pc.Entity)) return
  rig.addComponent('script')
  rig.script?.create('cycleForward', {
    attributes: {
      // World-units/sec, scaled with the world magnification (the scene JSON
      // and the base speed were tuned at OUTER_SCALE 5) so the perceived
      // riding pace stays the same when the world grows.
      speed: (CYCLE_FORWARD_BASE_SPEED * OUTER_SCALE) / 5,
      startZ: START_Z,
      targetZ: TARGET_Z,
      loop: true,
      stopZ: TRAFFIC_LIGHT_Z + TRAFFIC_LIGHT_STOP_OFFSET,
      slowDownDistance: TRAFFIC_LIGHT_SLOWDOWN,
      waitDuration: TRAFFIC_LIGHT_WAIT,
    },
  })
}

// Plants the overhead traffic lights beside the road at the configured Z (parented
// to the world root — static, so the looping rig passes them once per lap): the
// left-hand GLB plus a right-hand mirror across the road centreline. A second
// pair stands one loop period further down, on the trailing tile's copy of the
// crossroads: right after the wrap the nearest pair sits at exactly the same
// relative distance as the far pair did just before it, so the lights loop as
// seamlessly as the splat does (with one pair they pop in at the snap).
function setupTrafficLight(app: pc.AppBase) {
  for (const dz of [0, -LOOP_PERIOD]) {
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
  light.setLocalPosition(x, TRAFFIC_LIGHT_Y, TRAFFIC_LIGHT_Z + dz)
  light.setLocalEulerAngles(...TRAFFIC_LIGHT_EULER)
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
// Renders the e-bike's dashboard screen as a clear, self-lit display. The GLB
// already wires the screen's texture as an emissive map but with a black
// emissive factor. Driving the texture purely through emissive AND disabling
// lighting avoids the double-exposure (lit diffuse + emissive) that otherwise
// pushes the graphic past ACES tonemapping into a blown-out white panel.
function brightenBikeScreen(model: pc.Entity) {
  for (const r of renderComponents(model)) {
    for (const mi of r.meshInstances) {
      const m = mi.material
      if (!(m instanceof pc.StandardMaterial)) continue
      if (m.name !== BIKE_SCREEN_MATERIAL) continue
      if (!m.emissiveMap) m.emissiveMap = m.diffuseMap
      m.useLighting = false
      m.emissive.set(1, 1, 1)
      m.emissiveIntensity = BIKE_SCREEN_EMISSIVE
      m.update()
    }
  }
}

// Swaps the baked grey single-mesh render on the "Render" anchor for the full
// textured GLB hierarchy, so every mesh and material from the container shows.
function setupBike(app: pc.AppBase) {
  const anchor = app.root.findByName(BIKE_ENTITY_NAME)
  if (!(anchor instanceof pc.Entity)) return
  if (anchor.render) anchor.removeComponent('render')
  const model = instantiateContainer(app, BIKE_ASSET_NAME)
  if (model) {
    brightenBikeScreen(model)
    anchor.addChild(model)
  }
  anchor.setLocalPosition(0, BIKE_Y, 0)
  anchor.setLocalEulerAngles(...BIKE_EULER)
  anchor.setLocalScale(BIKE_SCALE, BIKE_SCALE, BIKE_SCALE)
}

// Post-load scene wiring: tunes entities baked into the scene JSON and starts
// the impaired-vision overlay. Returns the camera entity the lenses attach to
// (null when the camera is missing).
function setupScene(app: pc.AppBase): pc.Entity | null {
  setupBike(app)
  setupTrafficLight(app)

  stripShadows(app)
  setupFog(app)

  const innerSplat = app.root.findByGuid(INNER_SPLAT_GUID)
  if (innerSplat instanceof pc.Entity) {
    const p = innerSplat.getLocalPosition()
    innerSplat.setLocalPosition(p.x, p.y, INNER_LOCAL_Z)
  }

  const outerSplat = app.root.findByGuid(OUTER_SPLAT_GUID)
  if (outerSplat instanceof pc.Entity) {
    const p = outerSplat.getLocalPosition()
    outerSplat.setLocalPosition(p.x, p.y, p.z + SPLAY_Z_OFFSET)
    // The scene JSON bakes scale 5; OUTER_SCALE is authoritative (see its doc).
    outerSplat.setLocalScale(OUTER_SCALE, OUTER_SCALE, OUTER_SCALE)
  }
  const tiles = [outerSplat, innerSplat].filter(
    (e): e is pc.Entity => e instanceof pc.Entity,
  )
  configureGsplat(app, tiles)

  setupRig(app)

  const cam = app.root.findByName(CAMERA_ENTITY_NAME)
  const cameraEntity = cam instanceof pc.Entity ? cam : null
  if (cameraEntity) setupImpairedVision(app, cameraEntity)

  if (cameraEntity && tiles.length > 0)
    setupTileCulling(app, cameraEntity, tiles)

  return cameraEntity
}

export async function bootApp(
  canvas: HTMLCanvasElement,
  lookState: LookState,
): Promise<BootedApp> {
  const device = await pc.createGraphicsDevice(canvas, {
    deviceTypes: ['webgl2', 'webgl1'],
    powerPreference: 'high-performance',
    antialias: false,
  })

  const app = createApp(canvas, device)

  const maxPixelRatio = pc.platform.touch
    ? MAX_PIXEL_RATIO_TOUCH
    : MAX_PIXEL_RATIO_DESKTOP
  device.maxPixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio)

  registerLookCamera(app, lookState)
  registerCycleForward(app, LANE_PATH)

  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW)
  app.setCanvasResolution(pc.RESOLUTION_AUTO)

  // Captured once the scene has loaded so putOnGlasses can lazily run
  // setupLenses after the user clicks the in-scene button.
  let putOnGlassesPromise: Promise<void> | null = null
  let glasses: GlassesController | null = null

  const onResize = () => app.resizeCanvas()
  window.addEventListener('resize', onResize)

  await asPromise((done) => app.configure(CONFIG_FILENAME, done))
  await asPromise((done) => app.preload(() => done()))
  await asPromise((done) => app.scenes.loadScene(SCENE_PATH, done))
  app.start()
  const cameraEntity = setupScene(app)

  return {
    app,
    dispose: () => {
      window.removeEventListener('resize', onResize)
      app.destroy()
    },
    putOnGlasses: () => {
      if (!cameraEntity) return Promise.resolve()
      if (putOnGlassesPromise) return putOnGlassesPromise
      putOnGlassesPromise = setupLenses(app, cameraEntity)
        .then((g) => {
          glasses = g
          return g.playPutOnAnimation()
        })
        .catch((err: unknown) => {
          console.error('Lens setup failed:', err)
          putOnGlassesPromise = null
        })
      return putOnGlassesPromise
    },
    takeOffGlasses: () => {
      glasses?.destroy()
      glasses = null
      putOnGlassesPromise = null
    },
    setLensProduct: (side, product) => {
      glasses?.setLensProduct(side, product)
    },
  }
}
