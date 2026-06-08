import * as pc from 'playcanvas'
import {
  type GlassesController,
  type LensProduct,
  type LensSide,
  setupLenses,
} from './glasses-pc'
import { setupImpairedVision } from './impaired-vision'
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
const LOOP_PERIOD = 43.24
const TARGET_Z = START_Z - LOOP_PERIOD
const OUTER_SCALE = 5
// Inner gsplat is a child of the outer one; its local Z controls how far apart
// the two tiles sit in world space (multiplied by the outer's scale).
const INNER_LOCAL_Z = -LOOP_PERIOD / OUTER_SCALE

// GUIDs and names baked into the PlayCanvas scene JSON.
const OUTER_SPLAT_GUID = '1b585588-7432-4d27-a6a1-fdffaa61fcec'
const INNER_SPLAT_GUID = '18cfe02a-5fc4-43a7-b9c6-f55bca10a8f1'
const BIKE_ENTITY_NAME = 'Render'
const RIG_ENTITY_NAME = 'waa'
const CAMERA_ENTITY_NAME = 'Camera'

// Container asset name (config.json) and the bike's local transform under the rig.
// Scale/rotation are tuned visually against the scene, not derived from the GLB.
const BIKE_ASSET_NAME = 'bike.glb'
const BIKE_SCALE = 1
const BIKE_EULER: [number, number, number] = [0, 0, 0]

// The traffic light spans the road (the model is already mirrored across both
// sides). TRAFFIC_LIGHT_Z is the single "down the road" knob (default: half-way
// along the loop); the bike's stop line is derived from it. X is a lateral
// nudge (0 = centred). X/Y/scale/rotation are tuned visually against the scene.
const TRAFFIC_LIGHT_ASSET_NAME = 'trafficlight.glb'
const TRAFFIC_LIGHT_Z = START_Z - LOOP_PERIOD * 0.82
const TRAFFIC_LIGHT_X = 1.2
const TRAFFIC_LIGHT_Y = 0
const TRAFFIC_LIGHT_SCALE = 0.45
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

interface SceneOptions {
  lensEnabled: boolean
  singleTile: boolean
  noSplat: boolean
  noBike: boolean
}

function readSceneOptions(): SceneOptions {
  const params = new URLSearchParams(window.location.search)
  return {
    lensEnabled: params.get('lens') !== '0',
    singleTile: params.get('singletile') === '1',
    noSplat: params.get('nosplat') === '1',
    noBike: params.get('nobike') === '1',
  }
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

function configureApp(app: pc.AppBase, configUrl: string): Promise<void> {
  return new Promise((resolve, reject) =>
    app.configure(configUrl, (err) =>
      err ? reject(new Error(String(err))) : resolve(),
    ),
  )
}

function preloadApp(app: pc.AppBase): Promise<void> {
  return new Promise((resolve) => app.preload(() => resolve()))
}

function loadScene(app: pc.AppBase, scenePath: string): Promise<void> {
  return new Promise((resolve, reject) =>
    app.scenes.loadScene(scenePath, (err) =>
      err ? reject(new Error(String(err))) : resolve(),
    ),
  )
}

// The gsplat bakes lighting; dynamic shadows add cost without visible benefit.
// Strip shadow flags from every render component and light before the first frame.
function stripShadows(app: pc.AppBase) {
  for (const r of app.root.findComponents('render') as pc.RenderComponent[]) {
    r.castShadows = false
    r.receiveShadows = false
  }
  for (const l of app.root.findComponents('light') as pc.LightComponent[]) {
    l.castShadows = false
  }
}

// Globally LOD-balance both tiles to stay under a target splat count, then tune
// streaming so the looping camera doesn't accumulate GPU memory over time.
function configureGsplat(
  app: pc.AppBase,
  splats: (pc.GraphNode | null)[],
  noSplat: boolean,
) {
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
  for (const e of splats) {
    if (!(e instanceof pc.Entity) || !e.gsplat) continue
    if (noSplat) {
      e.enabled = false
      continue
    }
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
      fadeDistance: 0,
      stopZ: TRAFFIC_LIGHT_Z + TRAFFIC_LIGHT_STOP_OFFSET,
      slowDownDistance: TRAFFIC_LIGHT_SLOWDOWN,
      waitDuration: TRAFFIC_LIGHT_WAIT,
    },
  })
}

