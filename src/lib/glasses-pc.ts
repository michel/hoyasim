import * as pc from 'playcanvas'
import {
  createEntrance,
  createTraceUpdate,
  ENTRANCE_DROP,
  startTrace,
} from './glasses-anim'
import { LENS_FRAGMENT_GLSL, LENS_VERTEX_GLSL } from './glasses-shaders'
import { renderComponents } from './pc-utils'
import { notifyTuning, onTuningChange, tuning } from './tuning'

// Origin-prefixed on purpose: AssetRegistry prepends assets.prefix (the
// playcanvas project path) to any URL its ABSOLUTE_URL regex doesn't match,
// and a root-relative path doesn't match. The full origin keeps these URLs
// out of that rewrite.
const ASSETS_PATH = `${window.location.origin}${import.meta.env.BASE_URL}assets/glasses/`

// Touch runs a narrower camera FOV (playcanvasApp TOUCH_FOV) so the cockpit
// reads larger; the glasses shrink by the inverse so their outline still fits
// the screen — the phones grow, the frame does not.
const TOUCH_LENS_FACTOR = pc.platform.touch ? 0.7 : 1
const LENS_SCALE_MULT = 1.08 * TOUCH_LENS_FACTOR
const LENS_SCALE = new pc.Vec3(
  0.16875 * LENS_SCALE_MULT,
  0.16875 * LENS_SCALE_MULT,
  0.28125 * LENS_SCALE_MULT,
)
// Spread the lenses outward so the glasses frame each eye with a clear bridge
// between, rather than crowding the centre of the screen.
const LENS_X = 0.39375 * TOUCH_LENS_FACTOR
const LENS_LEFT_POS = new pc.Vec3(-LENS_X, 0, -0.4875)
const LENS_RIGHT_POS = new pc.Vec3(LENS_X, 0, -0.4875)

type AssetType = ConstructorParameters<typeof pc.Asset>[1]

// Reuses a registry asset when one exists (e.g. glasses taken off and put back
// on), so repeat setups don't re-fetch, re-parse, or leak duplicate assets.
function loadAsset(
  app: pc.AppBase,
  name: string,
  type: AssetType,
  url: string,
): Promise<pc.Asset> {
  return new Promise((resolve, reject) => {
    const found = app.assets.find(name, type)
    // A failed load leaves an asset `loaded` with a null resource; drop it so a
    // retry re-fetches instead of resolving to a dead asset.
    if (found?.loaded && !found.resource) app.assets.remove(found)
    const existing = found && (!found.loaded || found.resource) ? found : null
    const asset = existing ?? new pc.Asset(name, type, { url })
    if (asset.loaded) return resolve(asset)
    asset.once('load', () => resolve(asset))
    asset.once('error', (err: unknown) => reject(new Error(String(err))))
    if (!existing) app.assets.add(asset)
    app.assets.load(asset)
  })
}

// Each product is the same lens shader with its own soft-zone profile AND its
// own corridor: the lens heights where the distance lens hands over to the
// reading lens. The corridor is the tier story in the customer's v01 profiles
// — MySense blends over almost half the lens, Balansis switches abruptly —
// while the wings (two lower corners) widen as the tier drops.
export type LensProduct = 'Balansis' | 'MySelf Profile' | 'MySense'

export interface LensProductProfile {
  cornerWidth: number
  cornerHeight: number
  feather: number
  corridorTop: number
  corridorBottom: number
}

// The customer's v01 profiles (2026-09-11). Live-adjustable per product from
// the tuning panel (setProductProfile); DEFAULT_LENS_PRODUCTS is the shipped
// look.
const DEFAULT_LENS_PRODUCTS: Record<LensProduct, LensProductProfile> = {
  // Entry: largest soft corners, near-instant corridor.
  Balansis: {
    cornerWidth: 0.26,
    cornerHeight: 0.52,
    feather: 0.12,
    corridorTop: 0.52,
    corridorBottom: 0.54,
  },
  // Mid: moderate corners, short corridor.
  'MySelf Profile': {
    cornerWidth: 0.2,
    cornerHeight: 0.45,
    feather: 0.12,
    corridorTop: 0.5,
    corridorBottom: 0.6,
  },
  // Premium: smallest soft corners, longest and smoothest corridor.
  MySense: {
    cornerWidth: 0.13,
    cornerHeight: 0.36,
    feather: 0.12,
    corridorTop: 0.47,
    corridorBottom: 0.84,
  },
}

