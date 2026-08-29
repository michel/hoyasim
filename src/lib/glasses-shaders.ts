// GLSL sources for the glasses effect. Two programs live here: the progressive
// lens (corrects the impaired overlay within the lens geometry and re-adds the
// per-product soft zone) and the full-screen "uncorrected vision" overlay. Kept
// apart from the PlayCanvas wiring so glasses-pc.ts stays focused on runtime.

// Progressive FOCUS is the headline effect, shared by all three products (the
// soft-zone blur is what distinguishes Balansis / MySelf Profile / MySense). A
// presbyopic eye can no longer refocus, so the lens does it by gaze height: the
// distance zone (top) focuses at infinity, the corridor ramps the power, and
// the near zone (bottom) focuses at the handlebar phones. Blur grows with the
// dioptric defocus |1/d - 1/focus| and saturates at one full add. Distances are
// world units — tune NEAR_FOCUS_DIST by eye against the phones. Content within
// FOCUS_TOLERANCE (in units of one add) of the focus target is drawn fully
// sharp, so the phones, which span some depth, read crisp in the reading zone.
// Marketing-exaggerated on purpose: a real corridor sits lower and is longer;
// here the near zone starts just under the centre line so the handlebar phones
// read sharp from the natural riding view.
const NEAR_FOCUS_DIST = 0.18
const CORRIDOR_TOP = 0.4
const CORRIDOR_BOTTOM = 0.6
const FOCUS_TOLERANCE = 0.15
// Blur radius ladder, in CSS pixels (the shader scales by uPxScale, framebuffer
// pixels per CSS pixel, so a 0.5x phone and a 1.5x desktop get the same look):
// soft-zone wings < defocus < uncorrected overlay, so the periphery reads
// "soft", a wrong zone reads "no glasses", and nothing inside the lens is ever
// worse than outside it.
const SOFT_ZONE_BLUR_MAX_PX = 7.0
const DEFOCUS_BLUR_MAX_PX = 8.0
const IMPAIRED_BLUR_RADIUS_PX = 10.0
// Chromatic aberration offset of the overlay, in screen UV.
const IMPAIRED_CHROMA_STRENGTH = 0.001
// Brightness of the impaired (outside-lens) surround; < 1 darkens it so the
// corrected lens view draws the eye.
const IMPAIRED_DIM = 0.78

// Smooth variable-radius blur shared by both programs: a golden-angle (Vogel)
// disk of taps over the scene grab's mip chain. The mip level does the heavy
// lifting — its texel is half the radius, so each tap already averages a box
// that fits inside the disk — and the taps hide the block structure a bare mip
// fetch shows at large radii. A full-resolution kernel resolved each tap as its
// own translucent copy on high-contrast content (ghost panes on the phones);
// prefiltered taps cannot, and reading a reduced level keeps the pass cheap on
// phones. A tap whose UV leaves [0,1] is weighted to 0 so edge texels aren't
// repeated into the sum — that produces axis-aligned streaks at the border.
// Eight prefiltered taps cover any radius used here; more only costs fill.
const BLUR_TAPS = 8
const DISK_BLUR_GLSL = `
uniform float uPxScale;  // framebuffer pixels per CSS pixel
float inBounds(vec2 uv) {
  vec2 m = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return m.x * m.y;
}

vec3 diskBlur(vec2 uv, float radiusCss) {
  float radiusPx = radiusCss * uPxScale;
  if (radiusPx < 0.5) return textureLod(uSceneColorMap, uv, 0.0).rgb;
  float lod = log2(max(radiusPx * 0.5, 1.0));
  vec2 r = uScreenSize.zw * radiusPx;
  vec3 c = vec3(0.0);
  float w = 0.0;
  for (int i = 0; i < ${BLUR_TAPS}; i++) {
    float fi = float(i) + 0.5;
    float ang = fi * 2.39996323;         // golden angle
    float rad = sqrt(fi / ${BLUR_TAPS}.0); // even area coverage
    vec2 s = uv + r * (rad * vec2(cos(ang), sin(ang)));
    float k = inBounds(s);
    c += textureLod(uSceneColorMap, s, lod).rgb * k;
    w += k;
  }
  return c / max(w, 1e-4);
}
`

export const LENS_VERTEX_GLSL = `
in vec3 vertex_position;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
out vec3 vLocalPos;
void main(void) {
  vLocalPos = vertex_position;
  gl_Position = matrix_viewProjection * matrix_model * vec4(vertex_position, 1.0);
}
`

