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
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import {
  createBlockResources,
  createBush,
  createHouse,
  createTree,
} from '../src/lib/blocks.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outDir = join(root, 'public', 'assets', 'blocks')

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

// ── Export map ──────────────────────────────────────────────────────

const exportMap = [
  { category: 'buildings', factory: createHouse, prefix: 'house', variants: 3 },
  { category: 'trees', factory: createTree, prefix: 'tree', variants: 2 },
  { category: 'bushes', factory: createBush, prefix: 'bush', variants: 2 },
]

// ── Export loop ─────────────────────────────────────────────────────

const exporter = new GLTFExporter()
const res = createBlockResources()
const manifestEntries = {}

console.log('Exporting blocks...\n')

for (const { category, factory, prefix, variants } of exportMap) {
  manifestEntries[prefix] = []
  await mkdir(join(outDir, category), { recursive: true })

  for (let i = 1; i <= variants; i++) {
    const rng = mulberry32(prefix.charCodeAt(0) * 1000 + i)
    const origRandom = Math.random
    let obj
    Math.random = rng
    try {
      obj = factory(res)
    } finally {
      Math.random = origRandom
    }

    const glb = await new Promise((resolve, reject) => {
      exporter.parse(obj, resolve, reject, { binary: true })
    })
    const buf = Buffer.from(glb)
    const filename = `${prefix}${i}.glb`
    const filepath = join(outDir, category, filename)
    await writeFile(filepath, buf)
    console.log(`  ${category}/${filename} (${buf.byteLength} bytes)`)

    manifestEntries[prefix].push(`assets/blocks/${category}/${filename}`)
  }
}

// ── Generate blockModels.ts ─────────────────────────────────────────

const lines = [
  'export type BlockCategory =',
  "  | 'house'",
  "  | 'tree'",
  "  | 'bush'",
  "  | 'crossroads'",
  '',
  'export interface BlockModelEntry {',
  '  path: string',
  '  scale?: number | [number, number, number]',
  '  yOffset?: number',
  '  rotationY?: number',
  '}',
  '',
  'export type BlockModelManifest = Partial<Record<BlockCategory, BlockModelEntry[]>>',
  '',
  'const base = import.meta.env.BASE_URL',
  '',
  'export const blockModelManifest: BlockModelManifest = {',
]

for (const [key, paths] of Object.entries(manifestEntries)) {
  lines.push(`  ${key}: [`)
  for (const p of paths) lines.push(`    { path: \`\${base}${p}\` },`)
  lines.push('  ],')
}

lines.push('}')
lines.push('')

const manifestPath = join(root, 'src', 'config', 'blockModels.ts')
await writeFile(manifestPath, lines.join('\n'))
console.log(`\nManifest written to src/config/blockModels.ts`)