export const LENS_PRODUCTS: Record<LensProduct, LensProductProfile> =
  structuredClone(DEFAULT_LENS_PRODUCTS)

export function setProductProfile(
  product: LensProduct,
  patch: Partial<LensProductProfile>,
) {
  Object.assign(LENS_PRODUCTS[product], patch)
  notifyTuning()
}

export function resetProductProfiles() {
  Object.assign(LENS_PRODUCTS, structuredClone(DEFAULT_LENS_PRODUCTS))
  notifyTuning()
}

export const LENS_PRODUCT_ORDER: LensProduct[] = [
  'MySense',
  'Balansis',
  'MySelf Profile',
]

// Every fresh controller (and the UI mirroring it) starts both eyes here.
export const DEFAULT_LENS_PRODUCT: LensProduct = LENS_PRODUCT_ORDER[0]

function applyProductUniforms(m: pc.ShaderMaterial, product: LensProduct) {
  const p = LENS_PRODUCTS[product]
  m.setParameter('uCornerWidth', p.cornerWidth)
  m.setParameter('uCornerHeight', p.cornerHeight)
  m.setParameter('uFeather', p.feather)
  m.setParameter('uCorridorTop', p.corridorTop)
  m.setParameter('uCorridorBottom', p.corridorBottom)
}

function applyTuning(m: pc.ShaderMaterial) {
  m.setParameter('uTopStrength', tuning.topStrengthPx)
  m.setParameter('uTopNearLimit', tuning.topNearLimit)
  m.setParameter('uTopTransition', tuning.topTransition)
  m.setParameter('uBottomStrength', tuning.bottomStrengthPx)
  m.setParameter('uBottomFarLimit', tuning.bottomFarLimit)
  m.setParameter('uBottomTransition', tuning.bottomTransition)
  m.setParameter('uSoftZoneBlurMax', tuning.softZoneBlurMaxPx)
}

function createLensMaterial(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  pxScale: number,
): pc.ShaderMaterial {
  const m = new pc.ShaderMaterial({
    uniqueName: `progressive-lens-${xMin}-${xMax}-${yMin}-${yMax}`,
    vertexGLSL: LENS_VERTEX_GLSL,
    fragmentGLSL: LENS_FRAGMENT_GLSL,
    attributes: { vertex_position: pc.SEMANTIC_POSITION },
  })
  m.setParameter('uMinX', xMin)
  m.setParameter('uMaxX', xMax)
  m.setParameter('uMinY', yMin)
  m.setParameter('uMaxY', yMax)
  m.setParameter('uPxScale', pxScale)
  m.setParameter('uLineTrace', 0)
  m.setParameter('uLineFade', 0)
  applyTuning(m)
  applyProductUniforms(m, DEFAULT_LENS_PRODUCT)
  // Transparent so the lens renders AFTER the scene-color grab pass and can
  // sample uSceneColorMap.
  m.blendType = pc.BLEND_NORMAL
  m.depthWrite = false
  // Never depth-test against the world: the glasses sit on the face, so nothing
  // in the scene can come between the eye and the lens — yet the handlebar and
  // phones, closer than the lens plane when you look down or sideways, poked
  // through and left hard-edged patches of the impaired overlay in the lens.
  m.depthTest = false
  m.update()
  return m
}

export type LensSide = 'left' | 'right'

interface SideConfig {
  side: LensSide
  name: string
  lensFile: string
  position: pc.Vec3
}

const SIDES: SideConfig[] = [
  {
    side: 'left',
    name: 'GlassesLeft',
    lensFile: 'lens_left.glb',
    position: LENS_LEFT_POS,
  },
  {
    side: 'right',
    name: 'GlassesRight',
    lensFile: 'lens_right.glb',
    position: LENS_RIGHT_POS,
  },
]

export interface GlassesController {
  setLensProduct(side: LensSide, product: LensProduct): void
  // Slides the glasses down from above into their rest position. Resolves once
  // the drop has settled, so the caller can reveal the lens controls after.
  playPutOnAnimation(): Promise<void>
  destroy(): void
}

