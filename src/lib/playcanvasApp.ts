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
  RIG_ENTITY_NAME,
  setupBike,
  setupTrafficLight,
  TRAFFIC_LIGHT_SLOWDOWN,
  TRAFFIC_LIGHT_STOP_Z,
  TRAFFIC_LIGHT_WAIT,
} from './scene-props'
import {
  CYCLE_FORWARD_BASE_SPEED,
  registerCycleForward,
} from './scripts/cycleForward'
import { type LookState, registerLookCamera } from './scripts/lookCamera'

const PROJECT_PREFIX = `${import.meta.env.BASE_URL}playcanvas/`
const CONFIG_FILENAME = `${PROJECT_PREFIX}config.json`
const SCENE_PATH = `${PROJECT_PREFIX}2483428.json`

// Mobile GPUs scale quadratically with pixel count; gsplat fill is the bottleneck.
// Touch caps at CSS resolution (1.0): below it the upscale reads pixelated on
// an iPhone, while native DPR is ~9x the fill at 3x. CSS resolution also maps
// to the device grid at a clean integer ratio. The blur radii track this cap
// via blurPixelScale, so changing it doesn't change the designed blur look.
const MAX_PIXEL_RATIO_TOUCH = 1.0
const MAX_PIXEL_RATIO_DESKTOP = 1.5

// World magnification of the splat tiles (applied to the outer tile in
// setupScene, overriding the scene JSON's baked 5). Raised from 5 to 6 so the
// environment reads larger around the fixed-size bike/camera — the bike then
// sits in proper proportion instead of dwarfing the street. Every world-space
// constant below derives from it; the rig speed is scaled to match so the
// perceived riding pace is unchanged.
const OUTER_SCALE = 7.2
// The lap window spans the bundle's rideable street (local z -1.75..+3.15):
// start at the north end and wrap at the south one — the wrap lands on the
// identical spot in the next tile copy.
const START_Z = 11.0
// The scene loops by tiling two copies of the splat LOOP_PERIOD apart (the rig
// rides one period, then snaps back). The two tiles sit LOOP_PERIOD/OUTER_SCALE
// apart in the splat's own local units — the separation equals the rideable
// street span so consecutive copies butt road-to-road.
const LOOP_PERIOD = 35.2
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
const CAMERA_ENTITY_NAME = 'Camera'

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
  // LOD streaming tuning:
  //   - underfill: draw a coarser cached LOD while the desired tier streams in.
  //   - cooldownTicks ~2s: evict off-screen chunks aggressively so panning
  //     doesn't accumulate GPU memory. Higher values caused steady FPS decay.
  //   - behindPenalty: trailing-tile chunks coarsen pre-emptively so the
  //     post-wrap LOD upgrade jump is smaller.
  //   - lodUpdateDistance: re-evaluate LOD only every 3m of camera motion.
  //   - radialSorting: sort order that stays artifact-free as the camera
  //     rotates in place (exactly what mobile head-look does; the engine trades
  //     it off against translation, our secondary risk).
  //   - lodUpdateAngle: also re-evaluate LOD after 20° of camera rotation.
  //     Translation short-circuits the check, so this only fires while the rig
  //     is stationary at the traffic light — head-look there never travels the
  //     3m lodUpdateDistance, and without an angle trigger the behindPenalty
  //     coarsening never reacts to panning. Kept well under a head-look's
  //     swing so it actually trips.
  app.scene.gsplat.lodUnderfillLimit = 2
  app.scene.gsplat.cooldownTicks = 120
  app.scene.gsplat.lodBehindPenalty = 3
  app.scene.gsplat.lodUpdateDistance = 3
  app.scene.gsplat.radialSorting = true
  app.scene.gsplat.lodUpdateAngle = 20
  if (pc.platform.touch) {
    // Vertex-stage culls, both invisible at mobile's reduced pixel ratio but
    // otherwise still costing sort + fill: splats under 2% peak alpha, and
    // splats projecting under 3 framebuffer pixels (sub-0.5% of screen height —
    // distant micro-detail the fog and impaired blur already swallow).
    app.scene.gsplat.alphaClipForward = 0.02
    app.scene.gsplat.minPixelSize = 3
  }
  for (const e of tiles) {
    if (!e.gsplat) continue
    // Unified rendering is the default (and only) mode since pc 2.21, and the
    // bundle ships 0 SH bands, so no per-entity SH tuning is needed anymore.
    // Drop quality faster with distance — the trailing tile is usually far from
    // the camera as it loops around behind. Touch gets a steeper falloff.
    e.gsplat.lodBaseDistance = pc.platform.touch ? 0.5 : 1
    e.gsplat.lodMultiplier = pc.platform.touch ? 2 : 1.5
    // LOD clamps live on the COMPONENT since pc 2.20 — the scene-level
    // properties are deprecated warn-only stubs that discard the value.
    // Mobile clamps to LOD 2/3. iOS Safari additionally pins to a single LOD
    // because Metal's WebGL texture allocator doesn't reclaim freed chunks
    // promptly — repeated load/evict cycles compound into FPS drift over time
    // on iPhone. Pinning to LOD 3 means the same few chunk files are uploaded
    // once and never churned, and the finer (larger) tiers are never fetched.
    if (pc.platform.ios) {
      e.gsplat.lodRangeMin = 3
      e.gsplat.lodRangeMax = 3
    } else if (pc.platform.touch) {
      e.gsplat.lodRangeMin = 2
    }
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
  const cullThreshold = 42
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
      stopZ: TRAFFIC_LIGHT_STOP_Z,
      slowDownDistance: TRAFFIC_LIGHT_SLOWDOWN,
      waitDuration: TRAFFIC_LIGHT_WAIT,
    },
  })
}

// Post-load scene wiring: tunes entities baked into the scene JSON and starts
// the impaired-vision overlay. Returns the camera entity the lenses attach to
// (null when the camera is missing).
function setupScene(app: pc.AppBase): pc.Entity | null {
  setupBike(app)
  setupTrafficLight(app, LOOP_PERIOD)

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
  // MUST come after configure: config.json ships useDevicePixelRatio, which
  // makes _parseApplicationProperties overwrite maxPixelRatio with the full
  // window.devicePixelRatio — capping earlier is silently undone (phones then
  // render at native DPR, ~36x the fill this cap intends at 3x DPR).
  const maxPixelRatio = pc.platform.touch
    ? MAX_PIXEL_RATIO_TOUCH
    : MAX_PIXEL_RATIO_DESKTOP
  device.maxPixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio)
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
