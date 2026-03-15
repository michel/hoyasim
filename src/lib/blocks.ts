import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'

// ── Constants ────────────────────────────────────────────────────────

const SPAWN_Z = 100
const CULL_Z = -60
const VISIBLE_Z = 90
const GROUND_Y = -0.9
const ROAD_ROTATION_Y = 1.25
const DEFAULT_ROAD_SPEED = -5.0
const SPEED_STEP = 1.0
const MIN_ROAD_SPEED = -10.0
const MAX_ROAD_SPEED = -1.0
const SPAWN_INTERVAL = 6
const CYCLE_LENGTH = 150

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
  type:
    | 'house'
    | 'tree'
    | 'windmill'
    | 'marking'
    | 'bush'
    | 'flower'
    | 'tulipfield'
    | 'lake'
    | 'cow'
  sails?: THREE.Group
}

export interface BlockResources {
  boxGeo: THREE.BoxGeometry
  trunkGeo: THREE.CylinderGeometry
  canopyGeo: THREE.SphereGeometry
  pineGeo: THREE.ConeGeometry
  towerGeo: THREE.CylinderGeometry
  capGeo: THREE.SphereGeometry
  bushGeo: THREE.SphereGeometry
  flowerHeadGeo: THREE.SphereGeometry
  flowerStemGeo: THREE.CylinderGeometry
  brickMats: THREE.MeshStandardMaterial[]
  glassMat: THREE.MeshStandardMaterial
  frameMat: THREE.MeshStandardMaterial
  doorMat: THREE.MeshStandardMaterial
  roofMat: THREE.MeshStandardMaterial
  redRoofMat: THREE.MeshStandardMaterial
  trimMat: THREE.MeshStandardMaterial
  trunkMat: THREE.MeshStandardMaterial
  leavesMat: THREE.MeshStandardMaterial
  pineMat: THREE.MeshStandardMaterial
  towerMat: THREE.MeshStandardMaterial
  sailMat: THREE.MeshStandardMaterial
  markingMat: THREE.MeshStandardMaterial
  bushMat: THREE.MeshStandardMaterial
  flowerMats: THREE.MeshStandardMaterial[]
  tulipPetalGeo: THREE.SphereGeometry
  // Shared factory materials (avoid per-instance creation)
  windmillBrickMat: THREE.MeshStandardMaterial
  windmillCapMat: THREE.MeshStandardMaterial
  windmillDoorMat: THREE.MeshStandardMaterial
  windmillBalconyMat: THREE.MeshStandardMaterial
  tallGrassMat: THREE.MeshStandardMaterial
  sunflowerYellowMat: THREE.MeshStandardMaterial
  sunflowerCenterMat: THREE.MeshStandardMaterial
  sunflowerLeafMat: THREE.MeshStandardMaterial
  lakeMat: THREE.MeshStandardMaterial
  lakeEdgeMat: THREE.MeshStandardMaterial
  duckMat: THREE.MeshStandardMaterial
  duckBeakMat: THREE.MeshStandardMaterial
  cowBodyMat: THREE.MeshStandardMaterial
  cowSpotMat: THREE.MeshStandardMaterial
  cowPinkMat: THREE.MeshStandardMaterial
  lakeCircleGeo: THREE.CircleGeometry
  lakeRingGeo: THREE.RingGeometry
  duckBodyGeo: THREE.SphereGeometry
  duckHeadGeo: THREE.SphereGeometry
  allMaterials: THREE.Material[]
  allGeometries: THREE.BufferGeometry[]
}

// ── Helpers ──────────────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

