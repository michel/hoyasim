import * as pc from 'playcanvas'

const ASSETS_PATH = `${window.location.origin}${import.meta.env.BASE_URL}assets/glasses/`

const LENS_SCALE_MULT = 1.08
const LENS_SCALE = new pc.Vec3(
  0.16875 * LENS_SCALE_MULT,
  0.16875 * LENS_SCALE_MULT,
  0.28125 * LENS_SCALE_MULT,
)
// Spread the lenses outward so the glasses frame each eye with a clear bridge
// between, rather than crowding the centre of the screen.
const LENS_X = 0.39375
const LENS_LEFT_POS = new pc.Vec3(-LENS_X, 0, -0.4875)
const LENS_RIGHT_POS = new pc.Vec3(LENS_X, 0, -0.4875)

const IMPAIRED_BLUR_RADIUS_PX = 16.0
const IMPAIRED_CHROMA_STRENGTH = 0.001
const IMPAIRED_FADE_IN_SEC = 1.0

// Premium progressive multifocal, shared by all three products. The soft-zone
// blur (not this curve) is what distinguishes Balansis / MySelf Profile /
// MySense from one another.
const MULTIFOCAL_POWER = 0.02
const MULTIFOCAL_CENTER_Y = 0.5

// Max soft-zone blur radius in pixels. Demo-exaggerated so the tier difference
// reads on a phone, but capped below the uncorrected overlay (16px) so the
// periphery looks "soft" rather than "blind".
const SOFT_ZONE_BLUR_MAX_PX = 12.0

// Boundary-line trace timing: sweep the dotted line on, hold, then fade out.
// Triggered on put-on (both eyes) and on every product switch (that eye).
const TRACE_IN_SEC = 0.55
const TRACE_HOLD_SEC = 0.7
const TRACE_OUT_SEC = 0.6

// "Putting on glasses" entrance. The glasses start this far above their rest
// position (in camera-local Y units, i.e. screen-vertical) and slide down into
// the eye line. ENTRANCE_OVERSHOOT controls the easeOutBack tension — the
// glasses dip slightly past rest and settle back, reading as a physical drop.
const ENTRANCE_DROP = 1.2
const ENTRANCE_DURATION = 0.6
const ENTRANCE_OVERSHOOT = 1.1

// easeOutBack: accelerates down, overshoots the target, then settles back to it
// exactly at t = 1 — the little bounce that sells the "drop into place" feel.
function easeOutBack(t: number): number {
  const c1 = ENTRANCE_OVERSHOOT
  const c3 = c1 + 1
  const p = t - 1
  return 1 + c3 * p * p * p + c1 * p * p
}

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

