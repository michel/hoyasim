import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import type { LoadedBlockModels } from '@/lib/blockModelLoader'

// ── Constants ────────────────────────────────────────────────────────

const SPAWN_Z = 350
const CULL_Z = -210
const VISIBLE_Z = 315
const GROUND_Y = -3.15
const ROAD_ROTATION_Y = 1.25
const DEFAULT_ROAD_SPEED = -17.5
const SPEED_STEP = 3.5
const MIN_ROAD_SPEED = -35
const MAX_ROAD_SPEED = -3.5
const SPAWN_INTERVAL = 30
const CYCLE_LENGTH = 525
const CROSSROADS_SPAWN_OFFSET = 84
const STOP_DURATION = 10
const BRAKE_DURATION = 1.5
const ACCEL_DURATION = 2.0

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
  type: 'house' | 'tree' | 'marking' | 'bush' | 'crossroads'
  isGlbClone?: boolean
}

export interface BlockResources {
  boxGeo: THREE.BoxGeometry
  trunkGeo: THREE.CylinderGeometry
  canopyGeo: THREE.SphereGeometry
  capGeo: THREE.SphereGeometry
  bushGeo: THREE.SphereGeometry
  brickMats: THREE.MeshStandardMaterial[]
  glassMat: THREE.MeshStandardMaterial
  frameMat: THREE.MeshStandardMaterial
  doorMat: THREE.MeshStandardMaterial
  roofMat: THREE.MeshStandardMaterial
  redRoofMat: THREE.MeshStandardMaterial
  trimMat: THREE.MeshStandardMaterial
  trunkMat: THREE.MeshStandardMaterial
  leavesMat: THREE.MeshStandardMaterial
  towerMat: THREE.MeshStandardMaterial
  markingMat: THREE.MeshStandardMaterial
  bushMat: THREE.MeshStandardMaterial
  trafficRedMat: THREE.MeshStandardMaterial
  trafficRedOnMat: THREE.MeshStandardMaterial
  trafficGreenMat: THREE.MeshStandardMaterial
  trafficGreenOnMat: THREE.MeshStandardMaterial
  trafficOrangeMat: THREE.MeshStandardMaterial
  trafficOrangeOnMat: THREE.MeshStandardMaterial
  trafficHousingMat: THREE.MeshStandardMaterial
  allMaterials: THREE.Material[]
  allGeometries: THREE.BufferGeometry[]
}

// ── Helpers ──────────────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

// ── Zone helpers ─────────────────────────────────────────────────────

type Zone = 'city' | 'transition' | 'nature'

function getZone(offset: number): Zone {
  const t =
    (((offset % CYCLE_LENGTH) + CYCLE_LENGTH) % CYCLE_LENGTH) / CYCLE_LENGTH
  if (t < 0.4) return 'city'
  if (t < 0.5) return 'transition'
  if (t < 0.8) return 'nature'
  return 'transition'
}

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

// ── Resource factory ─────────────────────────────────────────────────

