import { BLUR_TAPS } from './glasses-shaders'

// Native equivalents of glasses-shaders.ts: same samples, focus, wings and trace.
// Avoid downloading/compiling GLSL translators before the mobile scene can load.
const diskBlurWGSL = (depthAware: boolean) => `
uniform uPxScale: f32;
var uSceneColorMap: texture_2d<f32>;
var uSceneColorMapSampler: sampler;

fn inBounds(uv: vec2f) -> f32 {
  let m = step(vec2f(0.0), uv) * step(uv, vec2f(1.0));
  return m.x * m.y;
}

fn diskBlur(uv: vec2f, radiusCss: f32, centerDepth: f32) -> vec3f {
  let radiusPx = radiusCss * uniform.uPxScale;
  if (radiusPx < 0.5) {
    return textureSampleLevel(uSceneColorMap, uSceneColorMapSampler, uv, 0.0).rgb;
  }
  let lod = log2(max(radiusPx * 0.5, 1.0));
  // WebGPU's image Y axis points down; preserve the GLSL disk's sample positions.
  let r = uniform.uScreenSize.zw * radiusPx * vec2f(1.0, -1.0);
  var c = vec3f(0.0);
  var w = 0.0;
  for (var i = 0; i < ${BLUR_TAPS}; i++) {
    let fi = f32(i) + 0.5;
    let ang = fi * 2.39996323;
    let rad = sqrt(fi / ${BLUR_TAPS}.0);
    let s = uv + r * (rad * vec2f(cos(ang), sin(ang)));
    var k = inBounds(s);
    ${depthAware ? 'k *= step(centerDepth * 0.8, getLinearScreenDepth(s));' : ''}
    c += textureSampleLevel(uSceneColorMap, uSceneColorMapSampler, s, lod).rgb * k;
    w += k;
  }
  return c / max(w, 1e-4);
}
`

export const LENS_VERTEX_WGSL = `
attribute vertex_position: vec3f;
uniform matrix_model: mat4x4f;
uniform matrix_viewProjection: mat4x4f;
varying vLocalPos: vec3f;
@vertex fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.vLocalPos = input.vertex_position;
  output.position = uniform.matrix_viewProjection * uniform.matrix_model * vec4f(input.vertex_position, 1.0);
  return output;
}
`

export const LENS_FRAGMENT_WGSL = `
// The engine's native helper uses textureLoad, valid in varying blur branches.
#include "screenDepthPS"
uniform uMinX: f32;
uniform uMaxX: f32;
uniform uMinY: f32;
uniform uMaxY: f32;
uniform uCornerWidth: f32;
uniform uCornerHeight: f32;
uniform uFeather: f32;
uniform uLineTrace: f32;
uniform uLineFade: f32;
uniform uTopStrength: f32;
uniform uTopNearLimit: f32;
uniform uTopTransition: f32;
uniform uBottomStrength: f32;
uniform uBottomFarLimit: f32;
uniform uBottomTransition: f32;
uniform uCorridorTop: f32;
uniform uCorridorBottom: f32;
uniform uSoftZoneBlurMax: f32;
varying vLocalPos: vec3f;
const LINE_LEVEL = 0.5;
const LINE_HALF_CSS = 3.5;
const DASH_CYCLE_CSS = 45.0;
const HALF_PI = 1.5707963;
${diskBlurWGSL(true)}

fn focusBlurPx(lensY: f32, d: f32) -> f32 {
  let top = uniform.uTopStrength * (1.0 - smoothstep(
    uniform.uTopNearLimit - uniform.uTopTransition,
    uniform.uTopNearLimit + uniform.uTopTransition, d));
  let bottom = uniform.uBottomStrength * smoothstep(
    uniform.uBottomFarLimit - uniform.uBottomTransition,
    uniform.uBottomFarLimit + uniform.uBottomTransition, d);
  return mix(top, bottom, smoothstep(uniform.uCorridorTop, uniform.uCorridorBottom, lensY));
}

fn softZone(cornerN: vec2f) -> f32 {
  let featherR = uniform.uFeather / max(uniform.uCornerHeight, 1e-4);
  return 1.0 - smoothstep(1.0 - featherR, 1.0, length(cornerN));
}

@fragment fn fragmentMain(input: FragmentInput) -> FragmentOutput {
  let screenUV = input.position.xy * uniform.uScreenSize.zw;
  let lensY = clamp((input.vLocalPos.z - uniform.uMinY) / (uniform.uMaxY - uniform.uMinY), 0.0, 1.0);
  let lensX = clamp((input.vLocalPos.x - uniform.uMinX) / (uniform.uMaxX - uniform.uMinX), 0.0, 1.0);
  let lensYUp = 1.0 - lensY;
  let cornerN = vec2f(
    min(lensX, 1.0 - lensX) / max(uniform.uCornerWidth, 1e-4),
    lensYUp / max(uniform.uCornerHeight, 1e-4));
  let blurAmt = softZone(cornerN);
  let depth = getLinearScreenDepth(screenUV);
  let focusPx = focusBlurPx(lensY, depth);
  var color = diskBlur(screenUV, max(focusPx, blurAmt * uniform.uSoftZoneBlurMax), depth);
  if (uniform.uLineFade > 0.001) {
    let d = abs(blurAmt - LINE_LEVEL);
    let aa = max(fwidth(blurAmt) * LINE_HALF_CSS * uniform.uPxScale, 1e-5);
    let core = 1.0 - smoothstep(0.0, aa, d);
    let theta = atan2(cornerN.y, cornerN.x);
    let lensPx = 1.0 / max(fwidth(lensY), 1e-5);
    let dashes = max(3.0, floor(HALF_PI * uniform.uCornerHeight * lensPx / (DASH_CYCLE_CSS * uniform.uPxScale)));
    let dash = step(0.5, fract(theta * dashes / HALF_PI));
    let thr = uniform.uCornerHeight * (1.0 - uniform.uLineTrace);
    let reveal = smoothstep(thr, thr + 0.03, lensYUp);
    color = mix(color, vec3f(1.0), core * dash * reveal * uniform.uLineFade);
  }
  var output: FragmentOutput;
  output.color = vec4f(color, 1.0);
  return output;
}
`

export const IMPAIRED_VERTEX_WGSL = `
attribute vertex_position: vec3f;
@vertex fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4f(input.vertex_position.xy, 0.0, 1.0);
  return output;
}
`

// WebGPU is selected only for touch: its existing overlay has no chroma offset.
export const IMPAIRED_FRAGMENT_WGSL = `
uniform uScreenSize: vec4f;
uniform uStrength: f32;
uniform uBlurRadius: f32;
uniform uDim: f32;
${diskBlurWGSL(false)}
@fragment fn fragmentMain(input: FragmentInput) -> FragmentOutput {
  let uv = input.position.xy * uniform.uScreenSize.zw;
  let impaired = diskBlur(uv, uniform.uBlurRadius, 0.0) * uniform.uDim;
  var output: FragmentOutput;
  if (uniform.uStrength >= 1.0) {
    output.color = vec4f(impaired, 1.0);
    return output;
  }
  let sharp = textureSampleLevel(uSceneColorMap, uSceneColorMapSampler, uv, 0.0).rgb;
  output.color = vec4f(mix(sharp, impaired, uniform.uStrength), 1.0);
  return output;
}
`