const randomSide = (): number => (Math.random() < 0.5 ? 1 : -1)

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
  const pineGeo = new THREE.ConeGeometry(1, 1, 5)
  const towerGeo = new THREE.CylinderGeometry(0.4, 0.7, 1, 5)
  const capGeo = new THREE.SphereGeometry(0.5, 3, 2)
  const bushGeo = new THREE.SphereGeometry(1, 4, 3)
  const flowerHeadGeo = new THREE.SphereGeometry(0.07, 3, 2)
  const flowerStemGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 3)
  const tulipPetalGeo = new THREE.SphereGeometry(0.06, 4, 3)
  tulipPetalGeo.scale(0.8, 1.3, 0.8)

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
  const pineMat = flatMat(0x1a5c2a, 0.95)
  const towerMat = flatMat(0x555555)
  const sailMat = flatMat(0xcccccc, 0.7)
  const markingMat = flatMat(0xffffff, 0.7)
  const bushMat = flatMat(0x3a7d44, 0.95)
  const flowerMats = [0xe84393, 0xfdcb6e, 0x6c5ce7, 0xff7675, 0xffffff].map(
    (c) => flatMat(c, 0.8),
  )
  const grassMat = flatMat(0x6b8e23, 0.95)
  const roadMat = flatMat(0xa55145)
  const sidewalkMat = flatMat(0x888888, 0.95)

  const sharedGeos: THREE.BufferGeometry[] = [
    boxGeo,
    planeGeo,
    trunkGeo,
    canopyGeo,
    pineGeo,
    towerGeo,
    capGeo,
    bushGeo,
    flowerHeadGeo,
    flowerStemGeo,
    tulipPetalGeo,
  ]
  // Factory materials — shared across all instances
  const windmillBrickMat = flatMat(0x8b4513, 0.95)
  const windmillCapMat = flatMat(0x2a2a2a, 0.85)
  const windmillDoorMat = flatMat(0x1a3a1a)
  const windmillBalconyMat = flatMat(0x3a2a1a)
  const tallGrassMat = flatMat(0x7a9a3a, 0.95)
  const sunflowerYellowMat = flatMat(0xffd700, 0.8)
  const sunflowerCenterMat = flatMat(0x3a2a0a)
  const sunflowerLeafMat = flatMat(0x4a7a2a)
  const lakeMat = flatMat(0x3a7cbd, 0.2, { metalness: 0.3 })
  const lakeEdgeMat = flatMat(0x5a8a50, 0.95)
  const duckMat = flatMat(0xffffff, 0.8)
  const duckBeakMat = flatMat(0xf5a623, 0.7)
  const cowBodyMat = flatMat(0xf5f0e8)
  const cowSpotMat = flatMat(0x1a1a1a)
  const cowPinkMat = flatMat(0xf0a0a0, 0.85)

  // Lake geometries — shared across all lake instances
  const lakeCircleGeo = new THREE.CircleGeometry(1, 7)
  const lakeRingGeo = new THREE.RingGeometry(0.92, 1.08, 7)
  const duckBodyGeo = new THREE.SphereGeometry(0.1, 5, 4)
  const duckHeadGeo = new THREE.SphereGeometry(0.05, 4, 3)

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
    pineMat,
    towerMat,
    sailMat,
    markingMat,
    bushMat,
    ...flowerMats,
    grassMat,
    roadMat,
    sidewalkMat,
    windmillBrickMat,
    windmillCapMat,
    windmillDoorMat,
    windmillBalconyMat,
    tallGrassMat,
    sunflowerYellowMat,
    sunflowerCenterMat,
    sunflowerLeafMat,
    lakeMat,
    lakeEdgeMat,
    duckMat,
    duckBeakMat,
    cowBodyMat,
    cowSpotMat,
    cowPinkMat,
  ]

  return {
    boxGeo,
    planeGeo,
    trunkGeo,
    canopyGeo,
    pineGeo,
    towerGeo,
    capGeo,
    bushGeo,
    flowerHeadGeo,
    flowerStemGeo,
    brickMats,
    glassMat,
    frameMat,
    doorMat,
    roofMat,
    redRoofMat,
    trimMat,
    trunkMat,
    leavesMat,
    pineMat,
    towerMat,
    sailMat,
    markingMat,
    bushMat,
    flowerMats,
    tulipPetalGeo,
    windmillBrickMat,
    windmillCapMat,
    windmillDoorMat,
    windmillBalconyMat,
    tallGrassMat,
    sunflowerYellowMat,
    sunflowerCenterMat,
    sunflowerLeafMat,
    lakeMat,
    lakeEdgeMat,
    duckMat,
    duckBeakMat,
    cowBodyMat,
    cowSpotMat,
    cowPinkMat,
    lakeCircleGeo,
    lakeRingGeo,
    duckBodyGeo,
    duckHeadGeo,
    grassMat,
    roadMat,
    sidewalkMat,
    allGeometries: [
      ...sharedGeos,
      lakeCircleGeo,
      lakeRingGeo,
      duckBodyGeo,
      duckHeadGeo,
    ],
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

export function createPine(res: BlockResources): THREE.Group {
  const g = new THREE.Group()
  const trunkH = rand(0.8, 1.5)
  const trunk = new THREE.Mesh(res.trunkGeo, res.trunkMat)
  trunk.scale.y = trunkH
  trunk.position.y = trunkH / 2
  g.add(trunk)

  const layers = Math.floor(rand(2, 4))
  const baseR = rand(0.6, 1.2)
  const layerH = rand(1, 1.5)
  for (let i = 0; i < layers; i++) {
    const r = baseR * (1 - i * 0.2)
    const cone = new THREE.Mesh(res.pineGeo, res.pineMat)
    cone.scale.set(r, layerH, r)
    cone.position.y = trunkH + i * layerH * 0.6 + layerH / 2
    g.add(cone)
  }

  return g
}

export function createRandomTree(res: BlockResources): THREE.Group {
  return Math.random() < 0.4 ? createPine(res) : createTree(res)
}

export function createWindmill(res: BlockResources): {
  group: THREE.Group
  sails: THREE.Group
} {
  const {
    windmillBrickMat,
    windmillCapMat,
    windmillDoorMat,
    windmillBalconyMat,
  } = res
  const g = new THREE.Group()
  const towerH = rand(4, 6)
  const baseR = 0.9
  const topR = 0.5

  // Tapered tower body (wider base, narrower top)
  const towerBody = new THREE.Mesh(
    new THREE.CylinderGeometry(topR, baseR, towerH, 8),
    windmillBrickMat,
  )
  towerBody.position.y = towerH / 2
  g.add(towerBody)

  // Horizontal brick bands
  for (let i = 1; i <= 3; i++) {
    const bandY = towerH * (i / 4)
    const r = baseR + (topR - baseR) * (i / 4) + 0.03
    const band = new THREE.Mesh(res.boxGeo, res.trimMat)
    band.scale.set(r * 2.1, 0.06, r * 2.1)
    band.position.y = bandY
    g.add(band)
  }

  // Onion-shaped cap (stretched sphere + cone)
  const capBase = new THREE.Mesh(res.capGeo, windmillCapMat)
  capBase.scale.set(topR + 0.1, 0.5, topR + 0.1)
  capBase.position.y = towerH + 0.15
  g.add(capBase)

  const capTip = new THREE.Mesh(res.pineGeo, windmillCapMat)
  capTip.scale.set(0.2, 0.6, 0.2)
  capTip.position.y = towerH + 0.7
  g.add(capTip)

  // Balcony/gallery around the top
  const balconyR = topR + 0.25
  const balcony = new THREE.Mesh(
    new THREE.CylinderGeometry(balconyR, balconyR, 0.06, 10),
    windmillBalconyMat,
  )
  balcony.position.y = towerH - 0.1
  g.add(balcony)

  // Balcony railing posts
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2
    const post = new THREE.Mesh(res.boxGeo, windmillBalconyMat)
    post.scale.set(0.04, 0.25, 0.04)
    post.position.set(
      Math.cos(angle) * balconyR,
      towerH + 0.02,
      Math.sin(angle) * balconyR,
    )
    g.add(post)
  }

  // Door at base
  const door = new THREE.Mesh(res.boxGeo, windmillDoorMat)
  door.scale.set(0.45, 0.8, 0.08)
  door.position.set(0, 0.4, baseR + 0.01)
  g.add(door)

  // Door frame
  const doorFrame = new THREE.Mesh(res.boxGeo, res.trimMat)
  doorFrame.scale.set(0.55, 0.9, 0.06)
  doorFrame.position.set(0, 0.4, baseR - 0.01)
  g.add(doorFrame)

  // Small windows
  for (let i = 1; i <= 2; i++) {
    const wy = towerH * (i / 3)
    const wr = baseR + (topR - baseR) * (i / 3)
    const win = new THREE.Mesh(res.boxGeo, res.glassMat)
    win.scale.set(0.2, 0.3, 0.06)
    win.position.set(0, wy, wr + 0.02)
    g.add(win)
    const winFrame = new THREE.Mesh(res.boxGeo, res.frameMat)
    winFrame.scale.set(0.26, 0.36, 0.04)
    winFrame.position.set(0, wy, wr)
    g.add(winFrame)
  }

  // Sails — lattice-style with spine + cross-bars
  const sails = new THREE.Group()
  sails.position.y = towerH * 0.85
  sails.position.z = topR + 0.15
  const sailLen = rand(2.5, 3.5)

  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group()
    arm.rotation.z = (i * Math.PI) / 2

    // Main spine
    const spine = new THREE.Mesh(res.boxGeo, windmillBalconyMat)
    spine.scale.set(0.08, sailLen, 0.04)
    spine.position.y = sailLen / 2
    arm.add(spine)

    // Sail cloth (offset to one side of spine, like real windmills)
    const clothW = sailLen * 0.22
    const cloth = new THREE.Mesh(res.boxGeo, res.sailMat)
    cloth.scale.set(clothW, sailLen * 0.85, 0.02)
    cloth.position.set(clothW / 2 + 0.04, sailLen * 0.5, 0)
    arm.add(cloth)

    // Cross-bars along the spine
    const bars = 5
    for (let b = 0; b < bars; b++) {
      const by = sailLen * 0.15 + (b / bars) * sailLen * 0.75
      const bar = new THREE.Mesh(res.boxGeo, windmillBalconyMat)
      bar.scale.set(clothW + 0.1, 0.03, 0.03)
      bar.position.set(clothW / 2, by, 0)
      arm.add(bar)
    }

    sails.add(arm)
  }

  // Hub at sail center
  const hub = new THREE.Mesh(res.capGeo, windmillCapMat)
  hub.scale.setScalar(0.15)
  sails.add(hub)

  g.add(sails)

  return { group: g, sails }
}

