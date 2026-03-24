// ── FileReader polyfill for GLTFExporter binary output ──────────────
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader extends EventTarget {
    result = null
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf
        const evt = { target: this }
        this.dispatchEvent(new Event('load'))
        this.dispatchEvent(new Event('loadend'))
        if (typeof this.onload === 'function') this.onload(evt)
        if (typeof this.onloadend === 'function') this.onloadend(evt)
      })
    }
  }
}

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import {
  createBlockResources,
  createHouse,
  createTree,
} from './procedural-helpers.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outDir = join(root, 'public', 'assets', 'blocks', 'landscape')

// ── Seeded PRNG (mulberry32) ────────────────────────────────────────

function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seededRand(rng, min, max) {
  return min + rng() * (max - min)
}

// ── Block dimensions ────────────────────────────────────────────────

const BLOCK_DEPTH = 30 // z-length of each block
const SIDEWALK_EDGE = 7.35 // where the sidewalk ends (road is procedural)
const BLOCK_WIDTH = 98 // how far out blocks extend
const _GROUND_Y = 0 // blocks are placed at group y=-3.15, so y=0 is ground

// ── Landscape block definitions ─────────────────────────────────────

const blocks = [
  // City zone — 3 pairs
  { name: 'city_left1', zone: 'city', side: 'left', seed: 1001 },
  { name: 'city_right1', zone: 'city', side: 'right', seed: 2001 },
  { name: 'city_left2', zone: 'city', side: 'left', seed: 1002 },
  { name: 'city_right2', zone: 'city', side: 'right', seed: 2002 },
  { name: 'city_left3', zone: 'city', side: 'left', seed: 1003 },
  { name: 'city_right3', zone: 'city', side: 'right', seed: 2003 },
  // City→Nature transition — 1 pair
  { name: 'city_nature_left1', zone: 'city_nature', side: 'left', seed: 3001 },
  {
    name: 'city_nature_right1',
    zone: 'city_nature',
    side: 'right',
    seed: 4001,
  },
  // Nature zone — 3 pairs
  { name: 'nature_left1', zone: 'nature', side: 'left', seed: 5001 },
  { name: 'nature_right1', zone: 'nature', side: 'right', seed: 6001 },
  { name: 'nature_left2', zone: 'nature', side: 'left', seed: 5002 },
  { name: 'nature_right2', zone: 'nature', side: 'right', seed: 6002 },
  { name: 'nature_left3', zone: 'nature', side: 'left', seed: 5003 },
  { name: 'nature_right3', zone: 'nature', side: 'right', seed: 6003 },
  // Nature→City transition — 1 pair
  { name: 'nature_city_left1', zone: 'nature_city', side: 'left', seed: 7001 },
  {
    name: 'nature_city_right1',
    zone: 'nature_city',
    side: 'right',
    seed: 8001,
  },
]

// ── Block composition ───────────────────────────────────────────────

function createGrassStrip(xStart, width, depth) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x6b8e23,
    flatShading: true,
    roughness: 0.95,
  })
  const geo = new THREE.PlaneGeometry(width, depth)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(xStart + width / 2, -0.035, depth / 2)
  return mesh
}

function composeCityBlock(res, rng, side) {
  const group = new THREE.Group()
  const sign = side === 'left' ? -1 : 1
  const _xStart = SIDEWALK_EDGE * sign

  // Grass ground
  group.add(
    createGrassStrip(
      side === 'left' ? -(SIDEWALK_EDGE + BLOCK_WIDTH) : SIDEWALK_EDGE,
      BLOCK_WIDTH,
      BLOCK_DEPTH,
    ),
  )

  // Houses — near row
  for (let i = 0; i < 2; i++) {
    const origRandom = Math.random
    Math.random = rng
    const house = createHouse(res)
    Math.random = origRandom
    const x = sign * seededRand(rng, 14.0, 15.75)
    house.position.set(x, 0, seededRand(rng, 2, BLOCK_DEPTH - 2))
    house.rotation.y = side === 'left' ? 0 : Math.PI
    group.add(house)
  }

  // Houses — far row
  const origRandom = Math.random
  Math.random = rng
  const farHouse = createHouse(res)
  Math.random = origRandom
  farHouse.position.set(
    sign * seededRand(rng, 38.5, 40.25),
    0,
    seededRand(rng, 5, BLOCK_DEPTH - 5),
  )
  farHouse.rotation.y = side === 'left' ? 0 : Math.PI
  group.add(farHouse)

  // Trees
  for (let i = 0; i < 2; i++) {
    const orig = Math.random
    Math.random = rng
    const tree = createTree(res)
    Math.random = orig
    tree.position.set(
      sign * seededRand(rng, 10.0, 21.0),
      0,
      seededRand(rng, 0, BLOCK_DEPTH),
    )
    group.add(tree)
  }

  return group
}