// The lens corrects the full-screen impaired blur within its geometry (sampling
// the pre-overlay scene grab) AND re-introduces a controlled peripheral blur in
// the two lower corners — the progressive "soft zone". The size of that soft
// zone is the only thing that differs between the three products.
const FRAGMENT_GLSL = `
precision highp float;
uniform sampler2D uSceneColorMap;
uniform vec4 uScreenSize;
uniform float uMinY;
uniform float uMaxY;
// Soft-zone geometry (mirror-symmetric lower corners), normalised screen space,
// y-up to match gl_FragCoord. innerX = 1.0 - uCornerWidth.
uniform float uCornerWidth;   // horizontal reach in from each side edge
uniform float uCornerHeight;  // vertical climb up from the bottom edge
uniform float uFeather;       // ramp width from sharp -> blurred
uniform float uBlurMax;       // max soft-zone blur radius, pixels
uniform float uLineTrace;     // 0..1 boundary-line reveal progress (sweeps the trace on)
uniform float uLineFade;      // 0..1 boundary-line opacity (handles the fade-out)
in vec3 vLocalPos;

const float POWER = ${MULTIFOCAL_POWER.toFixed(3)};
const float CENTER_Y = ${MULTIFOCAL_CENTER_Y.toFixed(3)};
const float LINE_LEVEL = 0.5;     // soft-zone contour the boundary line traces
const float LINE_HALF_PX = 2.5;        // line half-width in pixels
const float LINE_DASH_PERIOD_PX = 12.0; // dash + gap length along the line, pixels

// Weight a tap to 0 if its UV leaves [0,1] so edge texels aren't repeated into
// the kernel — that's what produces axis-aligned streaks near the boundary.
float inBounds(vec2 uv) {
  vec2 m = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return m.x * m.y;
}

// Constant-radius soft-focus blur (golden-angle / Vogel disk). The strength of
// the soft zone is varied by cross-fading sharp->blurred (see main), NOT by
// ramping this radius. A radius that ramps across the zone makes the fixed
// sample pattern's reach change along the boundary, which draws the iso-radius
// contour as a dotted line. Blurring at a constant radius — exactly how the
// artifact-free full-screen overlay works — keeps the boundary clean. center
// is the already-fetched sharp sample, reused as the centre tap.
vec3 softBlur(vec2 base, vec3 center) {
  vec2 r = uScreenSize.zw * uBlurMax;
  vec3 c = center;
  float w = 1.0;
  for (int i = 1; i <= 16; i++) {
    float fi = float(i);
    float ang = fi * 2.39996323;   // golden angle
    float rad = sqrt(fi / 16.0);   // even area coverage
    vec2 s = base + r * (rad * vec2(cos(ang), sin(ang)));
    float k = inBounds(s);
    c += texture(uSceneColorMap, s).rgb * k;
    w += k;
  }
  return c / w;
}

// Soft-zone blur amount [0,1] at a screen-space point (y-up). Sharp (0) across
// the clear field; ramps to 1 toward the two lower corners. Mirror-symmetric.
float softZone(vec2 uv) {
  float innerX = 1.0 - uCornerWidth;
  float xEnd = min(innerX + uFeather, 1.0);
  float yStart = max(uCornerHeight - uFeather, 0.0);
  // 1 at the bottom edge, ramping to 0 above the climb height. Edges are kept
  // in ascending order (smoothstep is undefined when edge0 >= edge1) and the
  // result inverted, so the ramp is well-defined on every driver.
  float ry = 1.0 - smoothstep(yStart, uCornerHeight, uv.y);
  float right = smoothstep(innerX, xEnd, uv.x) * ry;       // bottom-right corner
  float left = smoothstep(innerX, xEnd, 1.0 - uv.x) * ry;  // bottom-left corner
  return max(left, right);
}

void main(void) {
  vec2 screenUV = gl_FragCoord.xy * uScreenSize.zw;

  // vLocalPos.z is the lens GLB's vertical axis (0 = visual top, 1 = bottom).
  // Multifocal progressive: minify above the neutral band, magnify below it.
  float lensY = clamp((vLocalPos.z - uMinY) / (uMaxY - uMinY), 0.0, 1.0);
  float factor = (CENTER_Y - lensY) * 2.0 * POWER;

  vec2 center = vec2(0.5);
  // Per-axis tanh asymptote keeps the displaced sample inside [0.001, 0.999]
  // so minification at the corners never clamps into axis-aligned streaks.
  vec2 d = (screenUV - center) * (1.0 + factor);
  d.x = 0.499 * tanh(d.x / 0.499);
  d.y = 0.499 * tanh(d.y / 0.499);
  vec2 sampleUV = center + d;

  // Fade alpha to 0 before the displaced sample reaches the screen edge, so the
  // (blurred) underlying world shows through instead of a clamped streak.
  vec2 edgeDist = min(sampleUV, 1.0 - sampleUV);
  float minEdge = min(edgeDist.x, edgeDist.y);
  float alpha = smoothstep(0.0, 0.05, minEdge);

  sampleUV = clamp(sampleUV, vec2(0.001), vec2(0.999));

  // Peripheral soft-zone blur — the per-product differentiator. Cross-fade the
  // sharp sample toward a constant-radius blur by the soft-zone amount. No
  // branch and no radius ramp, so the boundary stays artifact-free: the field
  // is smooth, mix() is continuous, and blurAmt = 0 yields the sharp sample
  // exactly.
  float blurAmt = softZone(screenUV);
  vec3 sharp = texture(uSceneColorMap, sampleUV).rgb;
  vec3 color = mix(sharp, softBlur(sampleUV, sharp), blurAmt);

  // Boundary-line trace. Animated on put-on and on every product switch to show
  // where this product's clear field ends. uLineFade is a uniform, so this
  // branch is uniform across the whole draw (no divergent-quad artifacts). The
  // line is a thin, constant-width (fwidth) dotted contour at LINE_LEVEL, swept
  // on from the top of the zone downward by uLineTrace, then faded by uLineFade.
  if (uLineFade > 0.001) {
    float d = abs(blurAmt - LINE_LEVEL);
    float aa = max(fwidth(blurAmt) * LINE_HALF_PX, 1e-5);
    float core = 1.0 - smoothstep(0.0, aa, d);
    // Dash along the contour's tangent (perpendicular to the soft-zone gradient)
    // in pixel space, so dot spacing is uniform whether the boundary runs
    // horizontally, vertically, or diagonally — and isn't skewed by the screen
    // aspect ratio the way a normalised-UV stripe was.
    vec2 grad = vec2(dFdx(blurAmt), dFdy(blurAmt));
    vec2 tangent = normalize(vec2(-grad.y, grad.x) + vec2(1e-6));
    float along = dot(gl_FragCoord.xy, tangent);
    float dash = step(0.5, fract(along / LINE_DASH_PERIOD_PX));
    float thr = uCornerHeight * (1.0 - uLineTrace);
    float reveal = smoothstep(thr, thr + 0.03, screenUV.y);
    color = mix(color, vec3(1.0), core * dash * reveal * uLineFade);
  }

  pcFragColor0 = vec4(color, alpha);
}
`

