import * as pc from 'playcanvas'
import {
  createEntrance,
  createTraceUpdate,
  ENTRANCE_DROP,
  startTrace,
} from './glasses-anim'
import { LENS_VERTEX_GLSL, lensFragmentGLSL } from './glasses-shaders'
import { blurPixelScale, renderComponents } from './pc-utils'

// Origin-prefixed on purpose: AssetRegistry prepends assets.prefix (the
// playcanvas project path) to any URL its ABSOLUTE_URL regex doesn't match,
// and a root-relative path doesn't match. The full origin keeps these URLs
// out of that rewrite.
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

// Max soft-zone blur radius in pixels. Demo-exaggerated so the tier difference
// reads on a phone, but capped below the uncorrected overlay (16px) so the
// periphery looks "soft" rather than "blind".
const SOFT_ZONE_BLUR_MAX_PX = 12.0

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

function applyMaterial(entity: pc.Entity, material: pc.Material) {
  for (const r of renderComponents(entity))
    for (const mi of r.meshInstances) mi.material = material
}

function setLayer(entity: pc.Entity, layerId: number) {
  for (const r of renderComponents(entity)) r.layers = [layerId]
}

// Planar bounds of the lens mesh in its own local space. x is the lens's
// horizontal axis, z its vertical axis (y is the thin depth/normal). Anchoring
// the soft zone to these bounds keeps its corners a fixed fraction of the lens
// at any window size or aspect ratio — the screen projection no longer matters.
function localBounds(entity: pc.Entity): {
  xMin: number
  xMax: number
  zMin: number
  zMax: number
} {
  let xMin = Number.POSITIVE_INFINITY
  let xMax = Number.NEGATIVE_INFINITY
  let zMin = Number.POSITIVE_INFINITY
  let zMax = Number.NEGATIVE_INFINITY
  for (const r of renderComponents(entity)) {
    for (const mi of r.meshInstances) {
      const aabb = mi.mesh.aabb
      xMin = Math.min(xMin, aabb.center.x - aabb.halfExtents.x)
      xMax = Math.max(xMax, aabb.center.x + aabb.halfExtents.x)
      zMin = Math.min(zMin, aabb.center.z - aabb.halfExtents.z)
      zMax = Math.max(zMax, aabb.center.z + aabb.halfExtents.z)
    }
  }
  return { xMin, xMax, zMin, zMax }
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
  // Entry: largest soft corners, narrowest clear field.
  Balansis: { cornerWidth: 0.35, cornerHeight: 0.7, feather: 0.07 },
  // Mid: moderate corners.
  'MySelf Profile': { cornerWidth: 0.27, cornerHeight: 0.62, feather: 0.07 },
  // Premium: smallest soft corners, widest clear field.
  MySense: { cornerWidth: 0.18, cornerHeight: 0.5, feather: 0.07 },
}

export const LENS_PRODUCT_ORDER: LensProduct[] = [
  'Balansis',
  'MySelf Profile',
  'MySense',
]

// Every fresh controller (and the UI mirroring it) starts both eyes here.
export const DEFAULT_LENS_PRODUCT: LensProduct = LENS_PRODUCT_ORDER[0]

function applyProductUniforms(m: pc.ShaderMaterial, product: LensProduct) {
  const p = LENS_PRODUCTS[product]
  m.setParameter('uCornerWidth', p.cornerWidth)
  m.setParameter('uCornerHeight', p.cornerHeight)
  m.setParameter('uFeather', p.feather)
}

