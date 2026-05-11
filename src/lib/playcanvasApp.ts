import * as pc from 'playcanvas'
import { setupGlasses } from './glasses-pc'
import { CYCLE_FORWARD_BASE_SPEED, registerCycleForward } from './scripts/cycleForward'
import { type LookState, registerLookCamera } from './scripts/lookCamera'

const PROJECT_PREFIX = `${import.meta.env.BASE_URL}playcanvas/`
const CONFIG_FILENAME = `${PROJECT_PREFIX}config.json`
const SCENE_PATH = `${PROJECT_PREFIX}2483428.json`

// Mobile GPUs scale quadratically with pixel count; gsplat fill is the bottleneck.
// Touch devices render below CSS pixels and rely on browser upscaling; the
// lens already softens half the screen so the loss is hard to spot.
const MAX_PIXEL_RATIO_TOUCH = 0.75
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

  const onResize = () => app.resizeCanvas()
  window.addEventListener('resize', onResize)

  await new Promise<void>((resolve, reject) => {
    app.configure(CONFIG_FILENAME, (configErr) => {
      if (configErr) return reject(new Error(String(configErr)))
      app.preload(() => {
        app.scenes.loadScene(SCENE_PATH, (sceneErr) => {
          if (sceneErr) return reject(new Error(String(sceneErr)))
          app.start()

          const bike = app.root.findByName(BIKE_ENTITY_NAME)
          if (bike instanceof pc.Entity) bike.setLocalScale(0.25, 0.25, 0.25)

          // The gsplat bakes lighting; dynamic shadows add cost without
          // visible benefit. Strip shadow flags from every render component
          // and every light in the scene before the first frame.
          for (const r of app.root.findComponents('render') as pc.RenderComponent[]) {
            r.castShadows = false
            r.receiveShadows = false
          }
          for (const l of app.root.findComponents('light') as pc.LightComponent[]) {
            l.castShadows = false
          }

          const innerSplat = app.root.findByGuid(INNER_SPLAT_GUID)
          if (innerSplat instanceof pc.Entity) {
            const p = innerSplat.getLocalPosition()
            innerSplat.setLocalPosition(p.x, p.y, INNER_LOCAL_Z)
          }

          const outerSplat = app.root.findByGuid(OUTER_SPLAT_GUID)
          for (const e of [outerSplat, innerSplat]) {
            if (!(e instanceof pc.Entity) || !e.gsplat) continue
            // Cheaper Z-axis SH approximation. Edge gaussians lose some view-
            // dependent shading; usually unnoticeable, big GPU win on mobile.
            e.gsplat.highQualitySH = false
            const mat = e.gsplat.material as
              | (pc.ShaderMaterial & { useFog?: boolean; useTonemap?: boolean })
              | undefined
            if (mat) {
              mat.useFog = false
              mat.useTonemap = false
            }
          }

          const occluderMat = new pc.StandardMaterial()
          occluderMat.diffuse = new pc.Color(0, 0, 0)
          occluderMat.useLighting = false
          occluderMat.update()
          const occluder = new pc.Entity('GroundOccluder')
          occluder.addComponent('render', { type: 'plane' })
          if (occluder.render) {
            occluder.render.material = occluderMat
            occluder.render.castShadows = false
            occluder.render.receiveShadows = false
          }
          occluder.setLocalScale(100, 1, 100)
          occluder.setLocalPosition(0, -0.02, 0)
          app.root.addChild(occluder)

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
          if (cam instanceof pc.Entity)
            setupGlasses(app, cam).catch((err) => {
              console.error('Glasses setup failed:', err)
            })

          // Per-frame gsplat culling. Each gsplat's sort is GPU-expensive even
          // when its rasterized output is fully clipped. When a tile drifts
          // beyond one full loop period from the camera, disable the entity so
          // the sort is skipped entirely.
          const tiles = [outerSplat, innerSplat].filter(
            (e): e is pc.Entity => e instanceof pc.Entity,
          )
          const cullThreshold = LOOP_PERIOD * 0.9
          if (cam instanceof pc.Entity && tiles.length > 0) {
            app.on('update', () => {
              const camZ = cam.getPosition().z
              for (const tile of tiles)
                tile.enabled = Math.abs(tile.getPosition().z - camZ) < cullThreshold
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
  }
}
