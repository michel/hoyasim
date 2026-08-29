import type * as pc from 'playcanvas'

// findComponents returns Component[]; every caller wants the typed render
// components, so centralise the cast.
export const renderComponents = (entity: pc.Entity) =>
  entity.findComponents('render') as pc.RenderComponent[]

// Blur radii (impaired overlay, lens soft zone) are authored in framebuffer
// pixels against a native-devicePixelRatio framebuffer. maxPixelRatio caps the
// framebuffer below native on most devices, so radii scale by the same ratio to
// keep each blur covering the screen fraction it was tuned to.
export const blurPixelScale = (app: pc.AppBase) =>
  app.graphicsDevice.maxPixelRatio / (window.devicePixelRatio || 1)
