import * as THREE from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

// ── Constants ────────────────────────────────────────────────────────

// Lens positioning
export const LENS_SCALE = { x: 0.1125, y: 0.1125, z: 0.1875 }
export const LENS_POSITION = { leftX: -0.2625, rightX: 0.2625, z: -0.4875 }

// Swap animation
export const SWAP_LERP_SPEED = 0.08
export const SWAP_SNAP_THRESHOLD = 0.001
export const SWAP_HIDDEN_Y = -0.6
export const SWAP_VISIBLE_Y = 0.6
export const SWAP_SHOWN_Y = 0

// Gradient canvas
export const GRADIENT_SIZE = 256

// ── Type-safe animation state ────────────────────────────────────────

interface SwapAnimation {
  targetY: number
  animating: boolean
}

const animationState = new Map<THREE.Group, SwapAnimation>()

function getAnimation(group: THREE.Group): SwapAnimation {
  let state = animationState.get(group)
  if (!state) {
    state = { targetY: group.position.y, animating: false }
    animationState.set(group, state)
  }
  return state
}

// ── Assets ───────────────────────────────────────────────────────────

const ASSETS_PATH = `${import.meta.env.BASE_URL}assets/glasses/`

const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath(
  'https://www.gstatic.com/draco/versioned/decoders/1.5.7/',
)

const loader = new GLTFLoader()
loader.setDRACOLoader(dracoLoader)
const textureLoader = new THREE.TextureLoader()

function loadGLB(path: string): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    loader.load(
      ASSETS_PATH + path,
      (gltf) => resolve(gltf.scene),
      undefined,
      reject,
    )
  })
}

function loadTexture(path: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    textureLoader.load(ASSETS_PATH + path, resolve, undefined, reject)
  })
}

// ── Material factories ───────────────────────────────────────────────

export function createFrameMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    roughness: 0.1,
    metalness: 0.0,
  })
}

export function createMaskMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#a7a7a7'),
    transmission: 0.95,
    thickness: 0.0,
    roughness: 0.4,
    ior: 1.3,
    transparent: true,
  })
}

export function createLeftLensMaterial(
  map: THREE.Texture,
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    transmission: 1,
    thickness: 0,
    ior: 1.11,
    roughness: 1,
    thicknessMap: map,
    roughnessMap: map,
    transparent: true,
    opacity: 1,
  })
}

export function createGradientCanvas(): {
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
} {
  const canvas = document.createElement('canvas')
  canvas.width = GRADIENT_SIZE
  canvas.height = GRADIENT_SIZE

  const ctx = canvas.getContext('2d')
  if (ctx) {
    const offset = -GRADIENT_SIZE * 0.2
    const g = ctx.createLinearGradient(offset, 0, GRADIENT_SIZE + offset, 0)
    g.addColorStop(0, '#fff')
    g.addColorStop(0.45, '#000')
    g.addColorStop(0.55, '#000')
    g.addColorStop(1, '#fff')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, GRADIENT_SIZE, GRADIENT_SIZE)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping

  return { canvas, texture }
}

export function createRightLensMaterial(
  gradTex: THREE.CanvasTexture,
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#ffffff'),
    transmission: 1,
    thickness: 0.5,
    ior: 1.15,
    roughness: 2,
    thicknessMap: gradTex,
    roughnessMap: gradTex,
    transparent: true,
    opacity: 1,
  })
}

// ── Mesh helpers ─────────────────────────────────────────────────────

function applyMaterial(obj: THREE.Object3D, mat: THREE.Material) {
  obj.traverse((c) => {
    if (c instanceof THREE.Mesh) c.material = mat
  })
}

// ── Lens group builders ──────────────────────────────────────────────

interface LeftLensGroupResult {
  group: THREE.Group
  lensAMesh: THREE.Object3D
  lensBMesh: THREE.Object3D
}