function composeNatureBlock(res, rng, side) {
  const group = new THREE.Group()
  const sign = side === 'left' ? -1 : 1

  // Grass ground
  group.add(
    createGrassStrip(
      side === 'left' ? -(SIDEWALK_EDGE + BLOCK_WIDTH) : SIDEWALK_EDGE,
      BLOCK_WIDTH,
      BLOCK_DEPTH,
    ),
  )

  // Dense near trees
  const nearTreeCount = Math.floor(seededRand(rng, 2, 4))
  for (let i = 0; i < nearTreeCount; i++) {
    const orig = Math.random
    Math.random = rng
    const tree = createTree(res)
    Math.random = orig
    tree.position.set(
      sign * seededRand(rng, 12.0, 28.0),
      0,
      seededRand(rng, 0, BLOCK_DEPTH),
    )
    group.add(tree)
  }

  // Far trees
  const farTreeCount = Math.floor(seededRand(rng, 3, 5))
  for (let i = 0; i < farTreeCount; i++) {
    const orig = Math.random
    Math.random = rng
    const tree = createTree(res)
    Math.random = orig
    tree.position.set(
      sign * seededRand(rng, 38.5, 77.0),
      0,
      seededRand(rng, 0, BLOCK_DEPTH),
    )
    group.add(tree)
  }

  return group
}

function composeTransitionBlock(res, rng, side, from) {
  const group = new THREE.Group()
  const sign = side === 'left' ? -1 : 1

  // Grass ground
  group.add(
    createGrassStrip(
      side === 'left' ? -(SIDEWALK_EDGE + BLOCK_WIDTH) : SIDEWALK_EDGE,
      BLOCK_WIDTH,
      BLOCK_DEPTH,
    ),
  )

  // Mix: one house (if city→nature) or one tree cluster (if nature→city) + scattered trees/bushes
  if (from === 'city') {
    // Fading out city: one house + more trees
    const orig = Math.random
    Math.random = rng
    const house = createHouse(res)
    Math.random = orig
    house.position.set(
      sign * seededRand(rng, 14.0, 15.75),
      0,
      seededRand(rng, 2, BLOCK_DEPTH / 2),
    )
    house.rotation.y = side === 'left' ? 0 : Math.PI
    group.add(house)

    // Trees taking over
    for (let i = 0; i < 3; i++) {
      const o = Math.random
      Math.random = rng
      const tree = createTree(res)
      Math.random = o
      tree.position.set(
        sign * seededRand(rng, 12.0, 45.0),
        0,
        seededRand(rng, BLOCK_DEPTH * 0.3, BLOCK_DEPTH),
      )
      group.add(tree)
    }
  } else {
    // Fading out nature: trees + one house appearing
    for (let i = 0; i < 3; i++) {
      const o = Math.random
      Math.random = rng
      const tree = createTree(res)
      Math.random = o
      tree.position.set(
        sign * seededRand(rng, 12.0, 45.0),
        0,
        seededRand(rng, 0, BLOCK_DEPTH * 0.6),
      )
      group.add(tree)
    }

    const orig = Math.random
    Math.random = rng
    const house = createHouse(res)
    Math.random = orig
    house.position.set(
      sign * seededRand(rng, 14.0, 15.75),
      0,
      seededRand(rng, BLOCK_DEPTH / 2, BLOCK_DEPTH - 2),
    )
    house.rotation.y = side === 'left' ? 0 : Math.PI
    group.add(house)
  }

  return group
}

function composeBlock(res, blockDef) {
  const rng = mulberry32(blockDef.seed)
  const { zone, side } = blockDef

  if (zone === 'city') return composeCityBlock(res, rng, side)
  if (zone === 'nature') return composeNatureBlock(res, rng, side)
  if (zone === 'city_nature')
    return composeTransitionBlock(res, rng, side, 'city')
  return composeTransitionBlock(res, rng, side, 'nature')
}

// ── Export loop ─────────────────────────────────────────────────────

const exporter = new GLTFExporter()
const res = createBlockResources()

await mkdir(outDir, { recursive: true })

console.log('Exporting landscape blocks...\n')

for (const blockDef of blocks) {
  const scene = composeBlock(res, blockDef)
  const glb = await new Promise((resolve, reject) => {
    exporter.parse(scene, resolve, reject, { binary: true })
  })
  const buf = Buffer.from(glb)
  const filename = `${blockDef.name}.glb`
  const filepath = join(outDir, filename)
  await writeFile(filepath, buf)
  console.log(`  ${filename} (${buf.byteLength} bytes)`)
}

console.log('\nDone! 16 landscape blocks exported.')
