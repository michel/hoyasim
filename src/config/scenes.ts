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
        position: [0.4, -3.15, 0],
        rotation: [0, 1.25, 0],
        scale: 2.0,
      },
    ],
    effects: { blocks: true },
  },
}

export const sceneNames = Object.keys(scenes)