function createLensMaterial(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  blurScale: number,
): pc.ShaderMaterial {
  const m = new pc.ShaderMaterial({
    uniqueName: `progressive-lens-${xMin}-${xMax}-${yMin}-${yMax}`,
    vertexGLSL: LENS_VERTEX_GLSL,
    fragmentGLSL: lensFragmentGLSL(pc.platform.touch ? 8 : 16),
    attributes: { vertex_position: pc.SEMANTIC_POSITION },
  })
  m.setParameter('uMinX', xMin)
  m.setParameter('uMaxX', xMax)
  m.setParameter('uMinY', yMin)
  m.setParameter('uMaxY', yMax)
  m.setParameter('uBlurMax', SOFT_ZONE_BLUR_MAX_PX * blurScale)
  m.setParameter('uLineTrace', 0)
  m.setParameter('uLineFade', 0)
  // Overwritten every frame by createLensCenterUpdate; a sane default covers
  // the frames before the first update.
  m.setParameter('uLensCenter', [0.5, 0.5])
  applyProductUniforms(m, DEFAULT_LENS_PRODUCT)
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

export type LensSide = 'left' | 'right'

interface SideConfig {
  side: LensSide
  name: string
  lensFile: string
  frameFile: string
  position: pc.Vec3
}

const SIDES: SideConfig[] = [
  {
    side: 'left',
    name: 'GlassesLeft',
    lensFile: 'lens_left.glb',
    frameFile: 'lens_frame_left.glb',
    position: LENS_LEFT_POS,
  },
  {
    side: 'right',
    name: 'GlassesRight',
    lensFile: 'lens_right.glb',
    frameFile: 'lens_frame_right.glb',
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
  lens: pc.Entity
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

// Instantiates one lens + frame group as a child of the camera, dropped above
// its rest position so the entrance can slide it down.
function buildSide(
  cfg: SideConfig,
  lensAsset: pc.Asset,
  frameAsset: pc.Asset,
  frameMat: pc.Material,
  cameraEntity: pc.Entity,
  blurScale: number,
): BuiltSide {
  const group = new pc.Entity(cfg.name)

  const lens = (
    lensAsset.resource as pc.ContainerResource
  ).instantiateRenderEntity()
  const { xMin, xMax, zMin, zMax } = localBounds(lens)
  const material = createLensMaterial(xMin, xMax, zMin, zMax, blurScale)
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

  return {
    group,
    finalPosition: cfg.position,
    side: cfg.side,
    state: {
      lens,
      material,
      product: DEFAULT_LENS_PRODUCT,
      traceElapsed: null,
    },
  }
}

// Per-frame: project each lens mesh's world centre into screen UV and hand it
// to that lens's shader as uLensCenter — the point its multifocal displacement
// scales around. Projected every frame (not once) so it tracks the entrance
// drop, window resizes, and any camera/aspect change.
function createLensCenterUpdate(
  cameraEntity: pc.Entity,
  sides: Record<LensSide, SideState | null>,
) {
  const screen = new pc.Vec3()
  return () => {
    const cam = cameraEntity.camera
    if (!cam) return
    const canvas = cam.system.app.graphicsDevice.canvas
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return
    for (const s of [sides.left, sides.right]) {
      if (!s) continue
      const aabb = renderComponents(s.lens)[0]?.meshInstances[0]?.aabb
      if (!aabb) continue
      cam.worldToScreen(aabb.center, screen)
      // worldToScreen returns CSS pixels, y-down; gl_FragCoord UV is y-up.
      s.material.setParameter('uLensCenter', [screen.x / w, 1 - screen.y / h])
    }
  }
}

// Adds the lens + frame meshes as children of the camera. Each lens samples
// the pre-overlay scene grab so the area it covers reads back as sharp; the
// impaired overlay remains visible everywhere outside the lens geometry.
export async function setupLenses(
  app: pc.AppBase,
  cameraEntity: pc.Entity,
): Promise<GlassesController> {
  const sideAssets = await Promise.all(
    SIDES.map((s) =>
      Promise.all([
        loadAsset(app, s.lensFile, 'container', `${ASSETS_PATH}${s.lensFile}`),
        loadAsset(
          app,
          s.frameFile,
          'container',
          `${ASSETS_PATH}${s.frameFile}`,
        ),
      ]),
    ),
  )

  const frameMat = createFrameMaterial()
  const blurScale = blurPixelScale(app)
  const built = SIDES.map((cfg, i) =>
    buildSide(
      cfg,
      sideAssets[i][0],
      sideAssets[i][1],
      frameMat,
      cameraEntity,
      blurScale,
    ),
  )
  const glassesGroups = built.map((b) => b.group)
  // Rest position per group, captured so the entrance animation can lerp the
  // groups back down to it from their dropped start.
  const finalPositions = built.map((b) => b.finalPosition)
  const sides: Record<LensSide, SideState | null> = { left: null, right: null }
  for (const b of built) sides[b.side] = b.state

  const traceUpdate = createTraceUpdate(sides)
  const lensCenterUpdate = createLensCenterUpdate(cameraEntity, sides)
  const onUpdate = (dt: number) => {
    traceUpdate(dt)
    lensCenterUpdate()
  }
  app.on('update', onUpdate)

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
      entrance.cancel()
      for (const g of glassesGroups) g.destroy()
    },
  }
}