export function createRoadMarking(res: BlockResources): THREE.Mesh {
  const marking = new THREE.Mesh(res.boxGeo, res.markingMat)
  marking.scale.set(0.15, 0.02, 1.5)
  marking.position.set(0, 0.01, 0)
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

export function createFlowerCluster(res: BlockResources): THREE.Group {
  const g = new THREE.Group()
  const count = Math.floor(rand(3, 7))
  for (let i = 0; i < count; i++) {
    const h = rand(0.2, 0.45)
    const mat =
      res.flowerMats[Math.floor(Math.random() * res.flowerMats.length)]
    const stem = new THREE.Mesh(res.flowerStemGeo, res.bushMat)
    stem.scale.y = h
    stem.position.set(rand(-0.3, 0.3), h / 2, rand(-0.3, 0.3))
    g.add(stem)
    const head = new THREE.Mesh(res.flowerHeadGeo, mat)
    head.position.set(stem.position.x, h + 0.06, stem.position.z)
    g.add(head)
  }
  return g
}

export function createTulipField(
  res: BlockResources,
  large = false,
): THREE.Group {
  const g = new THREE.Group()
  const rows = large ? Math.floor(rand(8, 13)) : Math.floor(rand(4, 7))
  const cols = large ? Math.floor(rand(16, 25)) : Math.floor(rand(8, 15))
  const rowSpacing = 0.25
  const colSpacing = 0.18
  let numColors: number
  if (large) numColors = Math.floor(rand(2, 4))
  else numColors = Math.random() < 0.5 ? 1 : 2
  const colorA =
    res.flowerMats[Math.floor(Math.random() * res.flowerMats.length)]
  const colorB =
    numColors >= 2
      ? res.flowerMats[Math.floor(Math.random() * res.flowerMats.length)]
      : colorA
  const colorC =
    numColors >= 3
      ? res.flowerMats[Math.floor(Math.random() * res.flowerMats.length)]
      : colorA

  const stemGeos: THREE.BufferGeometry[] = []
  const headsByMat = new Map<THREE.Material, THREE.BufferGeometry[]>()

  for (let r = 0; r < rows; r++) {
    const mat =
      numColors >= 3
        ? [colorA, colorB, colorC][r % 3]
        : r % 2 === 0
          ? colorA
          : colorB
    if (!headsByMat.has(mat)) headsByMat.set(mat, [])
    const heads = headsByMat.get(mat) ?? []
    for (let c = 0; c < cols; c++) {
      const h = rand(0.3, 0.5)
      const x = c * colSpacing - (cols * colSpacing) / 2 + rand(-0.03, 0.03)
      const z = r * rowSpacing - (rows * rowSpacing) / 2 + rand(-0.03, 0.03)

      const sg = res.flowerStemGeo.clone()
      sg.scale(1, h, 1)
      sg.translate(x, h / 2, z)
      stemGeos.push(sg)

      const hg = res.tulipPetalGeo.clone()
      const m = new THREE.Matrix4()
      m.makeRotationFromEuler(
        new THREE.Euler(rand(-0.15, 0.15), 0, rand(-0.15, 0.15)),
      )
      m.setPosition(x, h + 0.08, z)
      hg.applyMatrix4(m)
      heads.push(hg)
    }
  }

  if (stemGeos.length > 0)
    g.add(
      new THREE.Mesh(
        BufferGeometryUtils.mergeGeometries(stemGeos),
        res.bushMat,
      ),
    )
  for (const [mat, geos] of headsByMat)
    g.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(geos), mat))
  return g
}

