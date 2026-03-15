import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'

// ── Constants ────────────────────────────────────────────────────────

const SPAWN_Z = 100
const CULL_Z = -60
const GROUND_Y = -0.9
const ROAD_ROTATION_Y = 1.25
const ROAD_SPEED = -8.0
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
  type: 'house' | 'tree' | 'windmill' | 'marking' | 'bush' | 'flowers' | 'rock'
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
  const rockGeo = new THREE.DodecahedronGeometry(1, 0)
  const bushGeo = new THREE.SphereGeometry(1, 5, 4)

  const brickColors = [
    0x4a2c2a, 0x3e2723, 0x5d4037, 0x2a2a2a, 0x1a1a1a, 0x8b4513,
  ]
  const brickMats = brickColors.map(
    (c) => new THREE.MeshLambertMaterial({ color: c }),
  )
  const glassMat = new THREE.MeshLambertMaterial({
    color: 0x4488aa,
    emissive: 0x112233,
    emissiveIntensity: 0.3,
  })
  const frameMat = new THREE.MeshLambertMaterial({ color: 0xffffff })
  const doorMat = new THREE.MeshLambertMaterial({ color: 0x2a1a0a })
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x222222 })
  const redRoofMat = new THREE.MeshLambertMaterial({ color: 0x8b2500 })
  const trimMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee })
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3728 })
  const leavesMat = new THREE.MeshLambertMaterial({ color: 0x2e8b57 })
  const pineMat = new THREE.MeshLambertMaterial({ color: 0x1a5c2a })
  const towerMat = new THREE.MeshLambertMaterial({ color: 0x555555 })
  const sailMat = new THREE.MeshLambertMaterial({ color: 0xcccccc })
  const markingMat = new THREE.MeshLambertMaterial({ color: 0xffffff })
  const grassMat = new THREE.MeshLambertMaterial({ color: 0x6b8e23 })
  const roadMat = new THREE.MeshLambertMaterial({ color: 0xa55145 })
  const backRoadMat = new THREE.MeshLambertMaterial({ color: 0x7a7a6e })
  const sidewalkMat = new THREE.MeshLambertMaterial({ color: 0x888888 })

  // Nature assets materials
  const rockMats = [
    new THREE.MeshLambertMaterial({ color: 0x777777 }),
    new THREE.MeshLambertMaterial({ color: 0x666666 }),
    new THREE.MeshLambertMaterial({ color: 0x888880 }),
  ]
  const bushMats = [
    new THREE.MeshLambertMaterial({ color: 0x2d6b30 }),
    new THREE.MeshLambertMaterial({ color: 0x3a7d3e }),
    new THREE.MeshLambertMaterial({ color: 0x1f5c22 }),
  ]
  const flowerMats = [
    new THREE.MeshLambertMaterial({ color: 0xffd700 }), // yellow
    new THREE.MeshLambertMaterial({ color: 0x9b59b6 }), // purple
    new THREE.MeshLambertMaterial({ color: 0xffffff }), // white
    new THREE.MeshLambertMaterial({ color: 0xff69b4 }), // pink
    new THREE.MeshLambertMaterial({ color: 0xe74c3c }), // red
  ]

  const sharedGeos = [
    boxGeo,
    planeGeo,
    trunkGeo,
    canopyGeo,
    pineGeo,
    towerGeo,
    capGeo,
    rockGeo,
    bushGeo,
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
    grassMat,
    roadMat,
    backRoadMat,
    sidewalkMat,
    ...rockMats,
    ...bushMats,
    ...flowerMats,
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

  const windmillBodyMat = new THREE.MeshLambertMaterial({ color: 0x8b4513 })
  const windmillCapMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a })
  const windmillGalleryMat = new THREE.MeshLambertMaterial({ color: 0x5c3a1a })
  const windmillSailFrameMat = new THREE.MeshLambertMaterial({ color: 0x3a2a1a })
  const windmillSailClothMat = new THREE.MeshLambertMaterial({ color: 0xe8dcc8, side: THREE.DoubleSide })
  const windmillDoorMat = new THREE.MeshLambertMaterial({ color: 0x1a1208 })
  const windmillWindowMat = new THREE.MeshLambertMaterial({ color: 0x4488aa, emissive: 0x112233, emissiveIntensity: 0.3 })

  sharedMats.push(windmillBodyMat, windmillCapMat, windmillGalleryMat, windmillSailFrameMat, windmillSailClothMat, windmillDoorMat, windmillWindowMat)

  function createWindmill(): { group: THREE.Group; sails: THREE.Group } {
    const g = new THREE.Group()
    const towerH = rand(4, 6)
    const baseR = rand(1.0, 1.3)
    const topR = baseR * 0.55
    const capH = towerH * 0.3
    const hubY = towerH + capH * 0.15
    const galleryR = topR + 0.4

    // ── Merge all static body parts into one mesh ──
    // Tower body (cylinder → positioned)
    const towerGeo2 = new THREE.CylinderGeometry(topR, baseR, towerH, 8)
    towerGeo2.translate(0, towerH / 2, 0)

    // Gallery platform
    const galleryGeo = new THREE.CylinderGeometry(galleryR, galleryR, 0.08, 8)
    galleryGeo.translate(0, towerH * 0.78, 0)

    // Gallery railing posts (boxes)
    const postGeos: THREE.BufferGeometry[] = []
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2
      postGeos.push(scaledBoxGeo(
        0.04, 0.25, 0.04,
        Math.cos(angle) * (galleryR - 0.03),
        towerH * 0.78 + 0.17,
        Math.sin(angle) * (galleryR - 0.03),
      ))
    }

    // Gallery top rail (box ring approximation instead of TorusGeometry)
    const railGeos: THREE.BufferGeometry[] = []
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2
      const a1 = ((i + 1) / 8) * Math.PI * 2
      const rr = galleryR - 0.03
      const mx = (Math.cos(a0) + Math.cos(a1)) * 0.5 * rr
      const mz = (Math.sin(a0) + Math.sin(a1)) * 0.5 * rr
      const dx = Math.cos(a1) * rr - Math.cos(a0) * rr
      const dz = Math.sin(a1) * rr - Math.sin(a0) * rr
      const segLen = Math.sqrt(dx * dx + dz * dz)
      const bg = boxGeo.clone()
      bg.scale(segLen, 0.04, 0.04)
      bg.rotateY(-Math.atan2(dz, dx))
      bg.translate(mx, towerH * 0.78 + 0.3, mz)
      railGeos.push(bg)
    }

    // Cap (cone)
    const capGeo2 = new THREE.ConeGeometry(topR + 0.1, capH, 8)
    capGeo2.translate(0, towerH + capH / 2 - 0.1, 0)

    // Door (box)
    const doorGeo = boxGeo.clone()
    doorGeo.scale(0.5, 1.0, 0.1)
    doorGeo.translate(0, 0.5, baseR + 0.02)

    // Door arch (box approximation instead of CylinderGeometry)
    const archGeo2 = boxGeo.clone()
    archGeo2.scale(0.5, 0.1, 0.1)
    archGeo2.translate(0, 1.0, baseR + 0.03)

    // Hub
    const hubGeo = capGeo.clone()
    hubGeo.scale(0.15, 0.15, 0.15)
    hubGeo.translate(0, hubY, topR + 0.3)

    // Windows
    const winGeos: THREE.BufferGeometry[] = []
    const windowFloors = Math.floor(towerH / 1.5)
    for (let f = 1; f < windowFloors; f++) {
      const wy = f * 1.5
      const wr = baseR - (baseR - topR) * (wy / towerH)
      for (const angle of [Math.PI * 0.5, Math.PI * 1.5]) {
        const wg = boxGeo.clone()
        wg.scale(0.25, 0.35, 0.06)
        wg.rotateY(-angle + Math.PI / 2)
        wg.translate(
          Math.cos(angle) * (wr + 0.02),
          wy,
          Math.sin(angle) * (wr + 0.02),
        )
        winGeos.push(wg)
      }
    }

    // Merge body: tower + gallery + posts + rail + cap + door + arch + hub + windows
    const bodyMerged = BufferGeometryUtils.mergeGeometries([
      towerGeo2, galleryGeo, ...postGeos, ...railGeos,
      capGeo2, doorGeo, archGeo2, hubGeo, ...winGeos,
    ])
    g.add(new THREE.Mesh(bodyMerged, windmillBodyMat))

    // ── Sails (separate group for rotation) ──
    const sails = new THREE.Group()
    sails.position.set(0, hubY, topR + 0.35)
    const sailLen = rand(2.5, 3.5)

    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group()
      arm.rotation.z = (i * Math.PI) / 2

      // Merge spar + battens into one mesh
      const frameGeos: THREE.BufferGeometry[] = []
      frameGeos.push(scaledBoxGeo(0.06, sailLen, 0.04, 0, sailLen / 2, 0))
      const battenCount = Math.floor(sailLen / 0.4)
      for (let b = 1; b < battenCount; b++)
        frameGeos.push(scaledBoxGeo(0.02, 0.02, 0.5, 0, b * 0.4 + 0.2, 0.15))

      arm.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(frameGeos), windmillSailFrameMat))

      // Sail cloth
      const clothGeo = new THREE.PlaneGeometry(0.45, sailLen * 0.85)
      const cloth = new THREE.Mesh(clothGeo, windmillSailClothMat)
      cloth.position.set(0, sailLen * 0.48, 0.15)
      arm.add(cloth)

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
    const mat = bushMats[Math.floor(Math.random() * bushMats.length)]
    const geos: THREE.BufferGeometry[] = []
    const count = Math.floor(rand(3, 6))
    for (let i = 0; i < count; i++) {
      const r = rand(0.2, 0.45)
      const cl = bushGeo.clone()
      cl.scale(r * rand(0.8, 1.3), r * rand(0.6, 1.0), r * rand(0.8, 1.3))
      cl.translate(rand(-0.3, 0.3), r * 0.4, rand(-0.3, 0.3))
      geos.push(cl)
    }
    g.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(geos), mat))
    return g
  }

  const flowerGeo = new THREE.SphereGeometry(0.06, 4, 3)
  const stemGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.15, 3)
  const stemMat = new THREE.MeshLambertMaterial({ color: 0x2e7d32 })
  sharedGeos.push(flowerGeo, stemGeo)
  sharedMats.push(stemMat)

  function createFlowerPatch(): THREE.Group {
    const g = new THREE.Group()
    const count = Math.floor(rand(8, 20))
    const mat = flowerMats[Math.floor(Math.random() * flowerMats.length)]
    const stemGeos: THREE.BufferGeometry[] = []
    const flowerGeos: THREE.BufferGeometry[] = []

    for (let i = 0; i < count; i++) {
      const h = rand(0.1, 0.25)
      const x = rand(-0.8, 0.8)
      const z = rand(-0.8, 0.8)

      const sg = stemGeo.clone()
      sg.scale(1, h / 0.15, 1)
      sg.translate(x, h / 2, z)
      stemGeos.push(sg)

      const s = rand(0.7, 1.3)
      const fg = flowerGeo.clone()
      fg.scale(s, s, s)
      fg.translate(x, h + 0.03, z)
      flowerGeos.push(fg)
    }

    g.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(stemGeos), stemMat))
    g.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(flowerGeos), mat))
    return g
  }

  function createRock(): THREE.Group {
    const g = new THREE.Group()
    const mat = rockMats[Math.floor(Math.random() * rockMats.length)]
    const mainSize = rand(0.15, 0.4)
    const main = new THREE.Mesh(rockGeo, mat)
    main.scale.set(mainSize * rand(0.8, 1.4), mainSize * rand(0.5, 0.9), mainSize * rand(0.8, 1.4))
    main.rotation.set(rand(0, Math.PI), rand(0, Math.PI), 0)
    main.position.y = mainSize * 0.3
    g.add(main)

    // Occasional smaller companion rocks
    if (Math.random() < 0.5) {
      const smallSize = mainSize * rand(0.3, 0.6)
      const small = new THREE.Mesh(rockGeo, mat)
      small.scale.set(smallSize * rand(0.8, 1.3), smallSize * rand(0.5, 0.8), smallSize * rand(0.8, 1.3))
      small.rotation.set(rand(0, Math.PI), rand(0, Math.PI), 0)
      small.position.set(rand(-0.3, 0.3), smallSize * 0.25, rand(-0.3, 0.3))
      g.add(small)
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
    backRoadMat,
  )
  backRoadR.rotation.x = -Math.PI / 2
  backRoadR.position.set(9, 0, 30)
  group.add(backRoadR)
  staticMeshes.push(backRoadR)

  const backRoadL = new THREE.Mesh(
    new THREE.PlaneGeometry(2, groundLen),
    backRoadMat,
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
    speed: number // fraction of ROAD_SPEED
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

  const layerConfigs = [
    { x: 35, minH: 3, maxH: 8, color: 0x6878a0, speed: 0.04, peaks: 12 },
    { x: 26, minH: 2, maxH: 5.5, color: 0x4a6050, speed: 0.08, peaks: 16 },
    { x: 20, minH: 1, maxH: 3.5, color: 0x3a5040, speed: 0.14, peaks: 20 },
  ]

  for (const cfg of layerConfigs) {
    const shapeL = createMountainProfile(mtSegLen, cfg.peaks, cfg.minH, cfg.maxH)
    const shapeR = createMountainProfile(mtSegLen, cfg.peaks, cfg.minH, cfg.maxH)
    const mat = new THREE.MeshLambertMaterial({ color: cfg.color, side: THREE.DoubleSide })
    sharedMats.push(mat)

    const geoL = new THREE.ShapeGeometry(shapeL)
    const geoR = new THREE.ShapeGeometry(shapeR)

    const meshL = new THREE.Mesh(geoL, mat)
    meshL.rotation.y = Math.PI / 2
    meshL.position.set(-cfg.x, -0.5, mtSegLen / 2 - 60)
    group.add(meshL)

    const meshR = new THREE.Mesh(geoR, mat)
    meshR.rotation.y = -Math.PI / 2
    meshR.position.set(cfg.x, -0.5, -(mtSegLen / 2) - 60)
    group.add(meshR)

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
      child.intensity = 0.3
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

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6)
  scene.add(hemiLight)

  // ── Spawned objects tracking ────────────────────────────────────

  const spawned: SpawnedObject[] = []
  const windmillSails: THREE.Group[] = []

  function disposeObject(obj: SpawnedObject) {
    if (obj.sails) {
      const idx = windmillSails.indexOf(obj.sails)
      if (idx >= 0) {
        windmillSails[idx] = windmillSails[windmillSails.length - 1]
        windmillSails.pop()
      }
    }
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

      // Bushes along the road
      if (Math.random() < 0.5) {
        const bush = createBush()
        bush.position.set(rand(2.0, 4.0) * (Math.random() < 0.5 ? 1 : -1), 0, z + rand(-2, 2))
        group.add(bush)
        spawned.push({ group: bush, type: 'bush' })
      }

      // Flower patches scattered on grass
      if (zone === 'nature' && Math.random() < 0.4) {
        const flowers = createFlowerPatch()
        const fx = Math.random() < 0.5 ? rand(3.0, 7.5) : rand(11.0, 14.0)
        flowers.position.set(fx * (Math.random() < 0.5 ? 1 : -1), 0.01, z + rand(-2, 2))
        group.add(flowers)
        spawned.push({ group: flowers, type: 'flowers' })
      }

      // Rocks and boulders
      if (Math.random() < 0.25) {
        const rock = createRock()
        rock.position.set(rand(2.5, 14.0) * (Math.random() < 0.5 ? 1 : -1), 0, z + rand(-1, 1))
        group.add(rock)
        spawned.push({ group: rock, type: 'rock' })
      }

      // Rare windmills
      if (zone === 'nature' && Math.random() < 0.03) {
        const side = Math.random() < 0.5 ? 1 : -1
        const wm = createWindmill()
        wm.group.position.set(side * rand(6.0, 10.0), 0, z)
        group.add(wm.group)
        windmillSails.push(wm.sails)
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
    elapsed += delta
    const clampedDelta = Math.min(delta, 0.5)
    const dz = ROAD_SPEED * clampedDelta
    const dist = Math.abs(dz)
    distanceTraveled += dist
    spawnAccumulator += dist

    // Spawn new rows — increment distance per row so each gets the correct zone
    let rowOffset = 0
    while (spawnAccumulator >= SPAWN_INTERVAL) {
      spawnAccumulator -= SPAWN_INTERVAL
      distanceTraveled += SPAWN_INTERVAL
      const zone = getZone(distanceTraveled)
      spawnRow(SPAWN_Z + rowOffset, zone)
      rowOffset -= SPAWN_INTERVAL
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
    for (const s of windmillSails) s.rotation.z += delta * 1.0

    // Parallax mountain scrolling — wrap when they drift too far
    for (const layer of mountainLayers) {
      const mdz = ROAD_SPEED * layer.speed * clampedDelta
      layer.meshL.position.z += mdz
      layer.meshR.position.z += mdz
      if (layer.meshL.position.z < -mtSegLen / 2) {
        layer.meshL.position.z += mtSegLen / 2
        layer.meshR.position.z += mtSegLen / 2
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

    for (const layer of mountainLayers) {
      group.remove(layer.meshL)
      group.remove(layer.meshR)
      layer.meshL.geometry.dispose()
      layer.meshR.geometry.dispose()
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

    // Dispose shared resources
    for (const geo of sharedGeos) geo.dispose()
    for (const mat of sharedMats) mat.dispose()

    scene.remove(group)
  }

  return { update, dispose }
}