export function createBlockResources(): BlockResources & {
  grassMat: THREE.MeshStandardMaterial
  roadMat: THREE.MeshStandardMaterial
  sidewalkMat: THREE.MeshStandardMaterial
  planeGeo: THREE.PlaneGeometry
} {
  const boxGeo = new THREE.BoxGeometry(1, 1, 1)
  const planeGeo = new THREE.PlaneGeometry(1, 1)
  const trunkGeo = new THREE.CylinderGeometry(0.1, 0.15, 1, 5)
  const canopyGeo = new THREE.SphereGeometry(1, 4, 3)
  const capGeo = new THREE.SphereGeometry(0.5, 3, 2)
  const bushGeo = new THREE.SphereGeometry(1, 4, 3)

  const brickMats = [
    0x4a2c2a, 0x3e2723, 0x5d4037, 0x2a2a2a, 0x1a1a1a, 0x8b4513,
  ].map((c) => flatMat(c))
  const glassMat = flatMat(0x4488aa, 0.3, {
    emissive: 0x112233,
    emissiveIntensity: 0.3,
    metalness: 0.1,
  })
  const frameMat = flatMat(0xffffff, 0.7)
  const doorMat = flatMat(0x2a1a0a)
  const roofMat = flatMat(0x222222)
  const redRoofMat = flatMat(0x8b2500, 0.85)
  const trimMat = flatMat(0xeeeeee, 0.7)
  const trunkMat = flatMat(0x4a3728)
  const leavesMat = flatMat(0x2e8b57, 0.95)
  const towerMat = flatMat(0x555555)
  const markingMat = flatMat(0xffffff, 0.7)
  const bushMat = flatMat(0x3a7d44, 0.95)
  const grassMat = flatMat(0x6b8e23, 0.95)
  const roadMat = flatMat(0xa55145)
  const sidewalkMat = flatMat(0x888888, 0.95)

  const sharedGeos: THREE.BufferGeometry[] = [
    boxGeo,
    planeGeo,
    trunkGeo,
    canopyGeo,
    capGeo,
    bushGeo,
  ]
  // Traffic light materials
  const trafficRedMat = flatMat(0x330000, 0.7)
  const trafficRedOnMat = flatMat(0xff0000, 0.5, {
    emissive: 0xff0000,
    emissiveIntensity: 0.8,
  })
  const trafficGreenMat = flatMat(0x003300, 0.7)
  const trafficGreenOnMat = flatMat(0x00ff00, 0.5, {
    emissive: 0x00ff00,
    emissiveIntensity: 0.8,
  })
  const trafficOrangeMat = flatMat(0x332200, 0.7)
  const trafficOrangeOnMat = flatMat(0xff8800, 0.5, {
    emissive: 0xff8800,
    emissiveIntensity: 0.8,
  })
  const trafficHousingMat = flatMat(0x1a1a1a, 0.9)

  const allMaterials: THREE.Material[] = [
    ...brickMats,
    glassMat,
    frameMat,
    doorMat,
    roofMat,
    redRoofMat,
    trimMat,
    trunkMat,
    leavesMat,
    towerMat,
    markingMat,
    bushMat,
    grassMat,
    roadMat,
    sidewalkMat,
    trafficRedMat,
    trafficRedOnMat,
    trafficGreenMat,
    trafficGreenOnMat,
    trafficOrangeMat,
    trafficOrangeOnMat,
    trafficHousingMat,
  ]

  return {
    boxGeo,
    planeGeo,
    trunkGeo,
    canopyGeo,
    capGeo,
    bushGeo,
    brickMats,
    glassMat,
    frameMat,
    doorMat,
    roofMat,
    redRoofMat,
    trimMat,
    trunkMat,
    leavesMat,
    towerMat,
    markingMat,
    bushMat,
    trafficRedMat,
    trafficRedOnMat,
    trafficGreenMat,
    trafficGreenOnMat,
    trafficOrangeMat,
    trafficOrangeOnMat,
    trafficHousingMat,
    grassMat,
    roadMat,
    sidewalkMat,
    allGeometries: sharedGeos,
    allMaterials,
  }
}

// ── Extracted factory functions ──────────────────────────────────────

export function scaledBoxGeo(
  boxGeo: THREE.BoxGeometry,
  sx: number,
  sy: number,
  sz: number,
  px: number,
  py: number,
  pz: number,
): THREE.BufferGeometry {
  const g = boxGeo.clone()
  g.scale(sx, sy, sz)
  g.translate(px, py, pz)
  return g
}

