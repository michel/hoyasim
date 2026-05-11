import * as pc from 'playcanvas'

const ASSETS_PATH = `${window.location.origin}${import.meta.env.BASE_URL}assets/glasses/`

const LENS_SCALE_MULT = 1.08
const LENS_SCALE = new pc.Vec3(
  0.16875 * LENS_SCALE_MULT,
  0.16875 * LENS_SCALE_MULT,
  0.28125 * LENS_SCALE_MULT,
)
const LENS_LEFT_POS = new pc.Vec3(-0.39375, 0, -0.4875)
const LENS_RIGHT_POS = new pc.Vec3(0.39375, 0, -0.4875)

const PROGRESSIVE_POWER = 0.45

type AssetType = ConstructorParameters<typeof pc.Asset>[1]

function loadAsset(
  app: pc.AppBase,
  name: string,
  type: AssetType,
  url: string,
): Promise<pc.Asset> {
  return new Promise((resolve, reject) => {
    const asset = new pc.Asset(name, type, { url })
    asset.once('load', () => resolve(asset))
    asset.once('error', (err: unknown) => reject(new Error(String(err))))
    app.assets.add(asset)
    app.assets.load(asset)
  })
}

function applyMaterial(entity: pc.Entity, material: pc.Material) {
  for (const r of entity.findComponents('render') as pc.RenderComponent[])
    for (const mi of r.meshInstances) mi.material = material
}

function setLayer(entity: pc.Entity, layerId: number) {
  for (const r of entity.findComponents('render') as pc.RenderComponent[])
    r.layers = [layerId]
}

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

function localZRange(entity: pc.Entity): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const r of entity.findComponents('render') as pc.RenderComponent[]) {
    for (const mi of r.meshInstances) {
      const aabb = mi.mesh.aabb
      min = Math.min(min, aabb.center.z - aabb.halfExtents.z)
      max = Math.max(max, aabb.center.z + aabb.halfExtents.z)
    }
  }
  return { min, max }
}

const VERTEX_GLSL = `
in vec3 vertex_position;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
out vec3 vLocalPos;
void main(void) {
  vLocalPos = vertex_position;
  gl_Position = matrix_viewProjection * matrix_model * vec4(vertex_position, 1.0);
}
`

const FRAGMENT_GLSL = `
precision highp float;
uniform sampler2D uSceneColorMap;
uniform vec4 uScreenSize;
uniform float uPower;
uniform float uMinY;
uniform float uMaxY;
in vec3 vLocalPos;

void main(void) {
  vec2 screenUV = gl_FragCoord.xy * uScreenSize.zw;

  // vLocalPos.z is the lens GLB's vertical axis. With the current lens GLBs:
  // lensY = 0 at the visual top of the lens, lensY = 1 at the visual bottom.
  float lensY = clamp((vLocalPos.z - uMinY) / (uMaxY - uMinY), 0.0, 1.0);

  // Multifocal progressive:
  //   top (lensY = 0)    → factor = +uPower → minify (zoom out)
  //   center (lensY=0.5) → factor = 0       → no distortion
  //   bottom (lensY = 1) → factor = -uPower → magnify (zoom in)
  float factor = (0.5 - lensY) * 2.0 * uPower;

  vec2 center = vec2(0.5);
  vec2 sampleUV = center + (screenUV - center) * (1.0 + factor);

  // Minification (factor > 0) pushes sampleUV outside [0, 1] near the screen
  // edges. Hard-clamping there repeats the edge texel and shows as stripes.
  // Instead, fade the lens alpha to 0 in the out-of-bounds region — the lens
  // becomes transparent, revealing the underlying un-distorted scene rendered
  // by the world layer. Smooth and artifact-free.
  vec2 outDist = max(max(-sampleUV, sampleUV - 1.0), 0.0);
  float outAmount = max(outDist.x, outDist.y);
  float alpha = 1.0 - smoothstep(0.0, 0.05, outAmount);

  sampleUV = clamp(sampleUV, vec2(0.001), vec2(0.999));
  // Sample from mip 1 instead of mip 0. The grab target is mipmapped already,
  // so this costs nothing extra but halves the bandwidth of the lens sample
  // and adds a slight optical softness (a real progressive lens isn't crisp).
  pcFragColor0 = vec4(textureLod(uSceneColorMap, sampleUV, 1.0).rgb, alpha);
}
`

function createLensMaterial(yMin: number, yMax: number): pc.ShaderMaterial {
  const m = new pc.ShaderMaterial({
    uniqueName: `progressive-lens-${yMin}-${yMax}`,
    vertexGLSL: VERTEX_GLSL,
    fragmentGLSL: FRAGMENT_GLSL,
    attributes: { vertex_position: pc.SEMANTIC_POSITION },
  })
  m.setParameter('uPower', PROGRESSIVE_POWER)
  m.setParameter('uMinY', yMin)
  m.setParameter('uMaxY', yMax)
  // Transparent so the lens renders AFTER the scene-color grab pass and can
  // sample uSceneColorMap.
  m.blendType = pc.BLEND_NORMAL
  m.depthWrite = false
  m.update()
  return m
}

function createFrameMaterial(): pc.StandardMaterial {
  const m = new pc.StandardMaterial()
  m.diffuse.set(0, 0, 0)
  m.useMetalness = true
  m.metalness = 0
  m.gloss = 0.9
  m.update()
  return m
}

interface SideConfig {
  name: string
  lensFile: string
  frameFile: string
  position: pc.Vec3
}

const SIDES: SideConfig[] = [
  {
    name: 'GlassesLeft',
    lensFile: 'lens_left.glb',
    frameFile: 'lens_frame_left.glb',
    position: LENS_LEFT_POS,
  },
  {
    name: 'GlassesRight',
    lensFile: 'lens_right.glb',
    frameFile: 'lens_frame_right.glb',
    position: LENS_RIGHT_POS,
  },
]

export async function setupGlasses(app: pc.AppBase, cameraEntity: pc.Entity) {
  if (cameraEntity.camera) cameraEntity.camera.renderSceneColorMap = true
  reorderLayersForGrab(app.scene.layers)

  const assets = await Promise.all(
    SIDES.flatMap((s) => [
      loadAsset(app, s.lensFile, 'container', `${ASSETS_PATH}${s.lensFile}`),
      loadAsset(app, s.frameFile, 'container', `${ASSETS_PATH}${s.frameFile}`),
    ]),
  )

  const frameMat = createFrameMaterial()

  for (let i = 0; i < SIDES.length; i++) {
    const side = SIDES[i]
    const lensAsset = assets[i * 2]
    const frameAsset = assets[i * 2 + 1]

    const group = new pc.Entity(side.name)

    const lens = (
      lensAsset.resource as pc.ContainerResource
    ).instantiateRenderEntity()
    const { min, max } = localZRange(lens)
    applyMaterial(lens, createLensMaterial(min, max))
    setLayer(lens, pc.LAYERID_IMMEDIATE)

    const frame = (
      frameAsset.resource as pc.ContainerResource
    ).instantiateRenderEntity()
    applyMaterial(frame, frameMat)
    // Frame's opaque pass runs after the grab and before the lens transparent
    // pass within IMMEDIATE, so the lens shader doesn't sample the frame.
    setLayer(frame, pc.LAYERID_IMMEDIATE)

    group.addChild(lens)
    group.addChild(frame)
    group.setLocalPosition(side.position)
    group.setLocalScale(LENS_SCALE)
    cameraEntity.addChild(group)
  }
}
