import * as pc from 'playcanvas'
import { SUN_DIRECTION, sunInView } from './scripts/sun'

const ASSETS_PATH = `${window.location.origin}${import.meta.env.BASE_URL}assets/glasses/`

const LENS_SCALE_MULT = 1.4
const LENS_SCALE = new pc.Vec3(
  0.16875 * LENS_SCALE_MULT,
  0.16875 * LENS_SCALE_MULT,
  0.28125 * LENS_SCALE_MULT,
)
// Spread the lenses outward proportionally so the larger glasses still
// frame each eye with a clear bridge between, rather than crowding the
// centre of the screen.
const LENS_LEFT_POS = new pc.Vec3(-0.5, 0, -0.4875)
const LENS_RIGHT_POS = new pc.Vec3(0.5, 0, -0.4875)

const IMPAIRED_BLUR_RADIUS_PX = 16.0
const IMPAIRED_CHROMA_STRENGTH = 0.001
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
uniform float uCenterY;
uniform float uSensityDarkness;
uniform float uMinY;
uniform float uMaxY;
in vec3 vLocalPos;

void main(void) {
  vec2 screenUV = gl_FragCoord.xy * uScreenSize.zw;

  // vLocalPos.z is the lens GLB's vertical axis. With the current lens GLBs:
  // lensY = 0 at the visual top of the lens, lensY = 1 at the visual bottom.
  float lensY = clamp((vLocalPos.z - uMinY) / (uMaxY - uMinY), 0.0, 1.0);

  // Multifocal progressive. uCenterY = the lensY at which the lens is "neutral"
  // (no distortion). For everyday designs this sits at 0.5; the WorkStyle desk
  // lens shifts it upward so the intermediate-distance band lands in the upper
  // middle of the lens.
  //   lensY < uCenterY  → factor > 0 → minify (zoom out)
  //   lensY = uCenterY  → factor = 0 → no distortion
  //   lensY > uCenterY  → factor < 0 → magnify (zoom in)
  float factor = (uCenterY - lensY) * 2.0 * uPower;

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
  vec3 color = texture(uSceneColorMap, sampleUV).rgb;
  // Sensity photochromic darken. ~30 % brightness retained at full
  // darkness — cat-3 sunglass tint. The activation curve only reaches
  // 1.0 when the customer is staring directly at the sun, so day-to-day
  // gameplay sits closer to a 50–60 % retained tint.
  color *= mix(1.0, 0.3, uSensityDarkness);
  pcFragColor0 = vec4(color, alpha);
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
uniform float uBlind;
uniform vec2 uSunUV;

// Weight a blur tap to 0 if its UV is out of [0,1], so edge texels are not
// repeated into the kernel sum — that's what produces axis-aligned streaks
// near the screen boundary.
float inBounds(vec2 uv) {
  vec2 m = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return m.x * m.y;
}

vec3 blur9(vec2 base, vec2 px) {
  vec3 c = vec3(0.0);
  float wsum = 0.0;
  vec2 s; float k;
  s = base + vec2( 0.0,  0.0); k = 0.227027 * inBounds(s); c += texture(uSceneColorMap, s).rgb * k; wsum += k;
  s = base + vec2( px.x, 0.0); k = 0.1945946 * inBounds(s); c += texture(uSceneColorMap, s).rgb * k; wsum += k;
  s = base + vec2(-px.x, 0.0); k = 0.1945946 * inBounds(s); c += texture(uSceneColorMap, s).rgb * k; wsum += k;
  s = base + vec2( 0.0,  px.y); k = 0.1216216 * inBounds(s); c += texture(uSceneColorMap, s).rgb * k; wsum += k;
  s = base + vec2( 0.0, -px.y); k = 0.1216216 * inBounds(s); c += texture(uSceneColorMap, s).rgb * k; wsum += k;
  s = base + vec2( px.x,  px.y); k = 0.054054 * inBounds(s); c += texture(uSceneColorMap, s).rgb * k; wsum += k;
  s = base + vec2(-px.x, -px.y); k = 0.054054 * inBounds(s); c += texture(uSceneColorMap, s).rgb * k; wsum += k;
  s = base + vec2( px.x, -px.y); k = 0.054054 * inBounds(s); c += texture(uSceneColorMap, s).rgb * k; wsum += k;
  s = base + vec2(-px.x,  px.y); k = 0.054054 * inBounds(s); c += texture(uSceneColorMap, s).rgb * k; wsum += k;
  return c / max(wsum, 1e-4);
}

void main(void) {
  vec2 uv = gl_FragCoord.xy * uScreenSize.zw;
  vec2 px = uScreenSize.zw * uBlurRadius;
  // Chromatic aberration: blur each channel at a slightly offset base UV. R
  // and B shift radially in opposite directions; G stays centered. Since all
  // three reads are blurred (not sharp), there's no fringing when uChroma = 0
  // — the offset just collapses and all three sample the same place.
  vec2 dir = uv - vec2(0.5);
  vec2 off = dir * uChroma;
  vec3 cR = blur9(uv + off, px);
  vec3 cG = blur9(uv, px);
  vec3 cB = blur9(uv - off, px);
  vec3 impaired = vec3(cR.r, cG.g, cB.b);
  vec3 sharp = texture(uSceneColorMap, uv).rgb;
  vec3 base = mix(sharp, impaired, uStrength);

  // Radial halo: pixels near the sun's screen-space position wash toward
  // white. Falloff radius is in UV space (~25 % of the shorter screen
  // axis).
  vec2 toSun = uv - uSunUV;
  float distToSun = length(toSun);
  float halo = smoothstep(0.25, 0.0, distToSun);

  // God rays: angular streaks radiating from the sun. A high-frequency
  // sin in the polar angle gives spokes; raising to a power sharpens
  // the streaks so they read as discrete rays instead of a smooth
  // gradient. Modulated by distance so they fade close to the disc
  // and out at the band edge.
  float angle = atan(toSun.y, toSun.x);
  float spokes = pow(0.5 + 0.5 * sin(angle * 11.0), 6.0);
  float rayBand = smoothstep(0.45, 0.05, distToSun)
                * smoothstep(0.0, 0.03, distToSun);
  float rays = spokes * rayBand * 0.5;

  base = mix(base, vec3(1.0), uBlind * (halo + rays));
  pcFragColor0 = vec4(base, 1.0);
}
`

function setupImpairedVisionOverlay(app: pc.AppBase, cameraEntity: pc.Entity) {
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
  material.setParameter('uBlind', 0)
  material.setParameter('uSunUV', [10, 10]) // off-screen until sun is in view
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

  // Persistent scratch vec3s for the per-frame sun-projection calculation,
  // so onUpdate never allocates.
  const sunFar = SUN_DIRECTION.clone().mulScalar(10000)
  const sunScreen = new pc.Vec3()
  const sunUV: [number, number] = [10, 10]

  const startTime = performance.now() / 1000
  const onUpdate = () => {
    const t = Math.min(
      1,
      (performance.now() / 1000 - startTime) / IMPAIRED_FADE_IN_SEC,
    )
    // Blind ramps non-linearly across the full sun-in-view range so the
    // effect is subtle in passing glances and dramatic when the user is
    // staring straight into the sun. pow(smoothstep, 2) keeps the lower
    // half gentle and accelerates near the peak.
    const inView = sunInView(cameraEntity)
    const ramp = pc.math.smoothstep(0.5, 1.0, inView)
    material.setParameter('uBlind', ramp * ramp * 0.85)

    // Project the sun (at effective infinity along SUN_DIRECTION) into
    // screen UV. worldToScreen returns CSS-pixel Y-down coords (using
    // graphicsDevice.clientRect), so divide by clientRect dims — not the
    // DPR-scaled buffer dims — and flip Y for the shader which uses
    // gl_FragCoord (Y-up).
    if (cameraEntity.camera) {
      cameraEntity.camera.worldToScreen(sunFar, sunScreen)
      const { width: w, height: h } = app.graphicsDevice.clientRect
      sunUV[0] = sunScreen.x / w
      sunUV[1] = 1 - sunScreen.y / h
      material.setParameter('uSunUV', sunUV)
    }
    material.setParameter('uStrength', t)
  }
  app.on('update', onUpdate)

  return { entity, onUpdate }
}

// Each Hoya product is the same shader with a different uniform profile.
// `power` controls how strongly the progressive zoom diverges from neutral.
// `centerY` places the no-distortion zone on the lens (0 = top, 1 = bottom).
// `sensity` marks the lens as photochromic so the per-frame update tick
// pushes a darkness uniform to it.
export type LensProduct =
  | 'iD MyStyle 3'
  | 'iD WorkStyle 3'
  | 'iD LifeStyle 3'
  | 'Sensity'

interface LensProductProfile {
  power: number
  centerY: number
  sensity: boolean
}

const LENS_PRODUCTS: Record<LensProduct, LensProductProfile> = {
  // Hero. Near-flat clarity across the lens — almost no swim.
  'iD MyStyle 3': { power: 0.02, centerY: 0.5, sensity: false },
  // Mid-tier. Strong visible swim so the customer feels the gap to MyStyle.
  'iD LifeStyle 3': { power: 0.35, centerY: 0.5, sensity: false },
  // Desk / screen. Sharp zone shifted way up so the intermediate band lands
  // in the upper-middle; distance (top of lens) is dramatically distorted.
  'iD WorkStyle 3': { power: 0.45, centerY: 0.2, sensity: false },
  // Photochromic. Same optical curve as MyStyle plus the darkness uniform.
  Sensity: { power: 0.02, centerY: 0.5, sensity: true },
}

export const LENS_PRODUCT_ORDER: LensProduct[] = [
  'iD MyStyle 3',
  'iD WorkStyle 3',
  'iD LifeStyle 3',
  'Sensity',
]

function applyProductUniforms(m: pc.ShaderMaterial, product: LensProduct) {
  const p = LENS_PRODUCTS[product]
  m.setParameter('uPower', p.power)
  m.setParameter('uCenterY', p.centerY)
  if (!p.sensity) m.setParameter('uSensityDarkness', 0)
}

function createLensMaterial(yMin: number, yMax: number): pc.ShaderMaterial {
  const m = new pc.ShaderMaterial({
    uniqueName: `progressive-lens-${yMin}-${yMax}`,
    vertexGLSL: VERTEX_GLSL,
    fragmentGLSL: FRAGMENT_GLSL,
    attributes: { vertex_position: pc.SEMANTIC_POSITION },
  })
  m.setParameter('uMinY', yMin)
  m.setParameter('uMaxY', yMax)
  m.setParameter('uSensityDarkness', 0)
  applyProductUniforms(m, 'iD MyStyle 3')
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

export interface ImpairedVisionController {
  destroy(): void
}

export type LensSide = 'left' | 'right'

export interface GlassesController {
  setLensProduct(side: LensSide, product: LensProduct): void
  destroy(): void
}

// Sets up the blurred / chromatic-aberration overlay that simulates needing
// glasses. Stays active for the whole session — putting on glasses doesn't
// remove the blur, it just locally corrects it within the lens geometry.
export function setupImpairedVision(
  app: pc.AppBase,
  cameraEntity: pc.Entity,
): ImpairedVisionController {
  if (cameraEntity.camera) cameraEntity.camera.renderSceneColorMap = true
  reorderLayersForGrab(app.scene.layers)
  const impaired = setupImpairedVisionOverlay(app, cameraEntity)
  return {
    destroy() {
      impaired.entity.destroy()
      app.off('update', impaired.onUpdate)
      if (cameraEntity.camera) cameraEntity.camera.renderSceneColorMap = false
    },
  }
}

// Sensity damping. Darkening is faster than clearing — matches the
// asymmetric behaviour of real photochromic lenses.
const SENSITY_DARKEN_TC = 1.2 // seconds to reach ~63 % of target when darkening
const SENSITY_CLEAR_TC = 3.0 // seconds to reach ~63 % of target when clearing

// Adds the lens + frame meshes as children of the camera. Each lens samples
// the pre-overlay scene grab so the area it covers reads back as sharp; the
// impaired overlay remains visible everywhere outside the lens geometry.
export async function setupLenses(
  app: pc.AppBase,
  cameraEntity: pc.Entity,
): Promise<GlassesController> {
  const assets = await Promise.all(
    SIDES.flatMap((s) => [
      loadAsset(app, s.lensFile, 'container', `${ASSETS_PATH}${s.lensFile}`),
      loadAsset(app, s.frameFile, 'container', `${ASSETS_PATH}${s.frameFile}`),
    ]),
  )

  const frameMat = createFrameMaterial()
  const glassesGroups: pc.Entity[] = []
  // Per-side: the lens entity (so we can enable / disable), the material (so
  // we can swap product uniforms), and the currently selected product (so
  // the Sensity tick knows whether to run).
  const sides = {
    left: null as null | {
      lens: pc.Entity
      material: pc.ShaderMaterial
      product: LensProduct
      sensityCurrent: number
    },
    right: null as null | {
      lens: pc.Entity
      material: pc.ShaderMaterial
      product: LensProduct
      sensityCurrent: number
    },
  }

  for (let i = 0; i < SIDES.length; i++) {
    const cfg = SIDES[i]
    const lensAsset = assets[i * 2]
    const frameAsset = assets[i * 2 + 1]

    const group = new pc.Entity(cfg.name)

    const lens = (
      lensAsset.resource as pc.ContainerResource
    ).instantiateRenderEntity()
    const { min, max } = localZRange(lens)
    const material = createLensMaterial(min, max)
    applyMaterial(lens, material)
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
    group.setLocalPosition(cfg.position)
    group.setLocalScale(LENS_SCALE)
    cameraEntity.addChild(group)
    glassesGroups.push(group)

    const key: LensSide = cfg.name === 'GlassesLeft' ? 'left' : 'right'
    sides[key] = {
      lens,
      material,
      product: 'iD MyStyle 3',
      sensityCurrent: 0,
    }
  }

  // Per-frame Sensity ramp. Early-out when neither eye has Sensity selected
  // so non-photochromic configurations cost nothing.
  const onUpdate = (dt: number) => {
    const left = sides.left
    const right = sides.right
    if (!left || !right) return
    if (left.product !== 'Sensity' && right.product !== 'Sensity') return

    // Wide activation so the lens already shows a clear tint during
    // normal forward gameplay (camera dot ~0.78), and reaches full
    // darkness when the customer looks straight at the sun.
    const target = pc.math.smoothstep(0.4, 0.95, sunInView(cameraEntity))

    for (const s of [left, right]) {
      if (s.product !== 'Sensity') continue
      const tc =
        target > s.sensityCurrent ? SENSITY_DARKEN_TC : SENSITY_CLEAR_TC
      s.sensityCurrent += (target - s.sensityCurrent) * (dt / tc)
      s.material.setParameter('uSensityDarkness', s.sensityCurrent)
    }
  }
  app.on('update', onUpdate)

  return {
    setLensProduct(side, product) {
      const s = sides[side]
      if (!s || s.product === product) return
      s.product = product
      applyProductUniforms(s.material, product)
      // Reset Sensity ramp when switching to / from photochromic so leftover
      // darkness from a previous Sensity session doesn't bleed into MyStyle.
      if (product !== 'Sensity') {
        s.sensityCurrent = 0
        s.material.setParameter('uSensityDarkness', 0)
      }
    },
    destroy() {
      app.off('update', onUpdate)
      for (const g of glassesGroups) g.destroy()
    },
  }
}
