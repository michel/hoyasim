import type * as THREE from 'three'
import type {
  BlockCategory,
  BlockModelEntry,
  BlockModelManifest,
} from '@/config/blockModels'
import { gltfLoader } from '@/lib/loaders'

export type LoadedBlockModels = Partial<Record<BlockCategory, THREE.Object3D[]>>

function applyEntry(obj: THREE.Object3D, entry: BlockModelEntry) {
  if (entry.scale != null) {
    const s = Array.isArray(entry.scale)
      ? entry.scale
      : [entry.scale, entry.scale, entry.scale]
    obj.scale.set(...(s as [number, number, number]))
  }
  if (entry.yOffset != null) obj.position.y = entry.yOffset
  if (entry.rotationY != null) obj.rotation.y = entry.rotationY
}

function loadOne(path: string): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    gltfLoader.load(
      path,
      (gltf) => resolve(gltf.scene),
      undefined,
      () => reject(new Error(`Failed to load block model: ${path}`)),
    )
  })
}

export async function loadBlockModels(
  manifest: BlockModelManifest,
): Promise<LoadedBlockModels> {
  const result: LoadedBlockModels = {}
  const entries = Object.entries(manifest) as [
    BlockCategory,
    NonNullable<BlockModelManifest[BlockCategory]>,
  ][]

  if (entries.length === 0) return result

  const tasks = entries.flatMap(([category, models]) =>
    models.map(async (entry) => {
      try {
        const obj = await loadOne(entry.path)
        applyEntry(obj, entry)
        result[category] ??= []
        result[category].push(obj)
      } catch (e) {
        console.warn(
          `[blockModelLoader] Skipping ${category}: ${(e as Error).message}`,
        )
      }
    }),
  )

  await Promise.all(tasks)
  return result
}