export interface SideState {
  material: pc.ShaderMaterial
  product: LensProduct
  // Seconds since the boundary-line trace started, or null when idle.
  traceElapsed: number | null
}

interface BuiltSide {
  group: pc.Entity
  finalPosition: pc.Vec3
  side: LensSide
  state: SideState
}

// Instantiates one lens group as a child of the camera, dropped above its rest
// position so the entrance can slide it down.
function buildSide(
  cfg: SideConfig,
  lensAsset: pc.Asset,
  cameraEntity: pc.Entity,
  pxScale: number,
): BuiltSide {
  const group = new pc.Entity(cfg.name)

  const lens = (
    lensAsset.resource as pc.ContainerResource
  ).instantiateRenderEntity()
  // Each lens GLB is a single node / mesh / primitive: one render component,
  // one mesh instance is the whole lens.
  const render = renderComponents(lens)[0]
  const mi = render.meshInstances[0]
  // Planar bounds of the lens mesh in its own local space. x is the lens's
  // horizontal axis, z its vertical axis (y is the thin depth/normal).
  // Anchoring the soft zone to these bounds keeps its corners a fixed
  // fraction of the lens at any window size or aspect ratio — the screen
  // projection no longer matters.
  const { center, halfExtents } = mi.mesh.aabb
  const material = createLensMaterial(
    center.x - halfExtents.x,
    center.x + halfExtents.x,
    center.z - halfExtents.z,
    center.z + halfExtents.z,
    pxScale,
  )
  // Material per mesh instance, not render.material: that setter is a no-op
  // for 'asset'-type renders. Assign it before the layer — the layer's
  // opaque/transparent split reads the mesh instance's material.
  mi.material = material
  render.layers = [pc.LAYERID_IMMEDIATE]

  group.addChild(lens)
  // Start dropped above the rest position; playPutOnAnimation slides it down.
  group.setLocalPosition(
    cfg.position.x,
    cfg.position.y + ENTRANCE_DROP,
    cfg.position.z,
  )
  group.setLocalScale(LENS_SCALE)
  cameraEntity.addChild(group)

  return {
    group,
    finalPosition: cfg.position,
    side: cfg.side,
    state: {
      material,
      product: DEFAULT_LENS_PRODUCT,
      traceElapsed: null,
    },
  }
}

// Adds the lens meshes as children of the camera. Each lens samples
// the pre-overlay scene grab so the area it covers reads back as sharp; the
// impaired overlay remains visible everywhere outside the lens geometry.
export async function setupLenses(
  app: pc.AppBase,
  cameraEntity: pc.Entity,
): Promise<GlassesController> {
  const lensAssets = await Promise.all(
    SIDES.map((s) =>
      loadAsset(app, s.lensFile, 'container', `${ASSETS_PATH}${s.lensFile}`),
    ),
  )

  // The lens shader blurs by defocus, so it needs the engine's scene depth
  // grab (a full-res depth blit every frame) — only while the glasses are on.
  const cam = cameraEntity.camera
  if (cam) cam.renderSceneDepthMap = true
  const pxScale = app.graphicsDevice.maxPixelRatio
  const built = SIDES.map((cfg, i) =>
    buildSide(cfg, lensAssets[i], cameraEntity, pxScale),
  )
  const glassesGroups = built.map((b) => b.group)
  // Rest position per group, captured so the entrance animation can lerp the
  // groups back down to it from their dropped start.
  const finalPositions = built.map((b) => b.finalPosition)
  const sides: Record<LensSide, SideState | null> = { left: null, right: null }
  for (const b of built) sides[b.side] = b.state

  const onUpdate = createTraceUpdate(sides)
  app.on('update', onUpdate)
  const offTuning = onTuningChange(() => {
    for (const s of [sides.left, sides.right]) {
      if (!s) continue
      applyTuning(s.material)
      applyProductUniforms(s.material, s.product)
    }
  })

  const entrance = createEntrance(app, glassesGroups, finalPositions, () => {
    // Trace both lenses' boundaries once they've settled, so the customer sees
    // each clear field the moment the glasses land.
    startTrace(sides.left)
    startTrace(sides.right)
  })

  return {
    playPutOnAnimation: entrance.play,
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
      offTuning()
      entrance.cancel()
      for (const g of glassesGroups) g.destroy()
      if (cam) cam.renderSceneDepthMap = false
    },
  }
}
