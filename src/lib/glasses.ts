import * as THREE from 'three'
import { subscribe, toggle } from './debug'
import { gltfLoader, textureLoader } from './loaders'

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
export const PROGRESSIVE_POWER = 0.35

// ── Type-safe animation state ────────────────────────────────────────

interface SwapAnimation {
  targetY: number
  animating: boolean
}

const animationState = new WeakMap<THREE.Group, SwapAnimation>()

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

function loadGLB(path: string): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    gltfLoader.load(
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

// ── Shader helpers ──────────────────────────────────────────────────

function safeShaderReplace(
  shader: { fragmentShader: string },
  target: string,
  replacement: string,
  label: string,
): void {
  const before = shader.fragmentShader
  shader.fragmentShader = shader.fragmentShader.replace(target, replacement)
  if (before === shader.fragmentShader)
    throw new Error(
      `[${label}] shader replacement FAILED for "${target.slice(0, 40)}…" — Three.js version may have changed`,
    )
}

// ── Material factories ───────────────────────────────────────────────

export function createFrameMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x000000,
    roughness: 0.1,
    metalness: 0.0,
    transparent: true,
    depthWrite: true,
  })
}

export function createMaskMaterial(): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#a7a7a7'),
    transmission: 0.95,
    thickness: 0.0,
    roughness: 0.4,
    ior: 1.3,
    depthWrite: true,
  })
  mat.onBeforeCompile = (shader) => {
    safeShaderReplace(
      shader,
      '#include <opaque_fragment>',
      'gl_FragColor = vec4( outgoingLight, 1.0 );',
      'MASK',
    )
  }
  mat.customProgramCacheKey = () => 'mask-opaque-transmission'
  return mat
}

export function createLeftLensMaterial(
  map: THREE.Texture,
): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    transmission: 1,
    thickness: 0,
    ior: 1.11,
    roughness: 1,
    thicknessMap: map,
    roughnessMap: map,
    depthWrite: true,
  })
  mat.onBeforeCompile = (shader) => {
    safeShaderReplace(
      shader,
      '#include <opaque_fragment>',
      'gl_FragColor = vec4( outgoingLight, 1.0 );',
      'LEFT LENS',
    )
  }
  mat.customProgramCacheKey = () => 'left-lens-opaque-transmission'
  return mat
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
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, GRADIENT_SIZE, GRADIENT_SIZE)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping

  return { canvas, texture }
}

export function createRightLensMaterial(
  gradTex: THREE.CanvasTexture,
  progressiveUniforms: { value: number }[],
): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#ffffff'),
    transmission: 1,
    thickness: 0.5,
    ior: 1.15,
    roughness: 0.35,
    thicknessMap: gradTex,
    depthWrite: true,
  })

  // Inline the full transmission_pars_fragment chunk with progressive distortion
  // injected into getIBLVolumeRefraction, scoped to this material only.
  const chunk = THREE.ShaderChunk.transmission_pars_fragment
  const target =
    'transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );'
  const patchedChunk = chunk.replace(
    target,
    `{
      float lensY = clamp(vThicknessMapUv.x * 1.7, 0.0, 1.0);
      float progressiveFactor = (0.5 - lensY) * 2.0 * uProgressivePower;

      // Project lens optical center from view space to screen UV
      vec4 lensCenterClip = projectionMatrix * vec4(uLensCenterView, 1.0);
      vec2 lensCenterScreen = (lensCenterClip.xy / lensCenterClip.w) * 0.5 + 0.5;

      // Magnify/minify from lens optical center
      refractionCoords = clamp(
        lensCenterScreen + (refractionCoords - lensCenterScreen) * (1.0 + progressiveFactor),
        vec2(0.001), vec2(0.999)
      );
    }
    transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );`,
  )

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uProgressivePower = { value: PROGRESSIVE_POWER }
    shader.uniforms.uLensCenterView = {
      value: new THREE.Vector3(LENS_POSITION.rightX, 0.0, LENS_POSITION.z),
    }
    shader.uniforms.uDebugZones = { value: 0.0 }
    progressiveUniforms.push(shader.uniforms.uDebugZones)

    if (patchedChunk === chunk)
      throw new Error(
        '[RIGHT LENS] transmission_pars_fragment replacement FAILED — Three.js version may have changed',
      )

    safeShaderReplace(
      shader,
      '#include <transmission_pars_fragment>',
      `uniform float uProgressivePower;\nuniform vec3 uLensCenterView;\nuniform float uDebugZones;\n${patchedChunk}`,
      'RIGHT LENS transmission_pars',
    )

    safeShaderReplace(
      shader,
      '#include <transmission_fragment>',
      `#include <transmission_fragment>
      #ifdef USE_TRANSMISSION
      if (uDebugZones > 0.5) {
        float lensY = clamp(vThicknessMapUv.x * 1.7, 0.0, 1.0);
        vec3 zoneColor = vec3(0.0, 0.0, 1.0); // blue = magnification (bottom)
        if (lensY < 0.33) zoneColor = vec3(1.0, 0.0, 0.0); // red = minification (top)
        else if (lensY < 0.66) zoneColor = vec3(0.0, 1.0, 0.0); // green = no distortion (middle)
        totalDiffuse = mix(totalDiffuse, zoneColor, 0.25);
      }
      #endif`,
      'RIGHT LENS transmission_fragment',
    )

    safeShaderReplace(
      shader,
      '#include <opaque_fragment>',
      'gl_FragColor = vec4( outgoingLight, 1.0 );',
      'RIGHT LENS opaque',
    )
  }

  mat.customProgramCacheKey = () => 'progressive-lens'

  return mat
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
  const lensAMesh = lensGeometry.clone()
  const lensBMesh = lensGeometry.clone()
  lensBMesh.visible = false
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
  progressiveUniforms: { value: number }[],
): RightLensGroupResult {
  const { canvas: gradCanvas, texture: gradTex } = createGradientCanvas()

  const rightMat = createRightLensMaterial(gradTex, progressiveUniforms)
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
  resetDepthClear: () => void
  dispose: () => void
}