const IMPAIRED_VERTEX_GLSL = `
in vec3 vertex_position;
void main(void) { gl_Position = vec4(vertex_position.xy, 0.0, 1.0); }
`

// Full-screen "uncorrected vision" overlay: blur + chromatic aberration. This
// is the world the lenses correct; it stays on for the whole session.
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
  pcFragColor0 = vec4(base, 1.0);
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
  const onUpdate = () => {
    const t = Math.min(
      1,
      (performance.now() / 1000 - startTime) / IMPAIRED_FADE_IN_SEC,
    )
    material.setParameter('uStrength', t)
  }
  app.on('update', onUpdate)

  return { entity, onUpdate }
}

// Each product is the same lens shader with a different soft-zone profile. The
// soft zone (two lower corners) widens as the tier drops: MySense barely blurs,
// Balansis blurs the most. All three share the premium multifocal curve above.
export type LensProduct = 'Balansis' | 'MySelf Profile' | 'MySense'

interface LensProductProfile {
  cornerWidth: number
  cornerHeight: number
  feather: number
}

// Starting values traced from the customer's renders (mirror-symmetric). Tune
// on device against the source images.
const LENS_PRODUCTS: Record<LensProduct, LensProductProfile> = {
  // Entry: largest soft corners, narrowest clear field (~76%).
  Balansis: { cornerWidth: 0.3, cornerHeight: 0.62, feather: 0.07 },
  // Mid: moderate corners (~86% clear).
  'MySelf Profile': { cornerWidth: 0.22, cornerHeight: 0.55, feather: 0.07 },
  // Premium: edge-hugging slivers, near edge-to-edge clarity (~99%).
  MySense: { cornerWidth: 0.14, cornerHeight: 0.45, feather: 0.07 },
}

export const LENS_PRODUCT_ORDER: LensProduct[] = [
  'Balansis',
  'MySelf Profile',
  'MySense',
]

function applyProductUniforms(m: pc.ShaderMaterial, product: LensProduct) {
  const p = LENS_PRODUCTS[product]
  m.setParameter('uCornerWidth', p.cornerWidth)
  m.setParameter('uCornerHeight', p.cornerHeight)
  m.setParameter('uFeather', p.feather)
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
  m.setParameter('uBlurMax', SOFT_ZONE_BLUR_MAX_PX)
  m.setParameter('uLineTrace', 0)
  m.setParameter('uLineFade', 0)
  applyProductUniforms(m, 'Balansis')
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
  // Slides the glasses down from above into their rest position. Resolves once
  // the drop has settled, so the caller can reveal the lens controls after.
  playPutOnAnimation(): Promise<void>
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
  const impaired = setupImpairedVisionOverlay(app)
  return {
    destroy() {
      impaired.entity.destroy()
      app.off('update', impaired.onUpdate)
      if (cameraEntity.camera) cameraEntity.camera.renderSceneColorMap = false
    },
  }
}

