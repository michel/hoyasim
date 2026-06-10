import * as pc from 'playcanvas'
import { IMPAIRED_FRAGMENT_GLSL, IMPAIRED_VERTEX_GLSL } from './glasses-shaders'

const IMPAIRED_BLUR_RADIUS_PX = 16.0
const IMPAIRED_CHROMA_STRENGTH = 0.001
const IMPAIRED_FADE_IN_SEC = 1.0

// Reorder layer composition so the scene-color grab pass fires AFTER the World
// transparent sub-layer (where the gsplat renders). The grab is inserted by PC
// at the LAYERID_DEPTH transition; moving Depth to after World transparent
// causes the grab to capture the splat too. The lens then renders in
// LAYERID_IMMEDIATE — after the grab — and its shader can sample
// uSceneColorMap with the splat in it.
function reorderLayersForGrab(layers: pc.LayerComposition) {
  const depth = layers.getLayerById(pc.LAYERID_DEPTH)
  if (!depth) return

  layers.removeOpaque(depth)
  layers.removeTransparent(depth)

  const layerList = layers.layerList
  const subLayerList = layers.subLayerList
  let worldTransparentIdx = -1
  for (let i = 0; i < layerList.length; i++) {
    if (layerList[i].id === pc.LAYERID_WORLD && subLayerList[i]) {
      worldTransparentIdx = i
      break
    }
  }
  if (worldTransparentIdx < 0) return

  layers.insertOpaque(depth, worldTransparentIdx + 1)
}

function setupImpairedVisionOverlay(app: pc.AppBase) {
  const device = app.graphicsDevice
  const mesh = new pc.Mesh(device)
  mesh.setPositions([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0])
  mesh.setIndices([0, 1, 2, 1, 3, 2])
  mesh.update()

  const material = new pc.ShaderMaterial({
    uniqueName: 'impaired-vision-overlay',
    vertexGLSL: IMPAIRED_VERTEX_GLSL,
    fragmentGLSL: IMPAIRED_FRAGMENT_GLSL,
    attributes: { vertex_position: pc.SEMANTIC_POSITION },
  })
  material.setParameter('uBlurRadius', IMPAIRED_BLUR_RADIUS_PX)
  material.setParameter('uChroma', IMPAIRED_CHROMA_STRENGTH)
  material.setParameter('uStrength', 0)
  material.depthWrite = false
  material.depthTest = false
  material.blendType = pc.BLEND_NONE
  material.update()

  const entity = new pc.Entity('ImpairedVision')
  app.root.addChild(entity)
  const meshInstance = new pc.MeshInstance(mesh, material, entity)
  meshInstance.cull = false
  meshInstance.drawOrder = -1
  entity.addComponent('render')
  if (entity.render) {
    entity.render.meshInstances = [meshInstance]
    entity.render.layers = [pc.LAYERID_IMMEDIATE]
    entity.render.castShadows = false
    entity.render.receiveShadows = false
  }

  // Fade the impairment in, then detach — uStrength stays pinned at 1 for the
  // rest of the session, so there's nothing left to update per frame.
  let elapsed = 0
  const onUpdate = (dt: number) => {
    elapsed += dt
    const t = Math.min(1, elapsed / IMPAIRED_FADE_IN_SEC)
    material.setParameter('uStrength', t)
    if (t >= 1) app.off('update', onUpdate)
  }
  app.on('update', onUpdate)
}

// Sets up the blurred / chromatic-aberration overlay that simulates needing
// glasses. Stays active for the whole session (teardown rides app.destroy()) —
// putting on glasses doesn't remove the blur, it just locally corrects it
// within the lens geometry.
export function setupImpairedVision(app: pc.AppBase, cameraEntity: pc.Entity) {
  if (cameraEntity.camera) cameraEntity.camera.renderSceneColorMap = true
  reorderLayersForGrab(app.scene.layers)
  setupImpairedVisionOverlay(app)
}