function buildLeftLensGroup(
  lensGeometry: THREE.Group,
  frameGeometry: THREE.Group,
  blankGeometry: THREE.Group,
  mapA: THREE.Texture,
  mapB: THREE.Texture,
): LeftLensGroupResult {
  const matA = createLeftLensMaterial(mapA)
  const matB = createLeftLensMaterial(mapB)
  matB.opacity = 0

  const lensAMesh = lensGeometry.clone()
  const lensBMesh = lensGeometry.clone()
  applyMaterial(lensAMesh, matA)
  applyMaterial(lensBMesh, matB)

  const frame = frameGeometry.clone(true)
  frame.position.set(0.01, 0, 0.01)
  applyMaterial(frame, createFrameMaterial())

  const blank = blankGeometry.clone(true)
  applyMaterial(blank, createMaskMaterial())

  const group = new THREE.Group()
  group.add(lensAMesh, lensBMesh, frame, blank)
  group.scale.set(LENS_SCALE.x, LENS_SCALE.y, LENS_SCALE.z)
  group.position.set(LENS_POSITION.leftX, 0, LENS_POSITION.z)

  return { group, lensAMesh, lensBMesh }
}

interface RightLensGroupResult {
  group: THREE.Group
  gradCanvas: HTMLCanvasElement
  gradTex: THREE.CanvasTexture
}

function buildRightLensGroup(
  lensGeometry: THREE.Group,
  frameGeometry: THREE.Group,
  blankGeometry: THREE.Group,
): RightLensGroupResult {
  const { canvas: gradCanvas, texture: gradTex } = createGradientCanvas()

  const rightMat = createRightLensMaterial(gradTex)
  applyMaterial(lensGeometry, rightMat)

  const frame = frameGeometry.clone(true)
  applyMaterial(frame, createFrameMaterial())

  const blank = blankGeometry.clone(true)
  applyMaterial(blank, createMaskMaterial())

  const group = new THREE.Group()
  group.add(lensGeometry, frame, blank)
  group.scale.set(LENS_SCALE.x, LENS_SCALE.y, LENS_SCALE.z)
  group.position.set(LENS_POSITION.rightX, 0, LENS_POSITION.z)

  return { group, gradCanvas, gradTex }
}

// ── Public API ───────────────────────────────────────────────────────

export interface GlassesState {
  leftGroup: THREE.Group
  rightGroup: THREE.Group
  leftGroupAlt: THREE.Group
  rightGroupAlt: THREE.Group
  update: (polarAngle: number, minPolar: number, maxPolar: number) => void
  swapLeft: () => void
  swapRight: () => void
  animateSwap: () => void
  dispose: () => void
}

interface LensRefs {
  lensAMesh: THREE.Object3D | null
  lensBMesh: THREE.Object3D | null
  gradCanvas: HTMLCanvasElement | null
  gradTex: THREE.CanvasTexture | null
}