export function createGrassTuft(res: BlockResources): THREE.Group {
  const g = new THREE.Group()
  const blades = Math.floor(rand(5, 12))
  const geos: THREE.BufferGeometry[] = []
  for (let i = 0; i < blades; i++) {
    const h = rand(0.15, 0.4)
    const bg = res.flowerStemGeo.clone()
    bg.scale(1.5, h, 1.5)
    const m = new THREE.Matrix4()
    m.makeRotationFromEuler(
      new THREE.Euler(rand(-0.2, 0.2), 0, rand(-0.2, 0.2)),
    )
    m.setPosition(rand(-0.2, 0.2), h / 2, rand(-0.2, 0.2))
    bg.applyMatrix4(m)
    geos.push(bg)
  }
  if (geos.length > 0)
    g.add(
      new THREE.Mesh(
        BufferGeometryUtils.mergeGeometries(geos),
        res.tallGrassMat,
      ),
    )
  return g
}

export function createSunflowerPatch(res: BlockResources): THREE.Group {
  const { sunflowerYellowMat, sunflowerCenterMat, sunflowerLeafMat } = res
  const g = new THREE.Group()
  const count = Math.floor(rand(5, 12))
  const stemGeos: THREE.BufferGeometry[] = []
  const petalGeos: THREE.BufferGeometry[] = []
  const centerGeos: THREE.BufferGeometry[] = []
  const leafGeos: THREE.BufferGeometry[] = []
  for (let i = 0; i < count; i++) {
    const h = rand(0.8, 1.4)
    const sx = rand(-1.5, 1.5)
    const sz = rand(-1.5, 1.5)

    const sg = res.flowerStemGeo.clone()
    sg.scale(2, h, 2)
    sg.translate(sx, h / 2, sz)
    stemGeos.push(sg)

    const pg = res.flowerHeadGeo.clone()
    pg.scale(2.5, 2.5, 0.5)
    pg.translate(sx, h + 0.05, sz)
    petalGeos.push(pg)

    const cg = res.flowerHeadGeo.clone()
    cg.scale(1.4, 1.4, 0.7)
    cg.translate(sx, h + 0.06, sz)
    centerGeos.push(cg)

    if (Math.random() < 0.6) {
      const lg = res.bushGeo.clone()
      lg.scale(0.12, 0.06, 0.15)
      lg.translate(sx + 0.1, h * 0.5, sz)
      leafGeos.push(lg)
    }
  }
  if (stemGeos.length > 0) {
    g.add(
      new THREE.Mesh(
        BufferGeometryUtils.mergeGeometries(stemGeos.concat(leafGeos)),
        sunflowerLeafMat,
      ),
    )
    g.add(
      new THREE.Mesh(
        BufferGeometryUtils.mergeGeometries(petalGeos),
        sunflowerYellowMat,
      ),
    )
    g.add(
      new THREE.Mesh(
        BufferGeometryUtils.mergeGeometries(centerGeos),
        sunflowerCenterMat,
      ),
    )
  }
  return g
}

