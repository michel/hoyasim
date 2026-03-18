export type BlockCategory = 'house' | 'tree' | 'bush' | 'crossroads'

export interface BlockModelEntry {
  path: string
  scale?: number | [number, number, number]
  yOffset?: number
  rotationY?: number
}

export type BlockModelManifest = Partial<
  Record<BlockCategory, BlockModelEntry[]>
>

const base = import.meta.env.BASE_URL

export const blockModelManifest: BlockModelManifest = {
  house: [
    { path: `${base}assets/blocks/buildings/house1.glb` },
    { path: `${base}assets/blocks/buildings/house2.glb` },
    { path: `${base}assets/blocks/buildings/house3.glb` },
  ],
  tree: [
    { path: `${base}assets/blocks/trees/tree1.glb` },
    { path: `${base}assets/blocks/trees/tree2.glb` },
  ],
  bush: [
    { path: `${base}assets/blocks/bushes/bush1.glb` },
    { path: `${base}assets/blocks/bushes/bush2.glb` },
  ],
}
