import * as pc from 'playcanvas'
import {
  type GlassesController,
  type LensProduct,
  type LensSide,
  setupImpairedVision,
  setupLenses,
} from './glasses-pc'
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

export async function bootApp(
  canvas: HTMLCanvasElement,
  lookState: LookState,
): Promise<BootedApp> {
  const device = await pc.createGraphicsDevice(canvas, {
    deviceTypes: ['webgl2', 'webgl1'],
    powerPreference: 'high-performance',
    antialias: false,
  })

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

  const maxPixelRatio = pc.platform.touch
    ? MAX_PIXEL_RATIO_TOUCH
    : MAX_PIXEL_RATIO_DESKTOP
  device.maxPixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio)

  registerLookCamera(app, lookState)
  registerCycleForward(app)

  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW)
  app.setCanvasResolution(pc.RESOLUTION_AUTO)

  // Captured once the scene has loaded so putOnGlasses can lazily run
  // setupGlasses after the user clicks the in-scene button.
  let cameraEntity: pc.Entity | null = null
  let putOnGlassesPromise: Promise<void> | null = null
  let glasses: GlassesController | null = null

  const onResize = () => app.resizeCanvas()
  window.addEventListener('resize', onResize)

  await new Promise<void>((resolve, reject) => {
    app.configure(CONFIG_FILENAME, (configErr) => {
      if (configErr) return reject(new Error(String(configErr)))
      app.preload(() => {
        app.scenes.loadScene(SCENE_PATH, (sceneErr) => {
          if (sceneErr) return reject(new Error(String(sceneErr)))
          app.start()

          const params = new URLSearchParams(window.location.search)
          const lensEnabled = params.get('lens') !== '0'
          const singleTile = params.get('singletile') === '1'
          const noSplat = params.get('nosplat') === '1'
          const noBike = params.get('nobike') === '1'

          const bike = app.root.findByName(BIKE_ENTITY_NAME)
          if (bike instanceof pc.Entity) {
            bike.setLocalScale(0.25, 0.25, 0.25)
            if (noBike) bike.enabled = false
          }

          // The gsplat bakes lighting; dynamic shadows add cost without
          // visible benefit. Strip shadow flags from every render component
          // and every light in the scene before the first frame.
          for (const r of app.root.findComponents(
            'render',
          ) as pc.RenderComponent[]) {
            r.castShadows = false
            r.receiveShadows = false
          }
          for (const l of app.root.findComponents(
            'light',
          ) as pc.LightComponent[]) {
            l.castShadows = false
          }

          const innerSplat = app.root.findByGuid(INNER_SPLAT_GUID)
          if (innerSplat instanceof pc.Entity) {
            const p = innerSplat.getLocalPosition()
            innerSplat.setLocalPosition(p.x, p.y, INNER_LOCAL_Z)
          }

          const outerSplat = app.root.findByGuid(OUTER_SPLAT_GUID)
          // Modern unified pipeline: globally LOD-balance both tiles to stay
          // under a target splat count. Mobile is fill-bound, so it gets a
          // tighter budget than desktop.
          // iOS gets the tightest budget because thermal throttling kicks in
          // after a couple of loop cycles — less per-frame GPU work = slower
          // heat buildup = stable FPS for longer.
          app.scene.gsplat.splatBudget = pc.platform.ios
            ? 200_000
            : pc.platform.touch
              ? 500_000
              : 4_000_000
          // Mobile clamps to LOD 2/3. iOS Safari additionally pins to a single
          // LOD because Metal's WebGL texture allocator doesn't reclaim freed
          // chunks promptly — repeated load/evict cycles compound into FPS
          // drift over time on iPhone (not reproducible in desktop Chrome).
          // Pinning to LOD 3 means the same 3 chunk files are uploaded once
          // and never churned, eliminating the GPU memory pressure entirely.
          if (pc.platform.ios) {
            app.scene.gsplat.lodRangeMin = 3
            app.scene.gsplat.lodRangeMax = 3
          } else if (pc.platform.touch) {
            app.scene.gsplat.lodRangeMin = 2
          }
          // LOD streaming tuning:
          //   - underfill: draw a coarser cached LOD while the desired tier
          //     streams in (no stalls during wrap, just brief blur).
          //   - cooldownTicks ~2s: evict off-screen chunks aggressively so
          //     panning around doesn't accumulate GPU memory. Higher values
          //     (60s to span the loop) caused steady FPS decay; 10s also
          //     felt worse on device than 2s.
          //   - behindPenalty: trailing-tile chunks coarsen pre-emptively so
          //     the post-wrap LOD upgrade jump is smaller.
          //   - lodUpdateDistance: re-evaluate LOD only every 3m of camera
          //     motion (default 1m). Cuts LOD selection cost during cycling.
          //   - radialSorting: matches PlayCanvas's streamed-gsplat walk-mode
          //     sample — cheaper sort that stays stable as the camera rotates
          //     in place (which is exactly what mobile head-look does).
          app.scene.gsplat.lodUnderfillLimit = 2
          app.scene.gsplat.cooldownTicks = 120
          app.scene.gsplat.lodBehindPenalty = 3
          app.scene.gsplat.lodUpdateDistance = 3
          app.scene.gsplat.radialSorting = true
          for (const e of [outerSplat, innerSplat]) {
            if (!(e instanceof pc.Entity) || !e.gsplat) continue
            if (noSplat) {
              e.enabled = false
              continue
            }
            e.gsplat.unified = true
            // Cheaper Z-axis SH approximation. Edge gaussians lose some view-
            // dependent shading; usually unnoticeable, big GPU win on mobile.
            e.gsplat.highQualitySH = false
            // Drop quality faster with distance — the trailing tile is usually
            // far from the camera as it loops around behind. Touch devices
            // get an even steeper falloff so mid-distance splats coarsen fast.
            e.gsplat.lodBaseDistance = pc.platform.touch ? 0.5 : 1
            e.gsplat.lodMultiplier = pc.platform.touch ? 2 : 1.5
          }

          const rig = app.root.findByName(RIG_ENTITY_NAME)
          if (rig instanceof pc.Entity) {
            rig.addComponent('script')
            rig.script?.create('cycleForward', {
              attributes: {
                speed: CYCLE_FORWARD_BASE_SPEED,
                startZ: START_Z,
                targetZ: TARGET_Z,
                loop: true,
                fadeDistance: 0,
              },
            })
          }

          const cam = app.root.findByName(CAMERA_ENTITY_NAME)
          if (cam instanceof pc.Entity && lensEnabled) {
            cameraEntity = cam
            setupImpairedVision(app, cam)
          }

          if (singleTile && innerSplat instanceof pc.Entity)
            innerSplat.enabled = false

          // Per-frame gsplat culling. Each gsplat's sort is GPU-expensive even
          // when its rasterized output is fully clipped. When a tile drifts
          // beyond one full loop period from the camera, disable the entity so
          // the sort is skipped entirely.
          const tiles = [outerSplat, innerSplat].filter(
            (e): e is pc.Entity => e instanceof pc.Entity,
          )
          const cullThreshold = LOOP_PERIOD * 0.9
          if (
            cam instanceof pc.Entity &&
            tiles.length > 0 &&
            !singleTile &&
            !noSplat
          ) {
            app.on('update', () => {
              const camZ = cam.getPosition().z
              for (const tile of tiles)
                tile.enabled =
                  Math.abs(tile.getPosition().z - camZ) < cullThreshold
            })
          }

          resolve()
        })
      })
    })
  })

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