interface LensRefs {
  lensAMesh: THREE.Object3D | null
  lensBMesh: THREE.Object3D | null
  gradCanvas: HTMLCanvasElement | null
  gradCtx: CanvasRenderingContext2D | null
  gradTex: THREE.CanvasTexture | null
}

export async function loadGlasses(camera: THREE.Camera): Promise<GlassesState> {
  const refs: LensRefs = {
    lensAMesh: null,
    lensBMesh: null,
    gradCanvas: null,
    gradCtx: null,
    gradTex: null,
  }

  // Register listeners before async work so we can clean up on throw
  const progressiveUniforms: { value: number }[] = []

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'd' && e.ctrlKey) {
      e.preventDefault()
      toggle()
    }
  }
  window.addEventListener('keydown', onKeyDown)

  const unsubDebug = subscribe((on) => {
    for (const u of progressiveUniforms) u.value = on ? 1.0 : 0.0
  })

  const cleanupListeners = () => {
    window.removeEventListener('keydown', onKeyDown)
    unsubDebug()
  }

  let assets: {
    mapA: THREE.Texture
    mapB: THREE.Texture
    models: THREE.Group[]
  }
  try {
    const [mapA, mapB] = await Promise.all([
      loadTexture('lens_left_map.png'),
      loadTexture('lens_left_map_invert.png'),
    ])
    mapA.colorSpace = THREE.SRGBColorSpace
    mapB.colorSpace = THREE.SRGBColorSpace

    const models = await Promise.all([
      loadGLB('lens_left.glb'),
      loadGLB('lens_left_far.glb'),
      loadGLB('lens_right.glb'),
      loadGLB('lens_right_02.glb'),
      loadGLB('lens_frame_left.glb'),
      loadGLB('lens_frame_right.glb'),
      loadGLB('blank_l.glb'),
      loadGLB('blank_r.glb'),
    ])
    assets = { mapA, mapB, models }
  } catch (err) {
    cleanupListeners()
    throw err
  }

  const { mapA, mapB, models } = assets
  const [
    lensLeft,
    lensLeftFar,
    lensRight,
    lensRight02,
    frameLeft,
    frameRight,
    blankL,
    blankR,
  ] = models

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
  const primaryRight = buildRightLensGroup(
    lensRight,
    frameRight,
    blankR,
    progressiveUniforms,
  )
  const rightGroup = primaryRight.group
  refs.gradCanvas = primaryRight.gradCanvas
  refs.gradCtx = primaryRight.gradCanvas.getContext('2d') ?? null
  refs.gradTex = primaryRight.gradTex

  // Alternate right
  const altRight = buildRightLensGroup(
    lensRight02,
    frameRight,
    blankR,
    progressiveUniforms,
  )
  const rightGroupAlt = altRight.group
  rightGroupAlt.position.y = SWAP_HIDDEN_Y

  // Render glasses on top of scene: high renderOrder + depth clear before first glasses mesh
  const allGroups = [leftGroup, rightGroup, leftGroupAlt, rightGroupAlt]
  let needsDepthClear = true
  for (const g of allGroups) {
    g.renderOrder = 999
    g.traverse((child) => {
      if (child instanceof THREE.Mesh) child.renderOrder = 999
    })
  }
  // Attach depth-clear to the first visible glasses mesh each frame
  leftGroup.traverse((child) => {
    if (child instanceof THREE.Mesh && !child.userData._depthClearAttached) {
      child.userData._depthClearAttached = true
      child.onBeforeRender = (renderer) => {
        if (needsDepthClear) {
          renderer.clearDepth()
          needsDepthClear = false
        }
      }
    }
  })

  camera.add(leftGroup, rightGroup, leftGroupAlt, rightGroupAlt)

  let leftSwapped = false
  let rightSwapped = false
  let lastGradientOffset = Number.POSITIVE_INFINITY

  function update(polarAngle: number, minPolar: number, maxPolar: number) {
    if (refs.gradCtx && refs.gradTex) {
      const offset = THREE.MathUtils.mapLinear(
        polarAngle,
        minPolar,
        maxPolar,
        -GRADIENT_SIZE * 0.3,
        GRADIENT_SIZE * 0.02,
      )
      const quantized = Math.round(offset)
      if (lastGradientOffset !== quantized) {
        lastGradientOffset = quantized
        const ctx = refs.gradCtx
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
      const useFar = t > 0.5
      refs.lensAMesh.visible = !useFar
      refs.lensBMesh.visible = useFar
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

  function resetDepthClear() {
    needsDepthClear = true
  }

  function animateSwap() {
    for (const group of allGroups) {
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
    for (const g of allGroups) {
      camera.remove(g)
      g.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          if (Array.isArray(child.material))
            for (const m of child.material) m.dispose()
          else child.material.dispose()
        }
      })
    }
    mapA.dispose()
    mapB.dispose()
    refs.gradTex?.dispose()
    cleanupListeners()
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
    resetDepthClear,
    dispose,
  }
}