interface SideState {
  lens: pc.Entity
  material: pc.ShaderMaterial
  product: LensProduct
  // Seconds since the boundary-line trace started, or null when idle.
  traceElapsed: number | null
}

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
  // Rest position per group, captured so the entrance animation can lerp the
  // groups back down to it from their dropped start.
  const finalPositions: pc.Vec3[] = []
  const sides: Record<LensSide, SideState | null> = { left: null, right: null }

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
    // Start dropped above the rest position; playPutOnAnimation slides it down.
    group.setLocalPosition(
      cfg.position.x,
      cfg.position.y + ENTRANCE_DROP,
      cfg.position.z,
    )
    group.setLocalScale(LENS_SCALE)
    cameraEntity.addChild(group)
    glassesGroups.push(group)
    finalPositions.push(cfg.position)

    const key: LensSide = cfg.name === 'GlassesLeft' ? 'left' : 'right'
    sides[key] = { lens, material, product: 'Balansis', traceElapsed: null }
  }

  // Kick the boundary-line trace for a side (idempotent restart).
  const startTrace = (s: SideState | null) => {
    if (s) s.traceElapsed = 0
  }

  // Per-frame trace ramp: sweep the dotted line on, hold, fade out. Costs
  // nothing while idle (no trace pending on either eye).
  const onUpdate = (dt: number) => {
    if (sides.left?.traceElapsed == null && sides.right?.traceElapsed == null)
      return
    for (const s of [sides.left, sides.right]) {
      if (!s || s.traceElapsed == null) continue
      s.traceElapsed += dt
      const e = s.traceElapsed
      const trace = Math.min(1, e / TRACE_IN_SEC)
      let fade: number
      if (e < TRACE_IN_SEC + TRACE_HOLD_SEC) fade = 1
      else if (e < TRACE_IN_SEC + TRACE_HOLD_SEC + TRACE_OUT_SEC)
        fade = 1 - (e - TRACE_IN_SEC - TRACE_HOLD_SEC) / TRACE_OUT_SEC
      else {
        fade = 0
        s.traceElapsed = null
      }
      s.material.setParameter('uLineTrace', trace)
      s.material.setParameter('uLineFade', fade)
    }
  }
  app.on('update', onUpdate)

  // Drives the drop-into-place tween. Tracked so destroy() can detach it if the
  // glasses are torn down mid-animation.
  let entranceTick: ((dt: number) => void) | null = null
  const playPutOnAnimation = () =>
    new Promise<void>((resolve) => {
      let elapsed = 0
      entranceTick = (dt: number) => {
        elapsed += dt
        const t = Math.min(1, elapsed / ENTRANCE_DURATION)
        const offset = ENTRANCE_DROP * (1 - easeOutBack(t))
        for (let i = 0; i < glassesGroups.length; i++) {
          const f = finalPositions[i]
          glassesGroups[i].setLocalPosition(f.x, f.y + offset, f.z)
        }
        if (t < 1) return
        if (entranceTick) app.off('update', entranceTick)
        entranceTick = null
        // Trace both lenses' boundaries once they've settled, so the customer
        // sees each clear field the moment the glasses land.
        startTrace(sides.left)
        startTrace(sides.right)
        resolve()
      }
      app.on('update', entranceTick)
    })

  return {
    playPutOnAnimation,
    setLensProduct(side, product) {
      const s = sides[side]
      if (!s || s.product === product) return
      s.product = product
      applyProductUniforms(s.material, product)
      // Trace the new clear-field boundary so the difference is obvious.
      startTrace(s)
    },
    destroy() {
      app.off('update', onUpdate)
      if (entranceTick) app.off('update', entranceTick)
      for (const g of glassesGroups) g.destroy()
    },
  }
}
