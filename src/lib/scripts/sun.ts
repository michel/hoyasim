import * as pc from 'playcanvas'

// World position for the sun. Up and forward of the cycle's starting point
// so the camera (looking -Z by default) catches it naturally during play.
const SUN_POSITION = new pc.Vec3(0, 22, -25)
const SUN_SCALE = 6.0

const VERTEX_GLSL = `
in vec3 vertex_position;
out vec2 vUv;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
void main(void) {
  vUv = vertex_position.xy * 0.5 + 0.5;
  gl_Position = matrix_viewProjection * matrix_model * vec4(vertex_position, 1.0);
}
`

// Bright core + wide halo, both rendered additively so the disc reads as
// blinding-bright once the impaired overlay's blur convolves it across nearby
// pixels. The halo also makes the sun visible at lens edges, broadening the
// area where the Sensity dot-product test reads as "looking at sun".
const FRAGMENT_GLSL = `
precision highp float;
in vec2 vUv;
void main(void) {
  vec2 d = vUv - 0.5;
  float r = length(d);
  float core = smoothstep(0.45, 0.3, r);
  float halo = smoothstep(0.5, 0.15, r);
  vec3 colour = vec3(2.0) * core + vec3(1.3, 1.25, 1.0) * halo * 0.6;
  float a = clamp(core * 1.5 + halo * 0.5, 0.0, 1.0);
  pcFragColor0 = vec4(colour, a);
}
`

// Adds a fixed-world billboard sun that the Sensity lens reacts to.
// Stays present whether glasses are worn or not so the impaired overlay
// blurs it naturally — and the lens can sample the pre-overlay grab.
export function addSun(
  app: pc.AppBase,
  cameraEntity: pc.Entity,
): { entity: pc.Entity } {
  const device = app.graphicsDevice
  const mesh = new pc.Mesh(device)
  mesh.setPositions([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0])
  mesh.setIndices([0, 1, 2, 1, 3, 2])
  mesh.update()

  const material = new pc.ShaderMaterial({
    uniqueName: 'sun',
    vertexGLSL: VERTEX_GLSL,
    fragmentGLSL: FRAGMENT_GLSL,
    attributes: { vertex_position: pc.SEMANTIC_POSITION },
  })
  material.blendType = pc.BLEND_ADDITIVE
  material.depthWrite = false
  material.depthTest = true
  material.update()

  const entity = new pc.Entity('Sun')
  const meshInstance = new pc.MeshInstance(mesh, material, entity)
  meshInstance.cull = false
  entity.addComponent('render')
  if (entity.render) {
    entity.render.meshInstances = [meshInstance]
    entity.render.layers = [pc.LAYERID_WORLD]
    entity.render.castShadows = false
    entity.render.receiveShadows = false
  }
  entity.setPosition(SUN_POSITION)
  entity.setLocalScale(SUN_SCALE, SUN_SCALE, SUN_SCALE)
  app.root.addChild(entity)

  // Billboard: copy the camera's world rotation every frame so the quad
  // always faces the viewer.
  app.on('update', () => {
    entity.setRotation(cameraEntity.getRotation())
  })

  return { entity }
}

// Returns a value in [0..1] indicating how directly the camera is looking at
// the sun. 1 = sun is centred in view, 0 = sun is behind. Drives the Sensity
// darkening ramp.
const _tmpDir = new pc.Vec3()
export function sunInView(
  cameraEntity: pc.Entity,
  sunEntity: pc.Entity,
): number {
  _tmpDir.sub2(sunEntity.getPosition(), cameraEntity.getPosition()).normalize()
  return Math.max(0, cameraEntity.forward.dot(_tmpDir))
}
