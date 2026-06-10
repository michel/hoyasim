import type * as pc from 'playcanvas'

// findComponents returns Component[]; every caller wants the typed render
// components, so centralise the cast.
export const renderComponents = (entity: pc.Entity) =>
  entity.findComponents('render') as pc.RenderComponent[]