// The lens corrects the full-screen impaired blur within its geometry (sampling
// the pre-overlay scene grab) AND re-introduces a controlled peripheral blur in
// the two lower corners — the progressive "soft zone". The size of that soft
// zone is the only thing that differs between the three products.
export const LENS_FRAGMENT_GLSL = `
precision highp float;
// Engine chunk: declares uSceneDepthMap, camera_params and uScreenSize, and
// getLinearScreenDepth(uv), which decodes whichever depth-grab format the
// engine picked (raw depth texture, linear R32F, packed RGBA8). Note the splat
// writes no depth, so the street reads as the far plane — infinity — and only
// the cockpit meshes carry depth. That is exactly the near/far split the focus
// model needs.
#include "screenDepthPS"
uniform sampler2D uSceneColorMap;
uniform float uMinX;
uniform float uMaxX;
uniform float uMinY;
uniform float uMaxY;
// Soft-zone geometry (mirror-symmetric lower corners) in lens-local space,
// y-up (0 = lens bottom edge, 1 = lens top edge). Each corner is a quarter
// ellipse with these two radii.
uniform float uCornerWidth;   // horizontal reach in from each side of the lens
uniform float uCornerHeight;  // vertical climb up from the lens bottom edge
uniform float uFeather;       // ramp width from sharp -> blurred
uniform float uLineTrace;     // 0..1 boundary-line reveal progress (sweeps the trace on)
uniform float uLineFade;      // 0..1 boundary-line opacity (handles the fade-out)
in vec3 vLocalPos;

const float NEAR_FOCUS_DIST = ${NEAR_FOCUS_DIST.toFixed(3)};
const float CORRIDOR_TOP = ${CORRIDOR_TOP.toFixed(3)};
const float CORRIDOR_BOTTOM = ${CORRIDOR_BOTTOM.toFixed(3)};
const float FOCUS_TOLERANCE = ${FOCUS_TOLERANCE.toFixed(3)};
const float DEFOCUS_BLUR_MAX_PX = ${DEFOCUS_BLUR_MAX_PX.toFixed(1)};
const float SOFT_ZONE_BLUR_MAX_PX = ${SOFT_ZONE_BLUR_MAX_PX.toFixed(1)};
const float LINE_LEVEL = 0.5;     // soft-zone contour the boundary line traces
const float LINE_HALF_PX = 6.0;        // line half-width in pixels
const float LINE_DASH_COUNT = 11.0;    // dash + gap cycles along each corner arc
const float HALF_PI = 1.5707963;
${DISK_BLUR_GLSL}

// Defocus blur radius (CSS px) at lens height lensY (0 = top) for scene depth
// d. add is the focus target in units of one full add: 0 (infinity) in the
// distance zone, 1 (the phones) in the near zone; NEAR_FOCUS_DIST / d is the
// scene depth in the same units. Within FOCUS_TOLERANCE of the target the
// blur is exactly zero.
float defocusPx(float lensY, float d) {
  float add = smoothstep(CORRIDOR_TOP, CORRIDOR_BOTTOM, lensY);
  float defocus = abs(NEAR_FOCUS_DIST / max(d, 1e-4) - add) - FOCUS_TOLERANCE;
  return DEFOCUS_BLUR_MAX_PX * clamp(defocus / (1.0 - FOCUS_TOLERANCE), 0.0, 1.0);
}

// Soft-zone blur amount [0,1] from the corner-normalised position (see main).
// Sharp (0) across the clear field; ramps to 1 into the two lower corners.
// Each corner is a quarter ellipse — 1.0 on its boundary — so the boundary is
// a smooth round arc rather than a squared-off bend. Mirror-symmetric.
float softZone(vec2 cornerN) {
  float featherR = uFeather / max(uCornerHeight, 1e-4);
  return 1.0 - smoothstep(1.0 - featherR, 1.0, length(cornerN));
}

void main(void) {
  vec2 screenUV = gl_FragCoord.xy * uScreenSize.zw;

  // vLocalPos.z is the lens GLB's vertical axis (0 = visual top, 1 = bottom).
  float lensY = clamp((vLocalPos.z - uMinY) / (uMaxY - uMinY), 0.0, 1.0);

  // Peripheral soft-zone blur — the per-product differentiator, the wings of
  // unwanted astigmatism either side of the corridor.
  // Anchor the soft zone in lens-local space (not screen space) so its corners
  // stay a fixed fraction of the lens at any window size / aspect ratio. lensY
  // is y-down (0 = top); flip it so the zone sits in the lens's lower corners.
  float lensX = clamp((vLocalPos.x - uMinX) / (uMaxX - uMinX), 0.0, 1.0);
  float lensYUp = 1.0 - lensY;
  // Corner-normalised position: distance from the nearer side over the corner
  // width, height above the bottom edge over the corner height — 1.0 on the
  // zone boundary. Shared by the blur amount and the boundary-line trace.
  vec2 cornerN = vec2(
    min(lensX, 1.0 - lensX) / max(uCornerWidth, 1e-4),
    lensYUp / max(uCornerHeight, 1e-4)
  );
  float blurAmt = softZone(cornerN);
  // Progressive focus: blur by how far the scene under this pixel sits from
  // the distance this part of the lens focuses at; the wings take over where
  // their blur is larger. One prefiltered disk at that radius keeps the zone
  // boundary smooth — the feather ramps blurAmt, so the radius ramps too.
  float focusPx = defocusPx(lensY, getLinearScreenDepth(screenUV));
  vec3 color = diskBlur(screenUV, max(focusPx, blurAmt * SOFT_ZONE_BLUR_MAX_PX));

  // Boundary-line trace. Animated on put-on and on every product switch to show
  // where this product's clear field ends. uLineFade is a uniform, so this
  // branch is uniform across the whole draw (no divergent-quad artifacts). The
  // line is a thin, constant-width (fwidth) dotted contour at LINE_LEVEL, swept
  // on from the top of the zone downward by uLineTrace, then faded by uLineFade.
  if (uLineFade > 0.001) {
    float d = abs(blurAmt - LINE_LEVEL);
    float aa = max(fwidth(blurAmt) * LINE_HALF_PX, 1e-5);
    float core = 1.0 - smoothstep(0.0, aa, d);
    // Dash by the polar angle around this corner's origin (lens-local lower
    // corner, normalised by the zone reach). The angle rises monotonically along
    // the arc from the bottom edge up to the side edge, so dashes stay even and
    // unbroken through the corner. A screen-space tangent projection broke up
    // there because the tangent rotates — and flips sign — across the curve.
    float theta = atan(cornerN.y, cornerN.x);
    float dash = step(0.5, fract(theta * LINE_DASH_COUNT / HALF_PI));
    float thr = uCornerHeight * (1.0 - uLineTrace);
    float reveal = smoothstep(thr, thr + 0.03, lensYUp);
    color = mix(color, vec3(1.0), core * dash * reveal * uLineFade);
  }

  pcFragColor0 = vec4(color, 1.0);
}
`

