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

const START_Z = 11
// The scene loops by tiling two copies of the splat LOOP_PERIOD apart (the rig
// rides one period, then snaps back). The two tiles sit LOOP_PERIOD/OUTER_SCALE
// apart in the splat's own local units, so the join is seamless only when that
// separation ≈ the splat's solid content span along the street (~8.2 local units
// for the current render). Too large leaves a gap between blocks; too small
// overlaps them and the next block's trees punch through this block's houses.
// 43.24 suited the older splat (its hazy distance reached further and hid the
// overlap); the cleaner render has hard edges, so the tiles must just meet.
const LOOP_PERIOD = 41
const TARGET_Z = START_Z - LOOP_PERIOD
const OUTER_SCALE = 5
// Inner gsplat is a child of the outer one; its local Z controls how far apart
// the two tiles sit in world space (multiplied by the outer's scale).
const INNER_LOCAL_Z = -LOOP_PERIOD / OUTER_SCALE

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
const BIKE_SCALE = 1.1
const BIKE_EULER: [number, number, number] = [0, 0, 0]
// Vertical lift off the road, tuned visually so the bike sits in frame.
const BIKE_Y = 0.15
// Material name (from bike.glb) of the e-bike's dashboard display. The texture is
// a near-white nav-map screenshot, so the screen is rendered unlit (see
// brightenBikeScreen) with the texture driven purely through emissive at BELOW 1
// — that keeps the bright map at a legible light-grey instead of letting ACES
// tonemapping clip it to a blown-out white panel. Lower = more detail/contrast,
// higher = brighter but washes out. Tuned visually.
const BIKE_SCREEN_MATERIAL = 'Screen'
const BIKE_SCREEN_EMISSIVE = 0.6

// The traffic light spans the road (the model is already mirrored across both
// sides). TRAFFIC_LIGHT_Z is the single "down the road" knob — an absolute world
// Z, deliberately decoupled from LOOP_PERIOD so re-tuning the loop length doesn't
// drag the light along with it. The bike's stop line is derived from it. X is a
// lateral nudge (0 = centred). X/Y/scale/rotation are tuned visually.
const TRAFFIC_LIGHT_ASSET_NAME = 'trafficlight.glb'
const TRAFFIC_LIGHT_Z = -21.86
const TRAFFIC_LIGHT_X = 1.0
const TRAFFIC_LIGHT_Y = 0.05
const TRAFFIC_LIGHT_SCALE = 0.35
const TRAFFIC_LIGHT_EULER: [number, number, number] = [0, 0, 0]
// The bike stops this far ahead of (i.e. +Z of) the lights, eases off over
// SLOWDOWN units, and idles at the stop line for WAIT seconds each lap.
const TRAFFIC_LIGHT_STOP_OFFSET = 1.5
const TRAFFIC_LIGHT_SLOWDOWN = 2.5
const TRAFFIC_LIGHT_WAIT = 3

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
    e.gsplat.unified = true
    // Cheaper Z-axis SH approximation. Edge gaussians lose some view-dependent
    // shading; usually unnoticeable, big GPU win on mobile.
    e.gsplat.highQualitySH = false
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
  const cullThreshold = LOOP_PERIOD * 0.9
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
      speed: CYCLE_FORWARD_BASE_SPEED,
      startZ: START_Z,
      targetZ: TARGET_Z,
      loop: true,
      stopZ: TRAFFIC_LIGHT_Z + TRAFFIC_LIGHT_STOP_OFFSET,
      slowDownDistance: TRAFFIC_LIGHT_SLOWDOWN,
      waitDuration: TRAFFIC_LIGHT_WAIT,
    },
  })
}

// Plants the overhead traffic light beside the road at the configured Z, parented
// to the world root (static) — the looping rig passes it once per lap — then wires
// its bulbs to the bike.
function setupTrafficLight(app: pc.AppBase) {
  const light = instantiateContainer(app, TRAFFIC_LIGHT_ASSET_NAME)
  if (!light) return
  light.setLocalPosition(TRAFFIC_LIGHT_X, TRAFFIC_LIGHT_Y, TRAFFIC_LIGHT_Z)
  light.setLocalEulerAngles(...TRAFFIC_LIGHT_EULER)
  light.setLocalScale(
    TRAFFIC_LIGHT_SCALE,
    TRAFFIC_LIGHT_SCALE,
    TRAFFIC_LIGHT_SCALE,
  )
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
  const red = light.findByName('red')
  const green = light.findByName('green')
  const yellow = light.findByName('yellow')
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
  registerCycleForward(app)

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