export function createHouse(res: BlockResources): THREE.Group {
  const g = new THREE.Group()
  const mat = res.brickMats[Math.floor(Math.random() * res.brickMats.length)]

  const d = rand(3.5, 4.5)
  const w = rand(2, 3.5)
  const h = rand(2.5, 4.5)

  const brickGeos: THREE.BufferGeometry[] = []
  const trimGeos: THREE.BufferGeometry[] = []
  const frameGeos: THREE.BufferGeometry[] = []
  const glassGeos: THREE.BufferGeometry[] = []
  const doorGeos: THREE.BufferGeometry[] = []

  brickGeos.push(scaledBoxGeo(res.boxGeo, w, h, d, 0, h / 2, 0))

  const trimY = h * 0.45
  trimGeos.push(scaledBoxGeo(res.boxGeo, w + 0.1, 0.08, d + 0.1, 0, trimY, 0))

  const isSteppedGable = Math.random() < 0.6
  const wallThick = 0.2
  const facadeX = w / 2 - wallThick / 2

  let gableTopY = h
  if (isSteppedGable) {
    const steps = Math.floor(rand(3, 6))
    const stepH = 0.35
    let gableD = d
    for (let i = 0; i < steps; i++) {
      gableD *= 0.78
      const sy = h + i * stepH + stepH / 2
      brickGeos.push(
        scaledBoxGeo(res.boxGeo, wallThick, stepH, gableD, facadeX, sy, 0),
      )
      trimGeos.push(
        scaledBoxGeo(
          res.boxGeo,
          wallThick + 0.04,
          0.05,
          gableD + 0.04,
          facadeX,
          sy + stepH / 2,
          0,
        ),
      )
      gableTopY = h + (i + 1) * stepH
    }
  } else {
    trimGeos.push(
      scaledBoxGeo(
        res.boxGeo,
        wallThick + 0.1,
        0.15,
        d + 0.15,
        facadeX,
        h + 0.075,
        0,
      ),
    )
    brickGeos.push(
      scaledBoxGeo(res.boxGeo, wallThick, 0.25, d, facadeX, h + 0.125, 0),
    )
    gableTopY = h + 0.25
  }

  if (isSteppedGable) {
    const xFront = w / 2 - wallThick
    const xBack = -w / 2
    const ridgeY = gableTopY
    const eaveY = h
    const halfD = d / 2

    const verts = new Float32Array([
      xBack,
      eaveY,
      -halfD,
      xBack,
      eaveY,
      halfD,
      xBack,
      ridgeY,
      0,
      xFront,
      eaveY,
      -halfD,
      xFront,
      eaveY,
      halfD,
      xFront,
      ridgeY,
      0,
    ])

    const indices = new Uint16Array([
      0, 2, 5, 0, 5, 3, 1, 4, 5, 1, 5, 2, 0, 1, 2, 3, 5, 4, 0, 3, 4, 0, 4, 1,
    ])

    const roofGeo = new THREE.BufferGeometry()
    roofGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
    roofGeo.setIndex(new THREE.BufferAttribute(indices, 1))
    roofGeo.computeVertexNormals()
    g.add(new THREE.Mesh(roofGeo, res.redRoofMat))
  }

  if (isSteppedGable) {
    const beamY = gableTopY - 0.15
    const beamLen = 0.5
    brickGeos.push(
      scaledBoxGeo(
        res.boxGeo,
        beamLen,
        0.07,
        0.07,
        w / 2 + beamLen / 2,
        beamY,
        0,
      ),
    )
    brickGeos.push(
      scaledBoxGeo(
        res.boxGeo,
        0.05,
        0.12,
        0.05,
        w / 2 + beamLen - 0.025,
        beamY - 0.1,
        0,
      ),
    )
  }

  const numFloors = Math.max(1, Math.floor((h - 1.0) / 1.4))
  const windowSpacing = d * 0.28
  for (let floor = 0; floor < numFloors; floor++) {
    const cy = 1.2 + floor * 1.4
    if (cy > h - 0.5) continue
    for (const zOff of [-windowSpacing, windowSpacing]) {
      const fx = w / 2 + 0.02
      frameGeos.push(scaledBoxGeo(res.boxGeo, 0.04, 0.9, 0.7, fx, cy, zOff))
      glassGeos.push(
        scaledBoxGeo(res.boxGeo, 0.05, 0.8, 0.6, fx + 0.01, cy, zOff),
      )
      trimGeos.push(
        scaledBoxGeo(res.boxGeo, 0.1, 0.06, 0.75, fx + 0.03, cy - 0.48, zOff),
      )
      frameGeos.push(
        scaledBoxGeo(res.boxGeo, 0.06, 0.85, 0.04, fx + 0.01, cy, zOff),
      )
    }
  }

  const doorH = 1.1
  const doorW = 0.55
  doorGeos.push(
    scaledBoxGeo(res.boxGeo, 0.06, doorH, doorW, w / 2 + 0.03, doorH / 2, 0),
  )
  trimGeos.push(
    scaledBoxGeo(
      res.boxGeo,
      0.05,
      doorH + 0.15,
      doorW + 0.15,
      w / 2 + 0.01,
      doorH / 2,
      0,
    ),
  )

  const brickMerged = BufferGeometryUtils.mergeGeometries(brickGeos)
  g.add(new THREE.Mesh(brickMerged, mat))

  if (trimGeos.length > 0) {
    const trimMerged = BufferGeometryUtils.mergeGeometries(trimGeos)
    g.add(new THREE.Mesh(trimMerged, res.trimMat))
  }

  if (glassGeos.length > 0) {
    const glassMerged = BufferGeometryUtils.mergeGeometries(glassGeos)
    g.add(new THREE.Mesh(glassMerged, res.glassMat))
  }

  if (doorGeos.length > 0) {
    const doorMerged = BufferGeometryUtils.mergeGeometries(doorGeos)
    g.add(new THREE.Mesh(doorMerged, res.doorMat))
  }

  return g
}

