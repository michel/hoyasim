#!/usr/bin/env node

// Validates landscape block ground planes are the correct tiling size.
// The ground plane is identified as the mesh with exactly 4 vertices (a simple quad).
// Width X (left-right) and Depth Z (front-back) must match the target.
// Height Y (up-down) can vary.

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'

const DIR = 'public/assets/blocks/landscape'
const TARGET_WIDTH = 57
const TARGET_DEPTH = 27

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  })
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.glb'))
  .sort()
const errors = []

for (const file of files) {
  const doc = await io.read(join(DIR, file))
  const nodes = doc.getRoot().listNodes()

  // Find ground plane: node named "ground*" or "Plane*" (lowest index)
  // City blocks use "Plane.*" node names, nature/transition blocks use "ground.*"
  const groundNode =
    nodes.find((n) => n.getName().startsWith('ground')) ||
    nodes.find((n) => n.getName().startsWith('Plane'))

  const groundMesh = groundNode?.getMesh()
  if (!groundNode || !groundMesh) {
    console.log(`${file}`)
    console.log(
      `  (no ground plane found — no node named "ground*" or "Plane*")`,
    )
    errors.push({ file, reasons: ['No ground plane found'] })
    continue
  }

  // Collect all position vertices across all primitives of the ground mesh
  const allPositions = []
  for (const prim of groundMesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')
    if (!pos) continue
    for (let i = 0; i < pos.getCount(); i++)
      allPositions.push(pos.getElement(i, [0, 0, 0]))
  }

  if (!allPositions.length) {
    console.log(`${file}`)
    console.log(
      `  (ground plane node "${groundNode.getName()}" has no position data)`,
    )
    errors.push({ file, reasons: ['Ground plane has no geometry'] })
    continue
  }

  const nodeName = groundNode.getName()
  let minX = Infinity,
    maxX = -Infinity
  let minY = Infinity,
    maxY = -Infinity
  let minZ = Infinity,
    maxZ = -Infinity

  for (let i = 0; i < allPositions.length; i++) {
    const v = allPositions[i]
    if (v[0] < minX) minX = v[0]
    if (v[0] > maxX) maxX = v[0]
    if (v[1] < minY) minY = v[1]
    if (v[1] > maxY) maxY = v[1]
    if (v[2] < minZ) minZ = v[2]
    if (v[2] > maxZ) maxZ = v[2]
  }

  const w = maxX - minX
  const h = maxY - minY
  const d = maxZ - minZ

  console.log(`${file}  (ground plane: ${nodeName})`)
  console.log(`  Width  X (left-right) : ${w.toFixed(2)}`)
  console.log(`  Height Y (up-down)    : ${h.toFixed(2)}`)
  console.log(`  Depth  Z (front-back) : ${d.toFixed(2)}`)

  const reasons = []
  if (Math.abs(w - TARGET_WIDTH) > 0.01)
    reasons.push(
      `Width X (left-right) is ${w.toFixed(2)}, should be ${TARGET_WIDTH}`,
    )
  if (Math.abs(d - TARGET_DEPTH) > 0.01)
    reasons.push(
      `Depth Z (front-back) is ${d.toFixed(2)}, should be ${TARGET_DEPTH}`,
    )
  if (reasons.length) errors.push({ file, reasons })
}

console.log('')
console.log('==========================================')
console.log(
  `Target: Width X (left-right) = ${TARGET_WIDTH}, Depth Z (front-back) = ${TARGET_DEPTH}`,
)
console.log('==========================================')

if (errors.length) {
  console.log('')
  console.log('BLOCKS THAT NEED FIXING:')
  for (const { file, reasons } of errors) {
    console.log(`  ${file}`)
    for (const r of reasons) console.log(`    - ${r}`)
  }
  console.log('')
  process.exit(1)
} else {
  console.log('')
  console.log('All ground planes are the correct size!')
  console.log('')
}