export async function loadGlasses(camera: THREE.Camera): Promise<GlassesState> {
  const refs: LensRefs = {
    lensAMesh: null,
    lensBMesh: null,
    gradCanvas: null,
    gradTex: null,
  }

  const [mapA, mapB] = await Promise.all([
    loadTexture('lens_left_map.png'),
    loadTexture('lens_left_map_invert.png'),
  ])
  mapA.colorSpace = THREE.SRGBColorSpace
  mapB.colorSpace = THREE.SRGBColorSpace

  const [
    lensLeft,
    lensLeftFar,
    lensRight,
    lensRight02,
    frameLeft,
    frameRight,
    blankL,
    blankR,
  ] = await Promise.all([
    loadGLB('lens_left.glb'),
    loadGLB('lens_left_far.glb'),
    loadGLB('lens_right.glb'),
    loadGLB('lens_right_02.glb'),
    loadGLB('lens_frame_left.glb'),
    loadGLB('lens_frame_right.glb'),
    loadGLB('blank_l.glb'),
    loadGLB('blank_r.glb'),
  ])

  // Primary left
  const primary = buildLeftLensGroup(lensLeft, frameLeft, blankL, mapA, mapB)
  const leftGroup = primary.group
  refs.lensAMesh = primary.lensAMesh
  refs.lensBMesh = primary.lensBMesh

  // Alternate left
  const alt = buildLeftLensGroup(lensLeftFar, frameLeft, blankL, mapA, mapB)
  const leftGroupAlt = alt.group
  leftGroupAlt.position.y = SWAP_HIDDEN_Y

  // Primary right
  const primaryRight = buildRightLensGroup(lensRight, frameRight, blankR)
  const rightGroup = primaryRight.group
  refs.gradCanvas = primaryRight.gradCanvas
  refs.gradTex = primaryRight.gradTex

  // Alternate right
  const altRight = buildRightLensGroup(lensRight02, frameRight, blankR)
  const rightGroupAlt = altRight.group
  rightGroupAlt.position.y = SWAP_HIDDEN_Y

  camera.add(leftGroup, rightGroup, leftGroupAlt, rightGroupAlt)

  let leftSwapped = false
  let rightSwapped = false

  function update(polarAngle: number, minPolar: number, maxPolar: number) {
    if (refs.gradCanvas && refs.gradTex) {
      const offset = THREE.MathUtils.mapLinear(
        polarAngle,
        minPolar,
        maxPolar,
        -GRADIENT_SIZE * 0.3,
        GRADIENT_SIZE * 0.02,
      )
      const ctx = refs.gradCanvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, GRADIENT_SIZE, GRADIENT_SIZE)
        const grd = ctx.createLinearGradient(
          offset,
          0,
          GRADIENT_SIZE + offset,
          0,
        )
        grd.addColorStop(0, '#fff')
        grd.addColorStop(0.35, '#000')
        grd.addColorStop(0.55, '#000')
        grd.addColorStop(1, '#fff')
        ctx.fillStyle = grd
        ctx.fillRect(0, 0, GRADIENT_SIZE, GRADIENT_SIZE)
        refs.gradTex.needsUpdate = true
      }
    }

    if (refs.lensAMesh && refs.lensBMesh) {
      const neutral = Math.PI / 2
      const delta = neutral - polarAngle
      const t = THREE.MathUtils.smoothstep(delta, 0, Math.PI / 180)
      const eased = 1 - (1 - t) ** 3
      refs.lensAMesh.traverse((c) => {
        if (c instanceof THREE.Mesh)
          (c.material as THREE.MeshPhysicalMaterial).opacity = 1 - eased
      })
      refs.lensBMesh.traverse((c) => {
        if (c instanceof THREE.Mesh)
          (c.material as THREE.MeshPhysicalMaterial).opacity = eased
      })
    }
  }

  function swapLeft() {
    leftSwapped = !leftSwapped
    const anim = getAnimation(leftGroup)
    anim.targetY = leftSwapped ? SWAP_VISIBLE_Y : SWAP_SHOWN_Y
    anim.animating = true
    const altAnim = getAnimation(leftGroupAlt)
    altAnim.targetY = leftSwapped ? SWAP_SHOWN_Y : SWAP_HIDDEN_Y
    altAnim.animating = true
  }

  function swapRight() {
    rightSwapped = !rightSwapped
    const anim = getAnimation(rightGroup)
    anim.targetY = rightSwapped ? SWAP_VISIBLE_Y : SWAP_SHOWN_Y
    anim.animating = true
    const altAnim = getAnimation(rightGroupAlt)
    altAnim.targetY = rightSwapped ? SWAP_SHOWN_Y : SWAP_HIDDEN_Y
    altAnim.animating = true
  }

  function animateSwap() {
    const groups = [leftGroup, rightGroup, leftGroupAlt, rightGroupAlt]
    for (const group of groups) {
      const anim = getAnimation(group)
      if (anim.animating) {
        group.position.y += (anim.targetY - group.position.y) * SWAP_LERP_SPEED
        if (Math.abs(group.position.y - anim.targetY) < SWAP_SNAP_THRESHOLD) {
          group.position.y = anim.targetY
          anim.animating = false
        }
      }
    }
  }

  function dispose() {
    camera.remove(leftGroup, rightGroup, leftGroupAlt, rightGroupAlt)
    animationState.delete(leftGroup)
    animationState.delete(rightGroup)
    animationState.delete(leftGroupAlt)
    animationState.delete(rightGroupAlt)
    mapA.dispose()
    mapB.dispose()
    refs.gradTex?.dispose()
  }

  return {
    leftGroup,
    rightGroup,
    leftGroupAlt,
    rightGroupAlt,
    update,
    swapLeft,
    swapRight,
    animateSwap,
    dispose,
  }
}