export function createTree(res: BlockResources): THREE.Group {
  const g = new THREE.Group()
  const trunkH = rand(0.6, 1.2)
  const trunk = new THREE.Mesh(res.trunkGeo, res.trunkMat)
  trunk.scale.y = trunkH
  trunk.position.y = trunkH / 2
  g.add(trunk)

  const canopyR = rand(0.4, 0.8)
  const canopy = new THREE.Mesh(res.canopyGeo, res.leavesMat)
  canopy.scale.set(canopyR, canopyR * 1.4, canopyR)
  canopy.position.y = trunkH + canopyR * 0.5
  g.add(canopy)

  return g
}

export function createRoadMarking(res: BlockResources): THREE.Mesh {
  const marking = new THREE.Mesh(res.boxGeo, res.markingMat)
  marking.scale.set(0.525, 0.07, 5.25)
  marking.position.set(0, 0.035, 0)
  return marking
}

export function createBush(res: BlockResources): THREE.Group {
  const g = new THREE.Group()
  const count = Math.floor(rand(2, 4))
  for (let i = 0; i < count; i++) {
    const s = rand(0.25, 0.5)
    const mesh = new THREE.Mesh(res.bushGeo, res.bushMat)
    mesh.scale.set(s * rand(0.8, 1.2), s * 0.7, s * rand(0.8, 1.2))
    mesh.position.set(rand(-0.2, 0.2), s * 0.3, rand(-0.2, 0.2))
    g.add(mesh)
  }
  return g
}

interface TrafficLights {
  red: THREE.Mesh[]
  yellow: THREE.Mesh[]
  green: THREE.Mesh[]
}

function setLights(lights: THREE.Mesh[], mat: THREE.Material): void {
  for (const l of lights) l.material = mat
}

