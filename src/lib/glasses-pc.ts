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

const IMPAIRED_BLUR_RADIUS_PX = 16.0
const IMPAIRED_CHROMA_STRENGTH = 0.004
const IMPAIRED_FADE_IN_SEC = 1.0

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
  // Per-axis tanh asymptote: the displacement from screen center smoothly
  // caps at ±0.499 so sampleUV stays inside [0.001, 0.999] regardless of how
  // hard we minify. Without this, factor > 0 at the screen corners would push
  // sampleUV past the edge and texel clamping would draw axis-aligned streaks.
  vec2 d = (screenUV - center) * (1.0 + factor);
  d.x = 0.499 * tanh(d.x / 0.499);
  d.y = 0.499 * tanh(d.y / 0.499);
  vec2 sampleUV = center + d;

  // Minification (factor > 0) pushes sampleUV outside [0, 1] near the screen
  // edges. Hard-clamping there repeats the edge texel and shows as stripes.
  // Fade alpha based on distance to the boundary from INSIDE, so alpha is
  // already 0 before we'd ever sample a clamped pixel — revealing the
  // (blurred) underlying world layer artifact-free.
  vec2 edgeDist = min(sampleUV, 1.0 - sampleUV);
  float minEdge = min(edgeDist.x, edgeDist.y);
  float alpha = smoothstep(0.0, 0.05, minEdge);

  sampleUV = clamp(sampleUV, vec2(0.001), vec2(0.999));
  pcFragColor0 = vec4(texture(uSceneColorMap, sampleUV).rgb, alpha);
}
`

const IMPAIRED_VERTEX_GLSL = `
in vec3 vertex_position;
void main(void) { gl_Position = vec4(vertex_position.xy, 0.0, 1.0); }
`

const IMPAIRED_FRAGMENT_GLSL = `
precision highp float;
uniform sampler2D uSceneColorMap;
uniform vec4 uScreenSize;
uniform float uBlurRadius;
uniform float uChroma;
uniform float uStrength;

// Weight a blur tap to 0 if its UV is out of [0,1], so edge texels are not
// repeated into the kernel sum — that's what produces axis-aligned streaks
// near the screen boundary.
float inBounds(vec2 uv) {
  vec2 m = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return m.x * m.y;
}

void main(void) {
  vec2 uv = gl_FragCoord.xy * uScreenSize.zw;
  vec2 px = uScreenSize.zw * uBlurRadius;
  vec3 c = vec3(0.0);
  float wsum = 0.0;
  #define TAP(O, W) { vec2 s = uv + (O); float k = (W) * inBounds(s); c += texture(uSceneColorMap, s).rgb * k; wsum += k; }
  TAP(vec2(0.0, 0.0), 0.227027)
  TAP(vec2( px.x, 0.0), 0.1945946)
  TAP(vec2(-px.x, 0.0), 0.1945946)
  TAP(vec2(0.0,  px.y), 0.1216216)
  TAP(vec2(0.0, -px.y), 0.1216216)
  TAP(vec2( px.x,  px.y), 0.054054)
  TAP(vec2(-px.x, -px.y), 0.054054)
  TAP(vec2( px.x, -px.y), 0.054054)
  TAP(vec2(-px.x,  px.y), 0.054054)
  c /= max(wsum, 1e-4);
  vec2 dir = uv - vec2(0.5);
  vec2 off = dir * uChroma;
  float r = texture(uSceneColorMap, clamp(uv + off, vec2(0.0), vec2(1.0))).r;
  float b = texture(uSceneColorMap, clamp(uv - off, vec2(0.0), vec2(1.0))).b;
  vec3 impaired = vec3(r, c.g, b);
  vec3 sharp = texture(uSceneColorMap, uv).rgb;
  pcFragColor0 = vec4(mix(sharp, impaired, uStrength), 1.0);
}
`

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

  const startTime = performance.now() / 1000
  app.on('update', () => {
    const t = Math.min(
      1,
      (performance.now() / 1000 - startTime) / IMPAIRED_FADE_IN_SEC,
    )
    material.setParameter('uStrength', t)
  })
}

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

export interface GlassesController {
  setLeftLensActive(active: boolean): void
}

export async function setupGlasses(
  app: pc.AppBase,
  cameraEntity: pc.Entity,
): Promise<GlassesController> {
  if (cameraEntity.camera) cameraEntity.camera.renderSceneColorMap = true
  reorderLayersForGrab(app.scene.layers)
  setupImpairedVisionOverlay(app)

  const assets = await Promise.all(
    SIDES.flatMap((s) => [
      loadAsset(app, s.lensFile, 'container', `${ASSETS_PATH}${s.lensFile}`),
      loadAsset(app, s.frameFile, 'container', `${ASSETS_PATH}${s.frameFile}`),
    ]),
  )

  const frameMat = createFrameMaterial()
  let leftLens: pc.Entity | null = null

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

    if (side.name === 'GlassesLeft') {
      leftLens = lens
      lens.enabled = false
    }
  }

  return {
    setLeftLensActive(active: boolean) {
      if (leftLens) leftLens.enabled = active
    },
  }
}