export function createLake(res: BlockResources): THREE.Group {
  const {
    lakeMat,
    lakeEdgeMat,
    duckMat,
    duckBeakMat,
    lakeCircleGeo,
    lakeRingGeo,
    duckBodyGeo,
    duckHeadGeo,
  } = res

  const g = new THREE.Group()
  const w = rand(5, 10)
  const d = rand(3, 7)

  const water = new THREE.Mesh(lakeCircleGeo, lakeMat)
  water.rotation.x = -Math.PI / 2
  water.scale.set(w, d, 1)
  water.position.y = 0.02
  g.add(water)

  const edge = new THREE.Mesh(lakeRingGeo, lakeEdgeMat)
  edge.rotation.x = -Math.PI / 2
  edge.scale.set(w, d, 1)
  edge.position.y = 0.015
  g.add(edge)

  const grassCount = Math.floor(rand(3, 7))
  for (let i = 0; i < grassCount; i++) {
    const angle = rand(0, Math.PI * 2)
    const bush = createBush(res)
    bush.position.set(Math.cos(angle) * w * 0.95, 0, Math.sin(angle) * d * 0.95)
    bush.scale.setScalar(rand(0.5, 0.8))
    g.add(bush)
  }

  const duckCount = Math.floor(rand(2, 5))
  const duckWhiteGeos: THREE.BufferGeometry[] = []
  const duckBeakGeos: THREE.BufferGeometry[] = []
  for (let i = 0; i < duckCount; i++) {
    const dx = rand(-0.6, 0.6) * w
    const dz = rand(-0.6, 0.6) * d
    const dy = 0.02
    const rot = rand(0, Math.PI * 2)
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)

    const bg = duckBodyGeo.clone()
    bg.scale(1, 0.7, 1.3)
    const bm = new THREE.Matrix4()
      .makeRotationY(rot)
      .setPosition(dx, dy + 0.05, dz)
    bg.applyMatrix4(bm)
    duckWhiteGeos.push(bg)

    const hg = duckHeadGeo.clone()
    const hm = new THREE.Matrix4()
      .makeRotationY(rot)
      .setPosition(dx + sin * 0.12, dy + 0.1, dz + cos * 0.12)
    hg.applyMatrix4(hm)
    duckWhiteGeos.push(hg)

    const bkg = duckHeadGeo.clone()
    bkg.scale(0.5, 0.4, 1)
    const bkm = new THREE.Matrix4()
      .makeRotationY(rot)
      .setPosition(dx + sin * 0.17, dy + 0.09, dz + cos * 0.17)
    bkg.applyMatrix4(bkm)
    duckBeakGeos.push(bkg)
  }
  if (duckWhiteGeos.length > 0)
    g.add(
      new THREE.Mesh(
        BufferGeometryUtils.mergeGeometries(duckWhiteGeos),
        duckMat,
      ),
    )
  if (duckBeakGeos.length > 0)
    g.add(
      new THREE.Mesh(
        BufferGeometryUtils.mergeGeometries(duckBeakGeos),
        duckBeakMat,
      ),
    )

  return g
}

export function createCow(res: BlockResources): THREE.Group {
  const { cowBodyMat, cowSpotMat, cowPinkMat } = res
  const g = new THREE.Group()

  const bodyGeos: THREE.BufferGeometry[] = []
  const spotGeos: THREE.BufferGeometry[] = []
  const pinkGeos: THREE.BufferGeometry[] = []

  bodyGeos.push(scaledBoxGeo(res.boxGeo, 0.4, 0.35, 0.7, 0, 0.45, 0))
  bodyGeos.push(scaledBoxGeo(res.boxGeo, 0.22, 0.22, 0.2, 0, 0.55, 0.4))

  for (const side of [-1, 1])
    bodyGeos.push(
      scaledBoxGeo(res.boxGeo, 0.06, 0.06, 0.1, side * 0.14, 0.62, 0.38),
    )

  for (const xOff of [-0.12, 0.12])
    for (const zOff of [-0.2, 0.2])
      bodyGeos.push(
        scaledBoxGeo(res.boxGeo, 0.08, 0.28, 0.08, xOff, 0.14, zOff),
      )

  const spots = Math.floor(rand(4, 8))
  for (let i = 0; i < spots; i++) {
    const sg = res.bushGeo.clone()
    sg.scale(rand(0.1, 0.22), rand(0.08, 0.15), rand(0.12, 0.25))
    const spotX = rand(-0.15, 0.15)
    const spotZ = rand(-0.28, 0.28)
    const spotY = 0.45 + rand(-0.04, 0.12)
    sg.translate(spotX, spotY, spotZ)
    spotGeos.push(sg)
  }
  if (Math.random() < 0.6) {
    const hsg = res.bushGeo.clone()
    hsg.scale(rand(0.06, 0.12), rand(0.05, 0.09), rand(0.06, 0.1))
    hsg.translate(
      rand(-0.06, 0.06),
      0.55 + rand(0, 0.08),
      0.4 + rand(-0.05, 0.05),
    )
    spotGeos.push(hsg)
  }

  const tg = res.flowerStemGeo.clone()
  tg.scale(1, 0.3, 1)
  const tm = new THREE.Matrix4()
  tm.makeRotationX(rand(0.2, 0.5))
  tm.setPosition(0, 0.5, -0.38)
  tg.applyMatrix4(tm)
  spotGeos.push(tg)

  pinkGeos.push(scaledBoxGeo(res.boxGeo, 0.14, 0.1, 0.08, 0, 0.5, 0.5))

  g.add(
    new THREE.Mesh(BufferGeometryUtils.mergeGeometries(bodyGeos), cowBodyMat),
  )
  g.add(
    new THREE.Mesh(BufferGeometryUtils.mergeGeometries(spotGeos), cowSpotMat),
  )
  g.add(
    new THREE.Mesh(BufferGeometryUtils.mergeGeometries(pinkGeos), cowPinkMat),
  )

  g.rotation.y = rand(0, Math.PI * 2)
  return g
}