export function createCrossroads(res: BlockResources): {
  group: THREE.Group
  lights: TrafficLights
} {
  const g = new THREE.Group()
  const lights: TrafficLights = { red: [], yellow: [], green: [] }

  for (const x of [7.7, -7.7]) {
    const pole = new THREE.Mesh(res.boxGeo, res.towerMat)
    pole.scale.set(0.28, 7, 0.28)
    pole.position.set(x, 3.5, 0)
    g.add(pole)

    const housing = new THREE.Mesh(res.boxGeo, res.trafficHousingMat)
    housing.scale.set(1.4, 3.15, 0.875)
    housing.position.set(x, 7.7, 0)
    g.add(housing)

    const light = (mat: THREE.Material, y: number) => {
      const mesh = new THREE.Mesh(res.capGeo, mat)
      mesh.scale.setScalar(0.35)
      mesh.position.set(x, y, -0.455)
      g.add(mesh)
      return mesh
    }

    lights.red.push(light(res.trafficRedMat, 8.68))
    lights.yellow.push(light(res.trafficOrangeMat, 7.7))
    lights.green.push(light(res.trafficGreenOnMat, 6.72))
  }

  // Zebra crossing — white stripes across road width
  const stripeCount = 7
  const roadWidth = 10.5
  const stripeWidth = 3.5
  const gap = roadWidth / stripeCount
  for (let i = 0; i < stripeCount; i++) {
    const stripe = new THREE.Mesh(res.boxGeo, res.markingMat)
    stripe.scale.set(gap * 0.7, 0.07, stripeWidth)
    stripe.position.set(-roadWidth / 2 + gap * (i + 0.5), 0.0525, 0)
    g.add(stripe)
  }

  return { group: g, lights }
}

// ── Factory ─────────────────────────────────────────────────────────

function cloneBlockModel(
  templates: THREE.Object3D[] | undefined,
): THREE.Object3D | null {
  if (!templates?.length) return null
  return templates[Math.floor(Math.random() * templates.length)].clone()
}

function findMeshesByName(root: THREE.Object3D, name: string): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  root.traverse((c) => {
    if (c instanceof THREE.Mesh && c.name === name) meshes.push(c)
  })
  return meshes
}