export const IMPAIRED_VERTEX_GLSL = `
in vec3 vertex_position;
void main(void) { gl_Position = vec4(vertex_position.xy, 0.0, 1.0); }
`

// Full-screen "uncorrected vision" overlay: blur + chromatic aberration. This
// is the world the lenses correct; it stays on for the whole session.
// chroma: per-channel offset blurs (3x the taps) for chromatic aberration.
// The offset is sub-pixel on phones (CHROMA 0.001 at <=0.5 device pixel
// ratio), so touch devices compile the single-blur variant — a third of the
// heaviest full-screen pass — with no visible difference.
export const impairedFragmentGLSL = (chroma: boolean) => `
precision highp float;
uniform sampler2D uSceneColorMap;
uniform vec4 uScreenSize;
uniform float uStrength;
const float BLUR_RADIUS_PX = ${IMPAIRED_BLUR_RADIUS_PX.toFixed(1)};
const float CHROMA = ${IMPAIRED_CHROMA_STRENGTH.toFixed(4)};
${DISK_BLUR_GLSL}
void main(void) {
  vec2 uv = gl_FragCoord.xy * uScreenSize.zw;
  // Chromatic aberration: blur each channel at a slightly offset base UV. R
  // and B shift radially in opposite directions; G stays centered. Since all
  // three reads are blurred (not sharp), there's no fringing when CHROMA = 0
  // — the offset just collapses and all three sample the same place.
${
  chroma
    ? `
  vec2 dir = uv - vec2(0.5);
  vec2 off = dir * CHROMA;
  vec3 cR = diskBlur(uv + off, BLUR_RADIUS_PX);
  vec3 cG = diskBlur(uv, BLUR_RADIUS_PX);
  vec3 cB = diskBlur(uv - off, BLUR_RADIUS_PX);
  vec3 impaired = vec3(cR.r, cG.g, cB.b);`
    : `
  vec3 impaired = diskBlur(uv, BLUR_RADIUS_PX);`
}
  // Dim the impaired surround so the corrected view through the lenses reads
  // brighter by contrast — the eye goes to the clear, full-brightness glass.
  impaired *= ${IMPAIRED_DIM.toFixed(2)};
  // uStrength is a uniform, so this branch is uniform across the draw; once the
  // fade-in pins it at 1 the full-screen sharp tap + mix is skipped entirely.
  if (uStrength >= 1.0) {
    pcFragColor0 = vec4(impaired, 1.0);
    return;
  }
  vec3 sharp = texture(uSceneColorMap, uv).rgb;
  pcFragColor0 = vec4(mix(sharp, impaired, uStrength), 1.0);
}
`