export function createMountainProfile(
  segLen: number,
  peaks: number,
  minH: number,
  maxH: number,
): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(0, -0.5)
  shape.lineTo(0, 0)

  const segWidth = segLen / peaks
  for (let i = 0; i < peaks; i++) {
    const x0 = i * segWidth
    const peakX = x0 + segWidth * rand(0.3, 0.7)
    const peakH = rand(minH, maxH)
    const midX = x0 + segWidth * rand(0.1, 0.3)
    const midH = rand(minH * 0.3, peakH * 0.5)

    shape.lineTo(midX, midH)
    shape.lineTo(peakX, peakH)
    shape.lineTo(x0 + segWidth * rand(0.75, 0.9), rand(minH * 0.2, peakH * 0.4))
  }

  shape.lineTo(segLen, 0)
  shape.lineTo(segLen, -0.5)
  shape.lineTo(0, -0.5)

  return shape
}

// ── Factory ─────────────────────────────────────────────────────────

export function createBlocks(scene: THREE.Scene): BlocksState {
  const group = new THREE.Group()
  group.position.y = GROUND_Y
  group.rotation.y = ROAD_ROTATION_Y

  const res = createBlockResources()

  // ── Static ground geometry ──────────────────────────────────────

  const staticMeshes: THREE.Mesh[] = []
  const groundLen = 400

  const groundStrips: [number, THREE.Material, number, number][] = [
    [60, res.grassMat, 0, -0.01],
    [3, res.roadMat, 0, 0],
    [0.6, res.sidewalkMat, -1.8, 0.001],
    [0.6, res.sidewalkMat, 1.8, 0.001],
    [2, res.roadMat, 9, 0],
    [2, res.roadMat, -9, 0],
    [0.5, res.sidewalkMat, 10.3, 0.001],
    [0.5, res.sidewalkMat, -10.3, 0.001],
  ]
  for (const [width, mat, x, y] of groundStrips) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, groundLen), mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, y, 30)
    if (y < 0) mesh.receiveShadow = true
    group.add(mesh)
    staticMeshes.push(mesh)
  }

  scene.add(group)

  // ── Parallax mountains ────────────────────────────────────────

  interface MountainLayer {
    meshL: THREE.Mesh
    meshR: THREE.Mesh
    speed: number
  }

  const mountainLayers: MountainLayer[] = []
  const mtSegLen = groundLen * 2

  const layerConfigs = [
    { z: 35, minH: 3, maxH: 7, color: 0x6878a0, speed: 0.04, peaks: 8 },
    { z: 26, minH: 2, maxH: 5, color: 0x4a6050, speed: 0.08, peaks: 10 },
    { z: 20, minH: 1.5, maxH: 3.5, color: 0x3a5040, speed: 0.14, peaks: 14 },
  ]

  for (const cfg of layerConfigs) {
    const mat = new THREE.MeshStandardMaterial({
      color: cfg.color,
      flatShading: true,
      roughness: 0.95,
      side: THREE.DoubleSide,
      fog: false,
    })
    res.allMaterials.push(mat)

    const meshL = new THREE.Mesh(
      new THREE.ShapeGeometry(
        createMountainProfile(mtSegLen, cfg.peaks, cfg.minH, cfg.maxH),
      ),
      mat,
    )
    const meshR = new THREE.Mesh(
      new THREE.ShapeGeometry(
        createMountainProfile(mtSegLen, cfg.peaks, cfg.minH, cfg.maxH),
      ),
      mat,
    )
    meshL.position.set(-mtSegLen / 2, GROUND_Y - 0.5, -cfg.z)
    meshR.position.set(-mtSegLen / 2, GROUND_Y - 0.5, cfg.z)
    meshL.renderOrder = -cfg.z
    meshR.renderOrder = -cfg.z
    scene.add(meshL, meshR)

    mountainLayers.push({ meshL, meshR, speed: cfg.speed })
  }

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
      child.shadow.camera.left = -15
      child.shadow.camera.right = 15
      child.shadow.camera.top = 15
      child.shadow.camera.bottom = -15
      child.shadow.camera.near = 0.1
      child.shadow.camera.far = 30
    }
  })

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8)
  scene.add(hemiLight)

  // ── Speed control ─────────────────────────────────────────────

  let roadSpeed = DEFAULT_ROAD_SPEED

  function onSpeedKey(e: KeyboardEvent) {
    if (e.key === 'ArrowUp') {
      roadSpeed = Math.max(MIN_ROAD_SPEED, roadSpeed - SPEED_STEP)
      e.preventDefault()
    } else if (e.key === 'ArrowDown') {
      roadSpeed = Math.min(MAX_ROAD_SPEED, roadSpeed + SPEED_STEP)
      e.preventDefault()
    }
  }

  window.addEventListener('keydown', onSpeedKey)

  // ── Spawned objects tracking ────────────────────────────────────

  const spawned: SpawnedObject[] = []

  function spawn(
    obj: THREE.Object3D,
    type: SpawnedObject['type'],
    sails?: THREE.Group,
  ) {
    group.add(obj)
    spawned.push({ group: obj, type, ...(sails && { sails }) })
  }

  function disposeObject(obj: SpawnedObject) {
    group.remove(obj.group)
    obj.group.traverse((child) => {
      if (child instanceof THREE.Mesh) child.geometry.dispose()
    })
  }

  function spawnRow(z: number, zone: Zone) {
    if (zone === 'city' || zone === 'transition') {
      if (zone === 'city' || Math.random() < 0.5) {
        const house = createHouse(res)
        house.rotation.y = Math.PI
        house.position.set(rand(4.0, 4.5), 0, z)
        spawn(house, 'house')
      }

      if (zone === 'city' || Math.random() < 0.5) {
        const house = createHouse(res)
        house.position.set(rand(-4.5, -4.0), 0, z)
        spawn(house, 'house')
      }

      if (zone === 'city' || Math.random() < 0.3) {
        const house = createHouse(res)
        house.rotation.y = Math.PI
        house.position.set(rand(11.0, 11.5), 0, z + rand(1.5, 3.5))
        spawn(house, 'house')
      }
      if (zone === 'city' || Math.random() < 0.3) {
        const house = createHouse(res)
        house.rotation.y = 0
        house.position.set(rand(-11.5, -11.0), 0, z + rand(1.5, 3.5))
        spawn(house, 'house')
      }

      if (Math.random() < 0.4) {
        const tree = createTree(res)
        tree.position.set(rand(2.0, 6.0), 0, z + SPAWN_INTERVAL * 0.5)
        spawn(tree, 'tree')
      }
      if (Math.random() < 0.4) {
        const tree = createTree(res)
        tree.position.set(-rand(2.0, 6.0), 0, z + SPAWN_INTERVAL * 0.5)
        spawn(tree, 'tree')
      }

      if (Math.random() < 0.15) {
        const bush = createBush(res)
        bush.position.set(
          rand(2.0, 3.0) * randomSide(),
          0,
          z + rand(0, SPAWN_INTERVAL),
        )
        spawn(bush, 'bush')
      }

      // Flower boxes / clusters near sidewalks
      for (const side of [1, -1]) {
        if (Math.random() < 0.4) {
          const flowers = createFlowerCluster(res)
          flowers.position.set(
            side * rand(2.5, 3.5),
            0,
            z + rand(0, SPAWN_INTERVAL),
          )
          flowers.scale.setScalar(0.6)
          spawn(flowers, 'flower')
        }
      }
    }

    const marking = createRoadMarking(res)
    marking.position.set(0, 0, z)
    spawn(marking, 'marking')

    // Determine lake side early so all far-field spawns can avoid it
    let lakeSide = 0
    if (zone === 'nature' && Math.random() < 0.4) lakeSide = randomSide()

    if (zone === 'nature' || zone === 'transition') {
      // Trees on both sides (1-2 per side)
      for (const side of [1, -1]) {
        if (zone === 'nature' || Math.random() < 0.5) {
          const count = Math.floor(rand(1, 3))
          for (let i = 0; i < count; i++) {
            const tree = createRandomTree(res)
            tree.position.set(
              side * rand(2.5, 8.0),
              0,
              z + rand(0, SPAWN_INTERVAL) * i,
            )
            spawn(tree, 'tree')
          }
        }
      }

      // Bushes (near road)
      for (const side of [1, -1]) {
        if (Math.random() < 0.8) {
          const bushCount = Math.floor(rand(1, 3))
          for (let i = 0; i < bushCount; i++) {
            const bush = createBush(res)
            bush.position.set(
              side * rand(2.0, 8.0),
              0,
              z + rand(0, SPAWN_INTERVAL),
            )
            spawn(bush, 'bush')
          }
        }
      }

      // Trees and bushes beyond back roads (avoid lake side)
      if (zone === 'nature') {
        for (const side of [1, -1]) {
          if (side === lakeSide) continue
          const treeCount = Math.floor(rand(2, 5))
          for (let i = 0; i < treeCount; i++) {
            const tree = createRandomTree(res)
            tree.position.set(
              side * rand(11, 22),
              0,
              z + rand(0, SPAWN_INTERVAL),
            )
            spawn(tree, 'tree')
          }
          const bushCount = Math.floor(rand(2, 4))
          for (let i = 0; i < bushCount; i++) {
            const bush = createBush(res)
            bush.position.set(
              side * rand(11, 20),
              0,
              z + rand(0, SPAWN_INTERVAL),
            )
            spawn(bush, 'bush')
          }
        }
      }

      // Sunflower patches
      if (zone === 'nature' && Math.random() < 0.45) {
        let side = randomSide()
        if (side === lakeSide) side = -side
        const patch = createSunflowerPatch(res)
        patch.position.set(side * rand(5, 18), 0, z + rand(0, SPAWN_INTERVAL))
        spawn(patch, 'flower')
      }

      // Grass tufts (nature — dense)
      if (zone === 'nature') {
        const tufts = Math.floor(rand(5, 10))
        for (let i = 0; i < tufts; i++) {
          let side = randomSide()
          const x = rand(2, 22)
          if (side === lakeSide && x > 10) side = -side
          const grass = createGrassTuft(res)
          grass.position.set(x * side, 0, z + rand(0, SPAWN_INTERVAL))
          spawn(grass, 'bush')
        }
      }

      // Flowers (nature only) — both sides independently
      for (const side of [1, -1]) {
        if (zone === 'nature' && Math.random() < 0.65) {
          const flowers = createFlowerCluster(res)
          flowers.position.set(
            side * rand(2.0, 6.0),
            0,
            z + rand(0, SPAWN_INTERVAL),
          )
          spawn(flowers, 'flower')
        }
      }

      // Tulip fields
      if (zone === 'nature' && Math.random() < 0.25) {
        const side = randomSide()
        const field = createTulipField(res)
        field.position.set(side * rand(3, 8), 0, z + rand(0, SPAWN_INTERVAL))
        field.rotation.y = rand(-0.15, 0.15)
        spawn(field, 'tulipfield')
      }

      // Large tulip fields beyond back roads (avoid lake side)
      for (const side of [1, -1]) {
        if (side === lakeSide) continue
        if (zone === 'nature' && Math.random() < 0.35) {
          const field = createTulipField(res, true)
          field.position.set(
            side * rand(12, 20),
            0,
            z + rand(0, SPAWN_INTERVAL),
          )
          field.rotation.y = rand(-0.15, 0.15)
          spawn(field, 'tulipfield')
        }
      }

      // Lakes
      if (lakeSide !== 0) {
        const lake = createLake(res)
        lake.position.set(
          lakeSide * rand(14, 22),
          0,
          z + rand(0, SPAWN_INTERVAL),
        )
        lake.rotation.y = rand(0, Math.PI)
        spawn(lake, 'lake')
      }

      // Cows in small herds (avoid lake side)
      if (zone === 'nature' && Math.random() < 0.35) {
        let side = randomSide()
        if (side === lakeSide) side = -side
        const herdSize = Math.floor(rand(3, 7))
        const baseX = side * rand(12, 19)
        const baseZ = z + rand(0, SPAWN_INTERVAL)
        for (let i = 0; i < herdSize; i++) {
          const cow = createCow(res)
          cow.position.set(baseX + rand(-2, 2), 0, baseZ + rand(-2, 2))
          spawn(cow, 'cow')
        }
      }

      // Rare windmills
      if (zone === 'nature' && Math.random() < 0.15) {
        const side = randomSide()
        const wm = createWindmill(res)
        wm.group.position.set(side * rand(6.0, 10.0), 0, z)
        wm.group.rotation.y = Math.PI
        spawn(wm.group, 'windmill', wm.sails)
      }
    }
  }

  // ── Initial population ──────────────────────────────────────────

  let distanceTraveled = 0
  let spawnAccumulator = 0

  for (let z = CULL_Z; z <= SPAWN_Z; z += SPAWN_INTERVAL)
    spawnRow(z, getZone(z))

  // ── Update loop ─────────────────────────────────────────────────

  let elapsed = 0

  const cameraOffset: CameraOffset = { x: 0, y: 0 }

  function update(delta: number): CameraOffset {
    if (delta > 1) return { x: 0, y: 0 }
    elapsed += delta
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

    for (const obj of spawned) {
      if (obj.sails) obj.sails.rotation.z += delta * 1.0
    }

    for (const { meshL, meshR, speed } of mountainLayers) {
      const mdx = roadSpeed * speed * delta
      meshL.position.x += mdx
      meshR.position.x += mdx
      if (meshL.position.x < -mtSegLen) {
        meshL.position.x += mtSegLen
        meshR.position.x += mtSegLen
      }
    }

    const vibrationX =
      Math.sin(elapsed * 47) * 0.0008 + Math.sin(elapsed * 31) * 0.0005
    const vibrationY =
      Math.sin(elapsed * 53) * 0.001 + Math.sin(elapsed * 37) * 0.0006

    // Pedaling bob — cadence scales with speed
    const speedRatio = Math.abs(roadSpeed / DEFAULT_ROAD_SPEED)
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

    for (const { meshL, meshR } of mountainLayers) {
      scene.remove(meshL, meshR)
      meshL.geometry.dispose()
      meshR.geometry.dispose()
    }

    for (const geo of res.allGeometries) geo.dispose()
    for (const mat of res.allMaterials) mat.dispose()

    scene.remove(group)
  }

  return { update, dispose }
}
