import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'

// ── Constants ────────────────────────────────────────────────────────

const SPAWN_Z = 100
const CULL_Z = -60
const GROUND_Y = -0.9
const ROAD_ROTATION_Y = 1.25
const ROAD_SPEED = -5.0
const SPAWN_INTERVAL = 6
const CYCLE_LENGTH = 300

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
  type: 'house' | 'tree' | 'windmill' | 'marking' | 'bush' | 'flower'
  sails?: THREE.Group
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

// ── Factory ─────────────────────────────────────────────────────────

export function createBlocks(scene: THREE.Scene): BlocksState {
  const group = new THREE.Group()
  group.position.y = GROUND_Y
  group.rotation.y = ROAD_ROTATION_Y

  // ── Shared geometries & materials ──────────────────────────────

  const boxGeo = new THREE.BoxGeometry(1, 1, 1)
  const planeGeo = new THREE.PlaneGeometry(1, 1)
  const trunkGeo = new THREE.CylinderGeometry(0.1, 0.15, 1, 5)
  const canopyGeo = new THREE.SphereGeometry(1, 6, 4)
  const pineGeo = new THREE.ConeGeometry(1, 1, 6)
  const towerGeo = new THREE.CylinderGeometry(0.4, 0.7, 1, 5)
  const capGeo = new THREE.SphereGeometry(0.5, 4, 3)
  const bushGeo = new THREE.SphereGeometry(1, 5, 4)
  const flowerHeadGeo = new THREE.SphereGeometry(0.12, 4, 3)
  const flowerStemGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 3)

  const brickColors = [
    0x4a2c2a, 0x3e2723, 0x5d4037, 0x2a2a2a, 0x1a1a1a, 0x8b4513,
  ]
  const brickMats = brickColors.map(
    (c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.9 }),
  )
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x4488aa,
    emissive: 0x112233,
    emissiveIntensity: 0.3,
    flatShading: true,
    roughness: 0.3,
    metalness: 0.1,
  })
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.7 })
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, flatShading: true, roughness: 0.9 })
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x222222, flatShading: true, roughness: 0.9 })
  const redRoofMat = new THREE.MeshStandardMaterial({ color: 0x8b2500, flatShading: true, roughness: 0.85 })
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, flatShading: true, roughness: 0.7 })
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3728, flatShading: true, roughness: 0.9 })
  const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2e8b57, flatShading: true, roughness: 0.95 })
  const pineMat = new THREE.MeshStandardMaterial({ color: 0x1a5c2a, flatShading: true, roughness: 0.95 })
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x555555, flatShading: true, roughness: 0.9 })
  const sailMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, flatShading: true, roughness: 0.7 })
  const markingMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.7 })
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x3a7d44, flatShading: true, roughness: 0.95 })
  const flowerColors = [0xe84393, 0xfdcb6e, 0x6c5ce7, 0xff7675, 0xffffff]
  const flowerMats = flowerColors.map(
    (c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.8 }),
  )
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x6b8e23, flatShading: true, roughness: 0.95 })
  const roadMat = new THREE.MeshStandardMaterial({ color: 0xa55145, flatShading: true, roughness: 0.9 })
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x888888, flatShading: true, roughness: 0.95 })

  const sharedGeos = [
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
  ]
  const sharedMats = [
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
  ]

  // ── Object factories ──────────────────────────────────────────

  function scaledBoxGeo(
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

  function createHouse(): THREE.Group {
    const g = new THREE.Group()
    const mat = brickMats[Math.floor(Math.random() * brickMats.length)]

    // Amsterdam proportions: narrow facade (d along road), deep building (w away from road)
    const d = rand(3.5, 4.5)
    const w = rand(2, 3.5)
    const h = rand(2.5, 4.5)

    const brickGeos: THREE.BufferGeometry[] = []
    const trimGeos: THREE.BufferGeometry[] = []
    const frameGeos: THREE.BufferGeometry[] = []
    const glassGeos: THREE.BufferGeometry[] = []
    const doorGeos: THREE.BufferGeometry[] = []

    // Main body
    brickGeos.push(scaledBoxGeo(w, h, d, 0, h / 2, 0))

    // Mid-floor trim band (proportional to height)
    const trimY = h * 0.45
    trimGeos.push(scaledBoxGeo(w + 0.1, 0.08, d + 0.1, 0, trimY, 0))

    // Roof style: 60% stepped gable, 40% flat cornice
    const isSteppedGable = Math.random() < 0.6
    const wallThick = 0.2 // facade wall thickness
    const facadeX = w / 2 - wallThick / 2 // center of facade wall in X

    let gableTopY = h
    if (isSteppedGable) {
      const steps = Math.floor(rand(3, 6))
      const stepH = 0.35
      let gableD = d
      for (let i = 0; i < steps; i++) {
        gableD *= 0.78
        const sy = h + i * stepH + stepH / 2
        // Thin wall at facade face, narrowing in Z
        brickGeos.push(scaledBoxGeo(wallThick, stepH, gableD, facadeX, sy, 0))
        // White trim on top edge of each step
        trimGeos.push(
          scaledBoxGeo(
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
      // Flat cornice: trim cap along facade face
      trimGeos.push(
        scaledBoxGeo(wallThick + 0.1, 0.15, d + 0.15, facadeX, h + 0.075, 0),
      )
      // Slight raised parapet at facade
      brickGeos.push(scaledBoxGeo(wallThick, 0.25, d, facadeX, h + 0.125, 0))
      gableTopY = h + 0.25
    }

    // Red pitched roof behind the facade (only on gabled houses)
    // Triangular prism: ridge runs along X, slopes down along Z to ±d/2
    // Ridge height matches gable top, eaves sit at building top (h)
    if (isSteppedGable) {
      const xFront = w / 2 - wallThick // flush behind facade wall
      const xBack = -w / 2
      const ridgeY = gableTopY
      const eaveY = h
      const halfD = d / 2

      const verts = new Float32Array([
        // back triangle
        xBack,
        eaveY,
        -halfD, // v0 back left eave
        xBack,
        eaveY,
        halfD, // v1 back right eave
        xBack,
        ridgeY,
        0, // v2 back ridge
        // front triangle
        xFront,
        eaveY,
        -halfD, // v3 front left eave
        xFront,
        eaveY,
        halfD, // v4 front right eave
        xFront,
        ridgeY,
        0, // v5 front ridge
      ])

      const indices = new Uint16Array([
        // left slope (v0, v2, v5, v3)
        0, 2, 5, 0, 5, 3,
        // right slope (v1, v4, v5, v2)
        1, 4, 5, 1, 5, 2,
        // back face
        0, 1, 2,
        // front face
        3, 5, 4,
        // bottom
        0, 3, 4, 0, 4, 1,
      ])

      const roofGeo = new THREE.BufferGeometry()
      roofGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
      roofGeo.setIndex(new THREE.BufferAttribute(indices, 1))
      roofGeo.computeVertexNormals()
      g.add(new THREE.Mesh(roofGeo, redRoofMat))
    }

    // Hoisting beam: only on stepped gable facades
    if (isSteppedGable) {
      const beamY = gableTopY - 0.15
      const beamLen = 0.5
      // Horizontal beam from facade surface outward
      brickGeos.push(
        scaledBoxGeo(beamLen, 0.07, 0.07, w / 2 + beamLen / 2, beamY, 0),
      )
      // Small hook hanging down at the tip
      brickGeos.push(
        scaledBoxGeo(0.05, 0.12, 0.05, w / 2 + beamLen - 0.025, beamY - 0.1, 0),
      )
    }

    // Windows: paired on the facade face (X-face), per floor
    const numFloors = Math.max(1, Math.floor((h - 1.0) / 1.4))
    const windowSpacing = d * 0.28
    for (let floor = 0; floor < numFloors; floor++) {
      const cy = 1.2 + floor * 1.4
      if (cy > h - 0.5) continue
      for (const zOff of [-windowSpacing, windowSpacing]) {
        const fx = w / 2 + 0.02
        frameGeos.push(scaledBoxGeo(0.04, 0.9, 0.7, fx, cy, zOff))
        glassGeos.push(scaledBoxGeo(0.05, 0.8, 0.6, fx + 0.01, cy, zOff))
        // Sill
        trimGeos.push(scaledBoxGeo(0.1, 0.06, 0.75, fx + 0.03, cy - 0.48, zOff))
        // Vertical divider (mullion)
        frameGeos.push(scaledBoxGeo(0.06, 0.85, 0.04, fx + 0.01, cy, zOff))
      }
    }

    // Door with white trim surround
    const doorH = 1.1
    const doorW = 0.55
    doorGeos.push(scaledBoxGeo(0.06, doorH, doorW, w / 2 + 0.03, doorH / 2, 0))
    trimGeos.push(
      scaledBoxGeo(
        0.05,
        doorH + 0.15,
        doorW + 0.15,
        w / 2 + 0.01,
        doorH / 2,
        0,
      ),
    )

    // Merge and create meshes
    const brickMerged = BufferGeometryUtils.mergeGeometries(brickGeos)
    g.add(new THREE.Mesh(brickMerged, mat))

    if (trimGeos.length > 0) {
      const trimMerged = BufferGeometryUtils.mergeGeometries(trimGeos)
      g.add(new THREE.Mesh(trimMerged, trimMat))
    }

    if (frameGeos.length > 0) {
      const frameMerged = BufferGeometryUtils.mergeGeometries(frameGeos)
      g.add(new THREE.Mesh(frameMerged, frameMat))
    }

    if (glassGeos.length > 0) {
      const glassMerged = BufferGeometryUtils.mergeGeometries(glassGeos)
      g.add(new THREE.Mesh(glassMerged, glassMat))
    }

    if (doorGeos.length > 0) {
      const doorMerged = BufferGeometryUtils.mergeGeometries(doorGeos)
      g.add(new THREE.Mesh(doorMerged, doorMat))
    }

    return g
  }

  function createTree(): THREE.Group {
    const g = new THREE.Group()
    const trunkH = rand(0.6, 1.2)
    const trunk = new THREE.Mesh(trunkGeo, trunkMat)
    trunk.scale.y = trunkH
    trunk.position.y = trunkH / 2
    g.add(trunk)

    const canopyR = rand(0.4, 0.8)
    const canopy = new THREE.Mesh(canopyGeo, leavesMat)
    canopy.scale.set(canopyR, canopyR * 1.4, canopyR)
    canopy.position.y = trunkH + canopyR * 0.5
    g.add(canopy)

    return g
  }

  function createPine(): THREE.Group {
    const g = new THREE.Group()
    const trunkH = rand(0.8, 1.5)
    const trunk = new THREE.Mesh(trunkGeo, trunkMat)
    trunk.scale.y = trunkH
    trunk.position.y = trunkH / 2
    g.add(trunk)

    // Stacked cones for layered pine look
    const layers = Math.floor(rand(2, 4))
    const baseR = rand(0.6, 1.2)
    const layerH = rand(1, 1.5)
    for (let i = 0; i < layers; i++) {
      const r = baseR * (1 - i * 0.2)
      const cone = new THREE.Mesh(pineGeo, pineMat)
      cone.scale.set(r, layerH, r)
      cone.position.y = trunkH + i * layerH * 0.6 + layerH / 2
      g.add(cone)
    }

    return g
  }

  function createRandomTree(): THREE.Group {
    return Math.random() < 0.4 ? createPine() : createTree()
  }

  function createWindmill(): { group: THREE.Group; sails: THREE.Group } {
    const g = new THREE.Group()
    const towerH = rand(3.5, 5)

    const tower = new THREE.Mesh(towerGeo, towerMat)
    tower.scale.y = towerH
    tower.position.y = towerH / 2
    g.add(tower)

    const cap = new THREE.Mesh(capGeo, towerMat)
    cap.scale.set(1, 0.6, 1)
    cap.position.y = towerH
    g.add(cap)

    const sails = new THREE.Group()
    sails.position.y = towerH * 0.9
    sails.position.z = 0.9
    const sailLen = rand(2, 3)
    for (let i = 0; i < 4; i++) {
      const sail = new THREE.Mesh(boxGeo, sailMat)
      sail.scale.set(0.15, sailLen, 0.05)
      sail.position.y = sailLen / 2
      const arm = new THREE.Group()
      arm.rotation.z = (i * Math.PI) / 2
      arm.add(sail)
      sails.add(arm)
    }
    g.add(sails)

    return { group: g, sails }
  }

  function createRoadMarking(): THREE.Mesh {
    const marking = new THREE.Mesh(boxGeo, markingMat)
    marking.scale.set(0.15, 0.02, 1.5)
    marking.position.set(0, 0.01, 0)
    return marking
  }

  function createBush(): THREE.Group {
    const g = new THREE.Group()
    const count = Math.floor(rand(2, 4))
    for (let i = 0; i < count; i++) {
      const s = rand(0.25, 0.5)
      const mesh = new THREE.Mesh(bushGeo, bushMat)
      mesh.scale.set(s * rand(0.8, 1.2), s * 0.7, s * rand(0.8, 1.2))
      mesh.position.set(rand(-0.2, 0.2), s * 0.3, rand(-0.2, 0.2))
      g.add(mesh)
    }
    return g
  }

  function createFlowerCluster(): THREE.Group {
    const g = new THREE.Group()
    const count = Math.floor(rand(3, 7))
    for (let i = 0; i < count; i++) {
      const h = rand(0.2, 0.45)
      const mat = flowerMats[Math.floor(Math.random() * flowerMats.length)]
      const stem = new THREE.Mesh(flowerStemGeo, bushMat)
      stem.scale.y = h
      stem.position.set(rand(-0.3, 0.3), h / 2, rand(-0.3, 0.3))
      g.add(stem)
      const head = new THREE.Mesh(flowerHeadGeo, mat)
      head.position.set(stem.position.x, h + 0.06, stem.position.z)
      g.add(head)
    }
    return g
  }

  // ── Static ground geometry ──────────────────────────────────────

  const staticMeshes: THREE.Mesh[] = []
  const groundLen = 400

  // Grass
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(60, groundLen), grassMat)
  grass.rotation.x = -Math.PI / 2
  grass.position.set(0, -0.01, 30)
  grass.receiveShadow = true
  group.add(grass)
  staticMeshes.push(grass)

  // Road (red asphalt)
  const road = new THREE.Mesh(new THREE.PlaneGeometry(3, groundLen), roadMat)
  road.rotation.x = -Math.PI / 2
  road.position.set(0, 0, 30)
  road.receiveShadow = true
  group.add(road)
  staticMeshes.push(road)

  // Sidewalks
  const sidewalkL = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, groundLen),
    sidewalkMat,
  )
  sidewalkL.rotation.x = -Math.PI / 2
  sidewalkL.position.set(-1.8, 0.001, 30)
  group.add(sidewalkL)
  staticMeshes.push(sidewalkL)

  const sidewalkR = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, groundLen),
    sidewalkMat,
  )
  sidewalkR.rotation.x = -Math.PI / 2
  sidewalkR.position.set(1.8, 0.001, 30)
  group.add(sidewalkR)
  staticMeshes.push(sidewalkR)

  // Back roads
  const backRoadR = new THREE.Mesh(
    new THREE.PlaneGeometry(2, groundLen),
    roadMat,
  )
  backRoadR.rotation.x = -Math.PI / 2
  backRoadR.position.set(9, 0, 30)
  group.add(backRoadR)
  staticMeshes.push(backRoadR)

  const backRoadL = new THREE.Mesh(
    new THREE.PlaneGeometry(2, groundLen),
    roadMat,
  )
  backRoadL.rotation.x = -Math.PI / 2
  backRoadL.position.set(-9, 0, 30)
  group.add(backRoadL)
  staticMeshes.push(backRoadL)

  // Back road sidewalks
  const backSidewalkR = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, groundLen),
    sidewalkMat,
  )
  backSidewalkR.rotation.x = -Math.PI / 2
  backSidewalkR.position.set(10.3, 0.001, 30)
  group.add(backSidewalkR)
  staticMeshes.push(backSidewalkR)

  const backSidewalkL = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, groundLen),
    sidewalkMat,
  )
  backSidewalkL.rotation.x = -Math.PI / 2
  backSidewalkL.position.set(-10.3, 0.001, 30)
  group.add(backSidewalkL)
  staticMeshes.push(backSidewalkL)

  scene.add(group)

  // ── Parallax mountains ────────────────────────────────────────

  interface MountainLayer {
    meshL: THREE.Mesh
    meshR: THREE.Mesh
    speed: number
  }

  function createMountainProfile(segLen: number, peaks: number, minH: number, maxH: number): THREE.Shape {
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

  const mountainLayers: MountainLayer[] = []
  const mtSegLen = groundLen * 2

  // Mountains sit in world space (not the rotated group), extending along X with height in Y
  const layerConfigs = [
    { z: 35, minH: 3, maxH: 8, color: 0x6878a0, speed: 0.04, peaks: 12 },
    { z: 26, minH: 2, maxH: 5.5, color: 0x4a6050, speed: 0.08, peaks: 16 },
    { z: 20, minH: 1, maxH: 3.5, color: 0x3a5040, speed: 0.14, peaks: 20 },
  ]

  for (const cfg of layerConfigs) {
    const mat = new THREE.MeshStandardMaterial({ color: cfg.color, flatShading: true, roughness: 0.95, side: THREE.DoubleSide, fog: false })
    sharedMats.push(mat)

    const meshL = new THREE.Mesh(new THREE.ShapeGeometry(createMountainProfile(mtSegLen, cfg.peaks, cfg.minH, cfg.maxH)), mat)
    const meshR = new THREE.Mesh(new THREE.ShapeGeometry(createMountainProfile(mtSegLen, cfg.peaks, cfg.minH, cfg.maxH)), mat)
    meshL.position.set(-mtSegLen / 2, GROUND_Y - 0.5, -cfg.z)
    meshR.position.set(-mtSegLen / 2, GROUND_Y - 0.5, cfg.z)
    scene.add(meshL, meshR)

    mountainLayers.push({ meshL, meshR, speed: cfg.speed })
  }

  // ── Lighting ────────────────────────────────────────────────────

  let originalAmbientIntensity = 0.5
  let originalDirColor = new THREE.Color(0xffffff)
  let originalDirIntensity = 1.0
  let originalDirCastShadow = false

  scene.traverse((child) => {
    if (child instanceof THREE.AmbientLight) {
      originalAmbientIntensity = child.intensity
      child.intensity = 0.4
    }
    if (child instanceof THREE.DirectionalLight) {
      originalDirColor = child.color.clone()
      originalDirIntensity = child.intensity
      originalDirCastShadow = child.castShadow
      child.color.set(0xffddaa)
      child.intensity = 0.8
      child.castShadow = true
      child.shadow.mapSize.set(256, 256)
      child.shadow.camera.left = -20
      child.shadow.camera.right = 20
      child.shadow.camera.top = 20
      child.shadow.camera.bottom = -20
      child.shadow.camera.near = 0.5
      child.shadow.camera.far = 40
    }
  })

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8)
  scene.add(hemiLight)

  // ── Spawned objects tracking ────────────────────────────────────

  const spawned: SpawnedObject[] = []

  function disposeObject(obj: SpawnedObject) {
    group.remove(obj.group)
  }

  function spawnRow(z: number, zone: Zone) {
    if (zone === 'city' || zone === 'transition') {
      // Right-side houses
      if (zone === 'city' || Math.random() < 0.5) {
        const house = createHouse()
        house.rotation.y = Math.PI
        house.position.set(rand(4.0, 4.5), 0, z)
        group.add(house)
        spawned.push({ group: house, type: 'house' })
      }

      // Left-side houses
      if (zone === 'city' || Math.random() < 0.5) {
        const house = createHouse()
        house.position.set(rand(-4.5, -4.0), 0, z)
        group.add(house)
        spawned.push({ group: house, type: 'house' })
      }

      // Outer houses facing back roads
      if (zone === 'city' || Math.random() < 0.3) {
        const house = createHouse()
        house.rotation.y = Math.PI
        house.position.set(rand(11.0, 11.5), 0, z + rand(1.5, 3.5))
        group.add(house)
        spawned.push({ group: house, type: 'house' })
      }
      if (zone === 'city' || Math.random() < 0.3) {
        const house = createHouse()
        house.rotation.y = 0
        house.position.set(rand(-11.5, -11.0), 0, z + rand(1.5, 3.5))
        group.add(house)
        spawned.push({ group: house, type: 'house' })
      }

      // Street trees between houses
      if (Math.random() < 0.4) {
        const tree = createTree()
        tree.position.set(rand(2.0, 6.0), 0, z + SPAWN_INTERVAL * 0.5)
        group.add(tree)
        spawned.push({ group: tree, type: 'tree' })
      }
      if (Math.random() < 0.4) {
        const tree = createTree()
        tree.position.set(-rand(2.0, 6.0), 0, z + SPAWN_INTERVAL * 0.5)
        group.add(tree)
        spawned.push({ group: tree, type: 'tree' })
      }

      // Urban bushes near sidewalks
      if (Math.random() < 0.15) {
        const bush = createBush()
        bush.position.set(rand(2.0, 3.0) * (Math.random() < 0.5 ? 1 : -1), 0, z + rand(0, SPAWN_INTERVAL))
        group.add(bush)
        spawned.push({ group: bush, type: 'bush' })
      }
    }

    // Road markings
    const marking = createRoadMarking()
    marking.position.set(0, 0, z)
    group.add(marking)
    spawned.push({ group: marking, type: 'marking' })

    if (zone === 'nature' || zone === 'transition') {
      // Trees on both sides
      if (zone === 'nature' || Math.random() < 0.5) {
        const tree = createRandomTree()
        tree.position.set(rand(2.5, 8.0), 0, z)
        group.add(tree)
        spawned.push({ group: tree, type: 'tree' })
      }

      if (zone === 'nature' || Math.random() < 0.5) {
        const tree = createRandomTree()
        tree.position.set(-rand(2.5, 8.0), 0, z)
        group.add(tree)
        spawned.push({ group: tree, type: 'tree' })
      }

      // Bushes
      if (Math.random() < 0.4) {
        const bush = createBush()
        bush.position.set(rand(2.0, 12.0) * (Math.random() < 0.5 ? 1 : -1), 0, z + rand(0, SPAWN_INTERVAL))
        group.add(bush)
        spawned.push({ group: bush, type: 'bush' })
      }

      // Flowers (nature only)
      if (zone === 'nature' && Math.random() < 0.25) {
        const flowers = createFlowerCluster()
        flowers.position.set(rand(2.0, 6.0) * (Math.random() < 0.5 ? 1 : -1), 0, z + rand(0, SPAWN_INTERVAL))
        group.add(flowers)
        spawned.push({ group: flowers, type: 'flower' })
      }

      // Rare windmills
      if (zone === 'nature' && Math.random() < 0.03) {
        const side = Math.random() < 0.5 ? 1 : -1
        const wm = createWindmill()
        wm.group.position.set(side * rand(6.0, 10.0), 0, z)
        group.add(wm.group)
        spawned.push({ group: wm.group, type: 'windmill', sails: wm.sails })
      }
    }
  }

  // ── Initial population ──────────────────────────────────────────

  let distanceTraveled = 0
  let spawnAccumulator = 0

  for (let z = CULL_Z; z <= SPAWN_Z; z += SPAWN_INTERVAL) {
    spawnRow(z, getZone(z))
  }

  // ── Update loop ─────────────────────────────────────────────────

  let elapsed = 0

  function update(delta: number): CameraOffset {
    if (delta > 1) return { x: 0, y: 0 }
    elapsed += delta
    const dz = ROAD_SPEED * delta
    const dist = Math.abs(dz)
    distanceTraveled += dist
    spawnAccumulator += dist

    // Spawn new rows
    while (spawnAccumulator >= SPAWN_INTERVAL) {
      spawnAccumulator -= SPAWN_INTERVAL
      const zone = getZone(distanceTraveled)
      spawnRow(SPAWN_Z, zone)
    }

    // Move all spawned objects
    for (const obj of spawned) obj.group.position.z += dz

    // Cull objects past CULL_Z — swap-and-pop instead of splice
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

    // Rotate windmill sails
    for (const obj of spawned) {
      if (obj.sails) obj.sails.rotation.z += delta * 1.0
    }

    // Parallax mountain scrolling
    for (const { meshL, meshR, speed } of mountainLayers) {
      const mdx = ROAD_SPEED * speed * delta
      meshL.position.x += mdx
      meshR.position.x += mdx
      if (meshL.position.x < -mtSegLen) {
        meshL.position.x += mtSegLen / 2
        meshR.position.x += mtSegLen / 2
      }
    }

    // Camera vibration (road rumble)
    const vibrationX =
      Math.sin(elapsed * 47) * 0.0008 + Math.sin(elapsed * 31) * 0.0005
    const vibrationY =
      Math.sin(elapsed * 53) * 0.001 + Math.sin(elapsed * 37) * 0.0006

    // Pedaling bob (~1.5 Hz cadence)
    const bobY = Math.sin(elapsed * Math.PI * 3) * 0.008

    return { x: vibrationX, y: vibrationY + bobY }
  }

  // ── Dispose ─────────────────────────────────────────────────────

  function dispose() {
    for (const obj of spawned) disposeObject(obj)
    spawned.length = 0

    for (const mesh of staticMeshes) {
      group.remove(mesh)
      mesh.geometry.dispose()
    }

    scene.remove(hemiLight)
    hemiLight.dispose()

    scene.traverse((child) => {
      if (child instanceof THREE.AmbientLight)
        child.intensity = originalAmbientIntensity
      if (child instanceof THREE.DirectionalLight) {
        child.color.copy(originalDirColor)
        child.intensity = originalDirIntensity
        child.castShadow = originalDirCastShadow
      }
    })

    for (const { meshL, meshR } of mountainLayers) {
      scene.remove(meshL, meshR)
      meshL.geometry.dispose()
      meshR.geometry.dispose()
    }

    // Dispose shared resources
    for (const geo of sharedGeos) geo.dispose()
    for (const mat of sharedMats) mat.dispose()

    scene.remove(group)
  }

  return { update, dispose }
}
