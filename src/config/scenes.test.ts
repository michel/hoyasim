import { describe, expect, it } from 'vitest'
import { type SceneConfig, sceneNames, scenes } from './scenes'

describe('scenes config', () => {
  it('exports a biking scene with image and models', () => {
    const biking = scenes.biking
    expect(biking).toBeDefined()
    expect(biking.image).toBeTruthy()
    expect(biking.models.length).toBeGreaterThan(0)
  })

  it('exports an office scene with image and models', () => {
    const office = scenes.office
    expect(office).toBeDefined()
    expect(office.image).toContain('office')
    expect(office.models.length).toBeGreaterThan(0)
  })

  it('every model has a path and position tuple', () => {
    for (const [name, scene] of Object.entries(scenes)) {
      for (const model of scene.models) {
        expect(model.path, `${name} model missing path`).toBeTruthy()
        expect(model.position, `${name} model missing position`).toHaveLength(3)
      }
    }
  })

  it('sceneNames matches the keys of scenes', () => {
    expect(sceneNames).toEqual(Object.keys(scenes))
  })

  it('exports SceneConfig and SceneModel types', () => {
    // Type-level assertion: scenes values satisfy SceneConfig
    const _check: Record<string, SceneConfig> = scenes
    expect(_check).toBeDefined()
  })
})
