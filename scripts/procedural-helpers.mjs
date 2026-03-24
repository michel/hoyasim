// Procedural geometry helpers extracted from the old blocks.ts
// Used only by the export script to generate GLB files.
import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'

function rand(min, max) {
  return min + Math.random() * (max - min)
}

function flatMat(color, roughness = 0.9, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness,
    ...extra,
  })
}

function scaledBoxGeo(boxGeo, sx, sy, sz, px, py, pz) {
  const g = boxGeo.clone()
  g.scale(sx, sy, sz)
  g.translate(px, py, pz)
  return g
}

export function createBlockResources() {
  const boxGeo = new THREE.BoxGeometry(1, 1, 1)
  const trunkGeo = new THREE.CylinderGeometry(0.1, 0.15, 1, 5)
  const canopyGeo = new THREE.SphereGeometry(1, 4, 3)

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
  const redRoofMat = flatMat(0x8b2500, 0.85)
  const trimMat = flatMat(0xeeeeee, 0.7)
  const trunkMat = flatMat(0x4a3728)
  const leavesMat = flatMat(0x2e8b57, 0.95)

  return {
    boxGeo,
    trunkGeo,
    canopyGeo,
    brickMats,
    glassMat,
    frameMat,
    doorMat,
    redRoofMat,
    trimMat,
    trunkMat,
    leavesMat,
  }
}

export function createHouse(res) {
  const g = new THREE.Group()
  const mat = res.brickMats[Math.floor(Math.random() * res.brickMats.length)]

  const d = rand(3.5, 4.5)
  const w = rand(2, 3.5)
  const h = rand(2.5, 4.5)

  const brickGeos = []
  const trimGeos = []
  const frameGeos = []
  const glassGeos = []
  const doorGeos = []

  brickGeos.push(scaledBoxGeo(res.boxGeo, w, h, d, 0, h / 2, 0))
  trimGeos.push(
    scaledBoxGeo(res.boxGeo, w + 0.1, 0.08, d + 0.1, 0, h * 0.45, 0),
  )

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

  g.add(new THREE.Mesh(BufferGeometryUtils.mergeGeometries(brickGeos), mat))
  if (trimGeos.length)
    g.add(
      new THREE.Mesh(
        BufferGeometryUtils.mergeGeometries(trimGeos),
        res.trimMat,
      ),
    )
  if (glassGeos.length)
    g.add(
      new THREE.Mesh(
        BufferGeometryUtils.mergeGeometries(glassGeos),
        res.glassMat,
      ),
    )
  if (doorGeos.length)
    g.add(
      new THREE.Mesh(
        BufferGeometryUtils.mergeGeometries(doorGeos),
        res.doorMat,
      ),
    )

  return g
}

export function createTree(res) {
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
