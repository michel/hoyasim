import * as THREE from 'three'
import type { LoadedLandscapeBlocks } from '@/lib/blockModelLoader'

// ── Constants ────────────────────────────────────────────────────────

const SPAWN_Z = 350
const CULL_Z = -210
const VISIBLE_Z = 315
const GROUND_Y = -3.15
const ROAD_ROTATION_Y = 1.25
const DEFAULT_ROAD_SPEED = -10
const SPEED_STEP = 3.5
const MIN_ROAD_SPEED = -35
const MAX_ROAD_SPEED = -3.5
const BLOCK_DEPTH = 27
const BLOCK_SCALE = 2.0
const SPAWN_INTERVAL = BLOCK_DEPTH * BLOCK_SCALE
// Offset to align scaled block inner edge (x=3) with sidewalk outer edge (x=7.35)
const EDGE_SHIFT = 1.35

// ── Types ────────────────────────────────────────────────────────────

export interface CameraOffset {
  x: number
  y: number
}

export interface BlocksState {
  update: (delta: number) => CameraOffset
  dispose: () => void
}

interface SpawnedObject {
  group: THREE.Object3D
  type: 'landscape' | 'marking'
}

// ── Helpers ──────────────────────────────────────────────────────────

function flatMat(
  color: number,
  roughness = 0.9,
  extra?: Partial<THREE.MeshStandardMaterialParameters>,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness,
    ...extra,
  })
}

// ── Factory ─────────────────────────────────────────────────────────