// Plants the traffic light across the road at the configured Z. The model
// already spans both sides, so a single instance is parented to the world root
// (static) — the looping rig passes it once per lap.
function setupTrafficLight(app: pc.AppBase) {
  const container = app.assets.find(TRAFFIC_LIGHT_ASSET_NAME, 'container')
  const resource = container?.resource as pc.ContainerResource | undefined
  if (!resource) return
  const light = resource.instantiateRenderEntity()
  light.setLocalPosition(TRAFFIC_LIGHT_X, TRAFFIC_LIGHT_Y, TRAFFIC_LIGHT_Z)
  light.setLocalEulerAngles(...TRAFFIC_LIGHT_EULER)
  light.setLocalScale(
    TRAFFIC_LIGHT_SCALE,
    TRAFFIC_LIGHT_SCALE,
    TRAFFIC_LIGHT_SCALE,
  )
  app.root.addChild(light)
}

// Swaps the baked grey single-mesh render on the "Render" anchor for the full
// textured GLB hierarchy, so every mesh and material from the container shows.
function setupBike(app: pc.AppBase, opts: SceneOptions) {
  const anchor = app.root.findByName(BIKE_ENTITY_NAME)
  if (!(anchor instanceof pc.Entity)) return
  if (opts.noBike) {
    anchor.enabled = false
    return
  }
  if (anchor.render) anchor.removeComponent('render')
  const container = app.assets.find(BIKE_ASSET_NAME, 'container')
  const resource = container?.resource as pc.ContainerResource | undefined
  const model = resource?.instantiateRenderEntity()
  if (model) anchor.addChild(model)
  anchor.setLocalPosition(0, 0, 0)
  anchor.setLocalEulerAngles(...BIKE_EULER)
  anchor.setLocalScale(BIKE_SCALE, BIKE_SCALE, BIKE_SCALE)
}

// Post-load scene wiring: tunes entities baked into the scene JSON and starts
// the impaired-vision overlay. Returns the camera entity the lenses attach to
// (null when the lens effect is disabled or the camera is missing).
function setupScene(app: pc.AppBase, opts: SceneOptions): pc.Entity | null {
  setupBike(app, opts)
  setupTrafficLight(app)

  stripShadows(app)

  const innerSplat = app.root.findByGuid(INNER_SPLAT_GUID)
  if (innerSplat instanceof pc.Entity) {
    const p = innerSplat.getLocalPosition()
    innerSplat.setLocalPosition(p.x, p.y, INNER_LOCAL_Z)
  }

  const outerSplat = app.root.findByGuid(OUTER_SPLAT_GUID)
  configureGsplat(app, [outerSplat, innerSplat], opts.noSplat)

  setupRig(app)

  const cam = app.root.findByName(CAMERA_ENTITY_NAME)
  const cameraEntity = cam instanceof pc.Entity && opts.lensEnabled ? cam : null
  if (cameraEntity) setupImpairedVision(app, cameraEntity)

  if (opts.singleTile && innerSplat instanceof pc.Entity)
    innerSplat.enabled = false

  const tiles = [outerSplat, innerSplat].filter(
    (e): e is pc.Entity => e instanceof pc.Entity,
  )
  if (
    cam instanceof pc.Entity &&
    tiles.length > 0 &&
    !opts.singleTile &&
    !opts.noSplat
  )
    setupTileCulling(app, cam, tiles)

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

  await configureApp(app, CONFIG_FILENAME)
  await preloadApp(app)
  await loadScene(app, SCENE_PATH)
  app.start()
  const cameraEntity = setupScene(app, readSceneOptions())

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
