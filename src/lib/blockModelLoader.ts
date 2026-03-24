import type * as THREE from 'three'
import type { LandscapeBlock } from '@/config/blockModels'
import { gltfLoader } from '@/lib/loaders'

export type LoadedLandscapeBlocks = THREE.Object3D[]

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

export async function loadLandscapeBlocks(
  sequence: LandscapeBlock[],
): Promise<LoadedLandscapeBlocks> {
  const tasks = sequence.map(async (entry) => {
    try {
      return await loadOne(entry.path)
    } catch (e) {
      console.warn(`[blockModelLoader] Skipping: ${(e as Error).message}`)
      return null
    }
  })

  const results = await Promise.all(tasks)
  return results.filter((r): r is THREE.Object3D => r !== null)
}