export function createBlocks(
  scene: THREE.Scene,
  templates: LoadedLandscapeBlocks,
): BlocksState {
  const group = new THREE.Group()
  group.position.y = GROUND_Y
  group.rotation.y = ROAD_ROTATION_Y

  // ── Road materials ────────────────────────────────────────────────

  const roadMat = flatMat(0xa55145)
  const sidewalkMat = flatMat(0x888888, 0.95)
  const markingMat = flatMat(0xffffff, 0.7)
  const markingGeo = new THREE.BoxGeometry(1, 1, 1)

  const allMaterials: THREE.Material[] = [roadMat, sidewalkMat, markingMat]
  const allGeometries: THREE.BufferGeometry[] = [markingGeo]

  // ── Static road geometry ──────────────────────────────────────────

  const staticMeshes: THREE.Mesh[] = []
  const groundLen = 1400

  const grassMat = flatMat(0x6b8e23)
  allMaterials.push(grassMat)

  const roadStrips: [number, THREE.Material, number, number][] = [
    [300, grassMat, 0, -0.01],
    [10.5, roadMat, 0, 0],
    [2.1, sidewalkMat, -6.3, 0.0035],
    [2.1, sidewalkMat, 6.3, 0.0035],
    [7, roadMat, 31.5, 0],
    [7, roadMat, -31.5, 0],
    [1.75, sidewalkMat, 36.05, 0.0035],
    [1.75, sidewalkMat, -36.05, 0.0035],
  ]
  for (const [width, mat, x, y] of roadStrips) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, groundLen), mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, y, 105)
    group.add(mesh)
    staticMeshes.push(mesh)
  }

  scene.add(group)

  // ── Lighting ────────────────────────────────────────────────────

  interface LightSnapshot {
    ambient: { light: THREE.AmbientLight; intensity: number }[]
    directional: {
      light: THREE.DirectionalLight
      color: THREE.Color
      intensity: number
      castShadow: boolean
    }[]
  }
  const lightSnapshot: LightSnapshot = { ambient: [], directional: [] }

  scene.traverse((child) => {
    if (child instanceof THREE.AmbientLight) {
      lightSnapshot.ambient.push({ light: child, intensity: child.intensity })
      child.intensity = 0.4
    }
    if (child instanceof THREE.DirectionalLight) {
      lightSnapshot.directional.push({
        light: child,
        color: child.color.clone(),
        intensity: child.intensity,
        castShadow: child.castShadow,
      })
      child.color.set(0xffddaa)
      child.intensity = 0.8
      child.castShadow = true
      child.shadow.mapSize.set(128, 128)
      child.shadow.camera.left = -52.5
      child.shadow.camera.right = 52.5
      child.shadow.camera.top = 52.5
      child.shadow.camera.bottom = -52.5
      child.shadow.camera.near = 0.1
      child.shadow.camera.far = 105
    }
  })

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8)
  scene.add(hemiLight)

  // ── Speed control ─────────────────────────────────────────────

  let targetSpeed = DEFAULT_ROAD_SPEED

  function onSpeedKey(e: KeyboardEvent) {
    if (e.key === 'ArrowUp') {
      targetSpeed = Math.max(MIN_ROAD_SPEED, targetSpeed - SPEED_STEP)
      e.preventDefault()
    } else if (e.key === 'ArrowDown') {
      targetSpeed = Math.min(MAX_ROAD_SPEED, targetSpeed + SPEED_STEP)
      e.preventDefault()
    }
  }

  window.addEventListener('keydown', onSpeedKey)

  // ── Spawned objects tracking ────────────────────────────────────

  const spawned: SpawnedObject[] = []

  function spawn(obj: THREE.Object3D, type: SpawnedObject['type']) {
    group.add(obj)
    spawned.push({ group: obj, type })
  }

  function disposeObject(obj: SpawnedObject) {
    group.remove(obj.group)
    // GLB clones share geometry/materials with templates — don't dispose them
    // Only dispose procedural markings
    if (obj.type === 'marking')
      obj.group.traverse((child) => {
        if (child instanceof THREE.Mesh) child.geometry.dispose()
      })
  }

  // ── Sequence tracking ─────────────────────────────────────────

  // Templates come in pairs: [left0, right0, left1, right1, ...]
  // We step by 2 each spawn to get a left+right pair
  let sequenceIndex = 0
  const pairCount = Math.floor(templates.length / 2)

  function spawnPair(z: number) {
    if (pairCount === 0) return

    const leftIdx = (sequenceIndex % pairCount) * 2
    const rightIdx = leftIdx + 1
    sequenceIndex = (sequenceIndex + 1) % pairCount

    if (leftIdx < templates.length) {
      const left = templates[leftIdx].clone()
      left.scale.setScalar(BLOCK_SCALE)
      left.position.set(EDGE_SHIFT, 0, z)
      spawn(left, 'landscape')
    }

    if (rightIdx < templates.length) {
      const right = templates[rightIdx].clone()
      right.scale.setScalar(BLOCK_SCALE)
      right.position.set(-EDGE_SHIFT, 0, z)
      spawn(right, 'landscape')
    }

    // Road marking
    const marking = new THREE.Mesh(markingGeo, markingMat)
    marking.scale.set(0.525, 0.07, 5.25)
    marking.position.set(0, 0.035, z)
    spawn(marking, 'marking')
  }

  // ── Initial population ──────────────────────────────────────────

  let spawnAccumulator = 0

  for (let z = CULL_Z; z <= SPAWN_Z; z += SPAWN_INTERVAL) spawnPair(z)

  // ── Update loop ─────────────────────────────────────────────────

  let elapsed = 0
  const cameraOffset: CameraOffset = { x: 0, y: 0 }

  function update(delta: number): CameraOffset {
    if (delta > 1) return { x: 0, y: 0 }
    elapsed += delta

    const dz = targetSpeed * delta
    spawnAccumulator += Math.abs(dz)

    while (spawnAccumulator >= SPAWN_INTERVAL) {
      spawnAccumulator -= SPAWN_INTERVAL
      spawnPair(SPAWN_Z)
    }

    for (const obj of spawned) {
      obj.group.position.z += dz
      obj.group.visible = obj.group.position.z < VISIBLE_Z
    }

    let i = 0
    while (i < spawned.length) {
      if (spawned[i].group.position.z < CULL_Z) {
        disposeObject(spawned[i])
        spawned[i] = spawned[spawned.length - 1]
        spawned.pop()
      } else {
        i++
      }
    }

    // Pedaling bob & vibration — scale with speed
    const speedRatio = Math.abs(targetSpeed / DEFAULT_ROAD_SPEED)
    const vibrationX =
      (Math.sin(elapsed * 47) * 0.0008 + Math.sin(elapsed * 31) * 0.0005) *
      speedRatio
    const vibrationY =
      (Math.sin(elapsed * 53) * 0.001 + Math.sin(elapsed * 37) * 0.0006) *
      speedRatio
    const bobY =
      Math.sin(elapsed * Math.PI * 3 * speedRatio) * 0.008 * speedRatio

    cameraOffset.x = vibrationX
    cameraOffset.y = vibrationY + bobY
    return cameraOffset
  }

  // ── Dispose ─────────────────────────────────────────────────────

  function dispose() {
    for (const obj of spawned) disposeObject(obj)
    spawned.length = 0

    for (const mesh of staticMeshes) {
      group.remove(mesh)
      mesh.geometry.dispose()
    }

    window.removeEventListener('keydown', onSpeedKey)

    scene.remove(hemiLight)
    hemiLight.dispose()

    for (const s of lightSnapshot.ambient) s.light.intensity = s.intensity
    for (const s of lightSnapshot.directional) {
      s.light.color.copy(s.color)
      s.light.intensity = s.intensity
      s.light.castShadow = s.castShadow
    }

    for (const geo of allGeometries) geo.dispose()
    for (const mat of allMaterials) mat.dispose()

    for (const tpl of templates)
      tpl.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          const mats = Array.isArray(child.material)
            ? child.material
            : [child.material]
          for (const m of mats) m.dispose()
        }
      })

    scene.remove(group)
  }

  return { update, dispose }
}
