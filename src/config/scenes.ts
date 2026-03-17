export interface SceneModel {
  path: string
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: number | [number, number, number]
}

export interface SceneConfig {
  image: string
  models: SceneModel[]
  effects?: { blocks?: boolean }
}

const base = import.meta.env.BASE_URL

export const scenes: Record<string, SceneConfig> = {
  biking: {
    image: `${base}assets/scenes/highsky.exr`,
    models: [
      {
        path: `${base}assets/scenes/low_poly_bicycle.glb`,
        position: [0, -0.9, 0],
        rotation: [0, 1.25, 0],
      },
    ],
    effects: { blocks: true },
  },
  office: {
    image: `${base}assets/scenes/office_1k.hdr`,
    models: [
      {
        path: `${base}assets/scenes/desk.glb`,
        position: [1.15, -1.1, 0],
        rotation: [0, -1.6, 0],
      },
    ],
  },
}

export const sceneNames = Object.keys(scenes)