export function createBlocks(
  scene: THREE.Scene,
  models: LoadedBlockModels,
): BlocksState {
  const group = new THREE.Group()
  group.position.y = GROUND_Y
  group.rotation.y = ROAD_ROTATION_Y

  const res = createBlockResources()

  // ── Static ground geometry ──────────────────────────────────────

  const staticMeshes: THREE.Mesh[] = []
  const groundLen = 1400

  const groundStrips: [number, THREE.Material, number, number][] = [
    [210, res.grassMat, 0, -0.035],
    [10.5, res.roadMat, 0, 0],
    [2.1, res.sidewalkMat, -6.3, 0.0035],
    [2.1, res.sidewalkMat, 6.3, 0.0035],
    [7, res.roadMat, 31.5, 0],
    [7, res.roadMat, -31.5, 0],
    [1.75, res.sidewalkMat, 36.05, 0.0035],
    [1.75, res.sidewalkMat, -36.05, 0.0035],
  ]
  for (const [width, mat, x, y] of groundStrips) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, groundLen), mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, y, 105)
    if (y < 0) mesh.receiveShadow = true
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
      lightSnapshot.ambient.push({
        light: child,
        intensity: child.intensity,
      })
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
  let roadSpeed = DEFAULT_ROAD_SPEED

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

  function spawn(
    obj: THREE.Object3D,
    type: SpawnedObject['type'],
    isGlbClone = false,
  ) {
    group.add(obj)
    spawned.push({ group: obj, type, isGlbClone })
  }

  function spawnMirrored(
    obj: THREE.Object3D,
    type: SpawnedObject['type'],
    isGlbClone = false,
  ) {
    spawn(obj, type, isGlbClone)
    const mirror = obj.clone()
    mirror.position.x = -mirror.position.x
    mirror.rotation.y = Math.PI - mirror.rotation.y
    spawn(mirror, type, isGlbClone)
  }

  function disposeObject(obj: SpawnedObject) {
    group.remove(obj.group)
    if (!obj.isGlbClone)
      obj.group.traverse((child) => {
        if (child instanceof THREE.Mesh) child.geometry.dispose()
      })
  }

  function spawnClone(
    category: keyof LoadedBlockModels,
    type: SpawnedObject['type'],
    x: number,
    z: number,
    mirror = true,
  ) {
    const obj = cloneBlockModel(models[category])
    if (!obj) return
    obj.position.set(x, 0, z)
    if (mirror) spawnMirrored(obj, type, true)
    else spawn(obj, type, true)
  }

  function spawnRow(z: number, zone: Zone) {
    if (zone === 'city' || zone === 'transition') {
      if (zone === 'city' || Math.random() < 0.5)
        spawnClone('house', 'house', rand(-15.75, -14.0), z)

      if (zone === 'city' || Math.random() < 0.3)
        spawnClone('house', 'house', rand(-40.25, -38.5), z + rand(5.25, 12.25))

      if (Math.random() < 0.4)
        spawnClone('tree', 'tree', -rand(10.0, 21.0), z + SPAWN_INTERVAL * 0.5)

      if (Math.random() < 0.08)
        spawnClone(
          'bush',
          'bush',
          -rand(7.0, 10.5),
          z + rand(0, SPAWN_INTERVAL),
        )
    }

    const marking = createRoadMarking(res)
    marking.position.set(0, 0, z)
    spawn(marking, 'marking')

    if (zone === 'nature' || zone === 'transition') {
      if (zone === 'nature' || Math.random() < 0.5) {
        const count = Math.floor(rand(1, 3))
        for (let i = 0; i < count; i++)
          spawnClone(
            'tree',
            'tree',
            -rand(12.0, 28.0),
            z + rand(0, SPAWN_INTERVAL) * i,
          )
      }

      if (Math.random() < 0.8) {
        const bushCount = Math.floor(rand(1, 3))
        for (let i = 0; i < bushCount; i++)
          spawnClone(
            'bush',
            'bush',
            -rand(7.0, 28.0),
            z + rand(0, SPAWN_INTERVAL),
          )
      }

      if (zone === 'nature') {
        const treeCount = Math.floor(rand(2, 4))
        for (let i = 0; i < treeCount; i++)
          spawnClone(
            'tree',
            'tree',
            -rand(38.5, 77.0),
            z + rand(0, SPAWN_INTERVAL),
          )
        const bushCount = Math.floor(rand(2, 3))
        for (let i = 0; i < bushCount; i++)
          spawnClone(
            'bush',
            'bush',
            -rand(38.5, 70.0),
            z + rand(0, SPAWN_INTERVAL),
          )
      }
    }
  }

  // ── Initial population ──────────────────────────────────────────

  let distanceTraveled = 0
  let spawnAccumulator = 0

  // ── Crossroads state ────────────────────────────────────────
  type CrossroadsState = 'riding' | 'braking' | 'stopped' | 'accelerating'
  let crossroadsState: CrossroadsState = 'riding'
  let crossroadsGroup: THREE.Group | null = null
  let crossroadsLights: TrafficLights = { red: [], yellow: [], green: [] }
  let crossroadsSpawned = false
  let prevCycleOffset = 0
  let brakeTimer = 0
  let stopTimer = 0
  let accelTimer = 0
  let speedAtBrakeStart = DEFAULT_ROAD_SPEED

  for (let z = CULL_Z; z <= SPAWN_Z; z += SPAWN_INTERVAL)
    spawnRow(z, getZone(z))

  // ── Update loop ─────────────────────────────────────────────────

  let elapsed = 0

  const cameraOffset: CameraOffset = { x: 0, y: 0 }

  function update(delta: number): CameraOffset {
    if (delta > 1) return { x: 0, y: 0 }
    elapsed += delta

    // ── Crossroads spawn detection ──────────────────────────────
    const cycleOffset = distanceTraveled % CYCLE_LENGTH
    // Reset crossroadsSpawned on cycle wrap
    if (cycleOffset < prevCycleOffset) crossroadsSpawned = false
    // Spawn when crossing the offset threshold
    if (
      !crossroadsSpawned &&
      prevCycleOffset < CROSSROADS_SPAWN_OFFSET &&
      cycleOffset >= CROSSROADS_SPAWN_OFFSET
    ) {
      crossroadsSpawned = true
      if (models.crossroads?.length) {
        const clone = cloneBlockModel(models.crossroads)
        if (clone) {
          clone.position.set(0, 0, SPAWN_Z)
          spawn(clone, 'crossroads', true)
          crossroadsGroup = clone as THREE.Group
          crossroadsLights = {
            red: findMeshesByName(clone, 'red'),
            yellow: findMeshesByName(clone, 'yellow'),
            green: findMeshesByName(clone, 'green'),
          }
        }
      } else {
        const cr = createCrossroads(res)
        cr.group.position.set(0, 0, SPAWN_Z)
        spawn(cr.group, 'crossroads')
        crossroadsGroup = cr.group
        crossroadsLights = cr.lights
      }
    }
    prevCycleOffset = cycleOffset

    // ── Crossroads state machine ────────────────────────────────
    if (crossroadsState === 'riding') {
      roadSpeed = targetSpeed
      if (crossroadsGroup) {
        const dynamicBrakeThreshold =
          (Math.abs(targetSpeed) * BRAKE_DURATION) / 2 + 10.5
        if (crossroadsGroup.position.z < dynamicBrakeThreshold) {
          crossroadsState = 'braking'
          speedAtBrakeStart = roadSpeed
          brakeTimer = 0
          setLights(crossroadsLights.green, res.trafficGreenMat)
          setLights(crossroadsLights.yellow, res.trafficOrangeOnMat)
        }
      }
    }

    if (crossroadsState === 'braking') {
      brakeTimer += delta
      const t = Math.min(brakeTimer / BRAKE_DURATION, 1)
      const ease = t * (2 - t) // ease-out
      roadSpeed = speedAtBrakeStart * (1 - ease)
      if (t >= 1) {
        roadSpeed = 0
        crossroadsState = 'stopped'
        stopTimer = 0
        setLights(crossroadsLights.yellow, res.trafficOrangeMat)
        setLights(crossroadsLights.red, res.trafficRedOnMat)
      }
    }

    if (crossroadsState === 'stopped') {
      roadSpeed = 0
      stopTimer += delta
      if (stopTimer >= STOP_DURATION) {
        crossroadsState = 'accelerating'
        accelTimer = 0
        setLights(crossroadsLights.red, res.trafficRedMat)
        setLights(crossroadsLights.green, res.trafficGreenOnMat)
      }
    }

    if (crossroadsState === 'accelerating') {
      accelTimer += delta
      const t = Math.min(accelTimer / ACCEL_DURATION, 1)
      const ease = t * t // ease-in
      roadSpeed = targetSpeed * ease
      if (t >= 1) {
        roadSpeed = targetSpeed
        crossroadsState = 'riding'
        crossroadsGroup = null
        crossroadsLights = { red: [], yellow: [], green: [] }
      }
    }

    const dz = roadSpeed * delta
    const dist = Math.abs(dz)
    distanceTraveled = (distanceTraveled + dist) % (CYCLE_LENGTH * 1000)
    spawnAccumulator += dist

    while (spawnAccumulator >= SPAWN_INTERVAL) {
      spawnAccumulator -= SPAWN_INTERVAL
      const zone = getZone(distanceTraveled)
      spawnRow(SPAWN_Z, zone)
    }

    for (const obj of spawned) {
      obj.group.position.z += dz
      obj.group.visible = obj.group.position.z < VISIBLE_Z
      if (
        obj.type === 'marking' &&
        crossroadsGroup &&
        Math.abs(obj.group.position.z - crossroadsGroup.position.z) < 3.5
      )
        obj.group.visible = false
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
    const speedRatio = Math.abs(roadSpeed / DEFAULT_ROAD_SPEED)
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

    for (const geo of res.allGeometries) geo.dispose()
    for (const mat of res.allMaterials) mat.dispose()

    for (const templates of Object.values(models))
      for (const tpl of templates as THREE.Object3D[])
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
