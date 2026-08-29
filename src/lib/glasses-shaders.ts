// GLSL sources for the glasses effect. Two programs live here: the progressive
// lens (corrects the impaired overlay within the lens geometry and re-adds the
// per-product soft zone) and the full-screen "uncorrected vision" overlay. Kept
// apart from the PlayCanvas wiring so glasses-pc.ts stays focused on runtime.

// Premium progressive multifocal, shared by all three products. The soft-zone
// blur (not this curve) is what distinguishes Balansis / MySelf Profile /
// MySense from one another.
const MULTIFOCAL_POWER = 0.055
const MULTIFOCAL_CENTER_Y = 0.5
// Brightness of the impaired (outside-lens) surround; < 1 darkens it so the
// corrected lens view draws the eye.
const IMPAIRED_DIM = 0.78

// Weight a tap to 0 if its UV leaves [0,1] so edge texels aren't repeated into
// the kernel sum — that's what produces axis-aligned streaks near the boundary.
// Shared by both programs' blur kernels.
const INBOUNDS_GLSL = `
float inBounds(vec2 uv) {
  vec2 m = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return m.x * m.y;
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
// taps: soft-zone blur kernel size. Mobile GPUs are fill-bound, so touch
// devices compile an 8-tap kernel (visually equivalent at their reduced pixel
// ratio); desktop keeps the full 16.
export const lensFragmentGLSL = (taps: number) => `
precision highp float;
uniform sampler2D uSceneColorMap;
uniform vec4 uScreenSize;
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
uniform float uBlurMax;       // max soft-zone blur radius, pixels
uniform float uLineTrace;     // 0..1 boundary-line reveal progress (sweeps the trace on)
uniform float uLineFade;      // 0..1 boundary-line opacity (handles the fade-out)
// This lens's own optical centre in screen UV, updated per frame from the lens
// mesh's projected position. The multifocal displacement scales around its
// horizontal centre LINE (y) — never around the shared screen centre, which
// let a lens's magnified zone reach across the nose bridge and duplicate
// content from the other half of the screen.
uniform vec2 uLensCenter;
in vec3 vLocalPos;

const float POWER = ${MULTIFOCAL_POWER.toFixed(3)};
const float CENTER_Y = ${MULTIFOCAL_CENTER_Y.toFixed(3)};
const float LINE_LEVEL = 0.5;     // soft-zone contour the boundary line traces
const float LINE_HALF_PX = 6.0;        // line half-width in pixels
const float LINE_DASH_COUNT = 11.0;    // dash + gap cycles along each corner arc
const float HALF_PI = 1.5707963;
${INBOUNDS_GLSL}

// Constant-radius soft-focus blur (golden-angle / Vogel disk). The strength of
// the soft zone is varied by cross-fading sharp->blurred (see main), NOT by
// ramping this radius. A radius that ramps across the zone makes the fixed
// sample pattern's reach change along the boundary, which draws the iso-radius
// contour as a dotted line. Blurring at a constant radius — exactly how the
// artifact-free full-screen overlay works — keeps the boundary clean. center
// is the already-fetched sharp sample, reused as the centre tap.
vec3 softBlur(vec2 base, vec3 center) {
  vec2 r = uScreenSize.zw * uBlurMax;
  vec3 c = center;
  float w = 1.0;
  for (int i = 1; i <= ${taps}; i++) {
    float fi = float(i);
    float ang = fi * 2.39996323;   // golden angle
    float rad = sqrt(fi / ${taps}.0);  // even area coverage
    vec2 s = base + r * (rad * vec2(cos(ang), sin(ang)));
    float k = inBounds(s);
    c += texture(uSceneColorMap, s).rgb * k;
    w += k;
  }
  return c / w;
}

// Soft-zone blur amount [0,1] at a lens-local point (y-up). Sharp (0) across
// the clear field; ramps to 1 into the two lower corners. Each corner is a
// quarter ellipse — distance from the corner origin, normalised by the
// per-product reach (uCornerWidth across, uCornerHeight up) — so the boundary
// is a smooth round arc rather than a squared-off bend. Mirror-symmetric.
float softZone(vec2 uv) {
  float hx = min(uv.x, 1.0 - uv.x);          // distance from the nearer side
  float nx = hx / max(uCornerWidth, 1e-4);
  float ny = uv.y / max(uCornerHeight, 1e-4);
  float r = length(vec2(nx, ny));            // 1.0 on the zone boundary
  float featherR = uFeather / max(uCornerHeight, 1e-4);
  return 1.0 - smoothstep(1.0 - featherR, 1.0, r);
}

void main(void) {
  vec2 screenUV = gl_FragCoord.xy * uScreenSize.zw;

  // vLocalPos.z is the lens GLB's vertical axis (0 = visual top, 1 = bottom).
  // Multifocal progressive: minify above the neutral band, magnify below it.
  float lensY = clamp((vLocalPos.z - uMinY) / (uMaxY - uMinY), 0.0, 1.0);
  float factor = (CENTER_Y - lensY) * 2.0 * POWER;

  // Displace along the vertical axis only, around this lens's centre line: the
  // progressive power runs top -> bottom, so the zoom must read as vertical
  // compression at the top and vertical expansion below. A radial scale about
  // the centre point displaced mostly SIDEWAYS wherever content sat left or
  // right of it (the handlebar phones), which read as a left/right zoom. Cap
  // the displacement with a tanh asymptote so the sample can shift at most
  // ~2.5% of the screen away from the true content under this pixel.
  float dy = (screenUV.y - uLensCenter.y) * factor;
  vec2 disp = vec2(0.0, 0.025 * tanh(dy / 0.025));
  vec2 sampleUV = screenUV + disp;

  // Fade alpha to 0 before the displaced sample reaches the screen edge, so the
  // (blurred) underlying world shows through instead of a clamped streak.
  vec2 edgeDist = min(sampleUV, 1.0 - sampleUV);
  float minEdge = min(edgeDist.x, edgeDist.y);
  float alpha = smoothstep(0.0, 0.05, minEdge);

  sampleUV = clamp(sampleUV, vec2(0.001), vec2(0.999));

  // Peripheral soft-zone blur — the per-product differentiator. Cross-fade the
  // sharp sample toward a constant-radius blur by the soft-zone amount. No
  // branch and no radius ramp, so the boundary stays artifact-free: the field
  // is smooth, mix() is continuous, and blurAmt = 0 yields the sharp sample
  // exactly.
  // Anchor the soft zone in lens-local space (not screen space) so its corners
  // stay a fixed fraction of the lens at any window size / aspect ratio. lensY
  // is y-down (0 = top); flip it so the zone sits in the lens's lower corners.
  float lensX = clamp((vLocalPos.x - uMinX) / (uMaxX - uMinX), 0.0, 1.0);
  float lensYUp = 1.0 - lensY;
  float blurAmt = softZone(vec2(lensX, lensYUp));
  vec3 sharp = texture(uSceneColorMap, sampleUV).rgb;
  vec3 color = mix(sharp, softBlur(sampleUV, sharp), blurAmt);

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
    float nx = min(lensX, 1.0 - lensX) / max(uCornerWidth, 1e-4);
    float ny = lensYUp / max(uCornerHeight, 1e-4);
    float theta = atan(ny, nx);
    float dash = step(0.5, fract(theta * LINE_DASH_COUNT / HALF_PI));
    float thr = uCornerHeight * (1.0 - uLineTrace);
    float reveal = smoothstep(thr, thr + 0.03, lensYUp);
    color = mix(color, vec3(1.0), core * dash * reveal * uLineFade);
  }

  pcFragColor0 = vec4(color, alpha);
}
`

export const IMPAIRED_VERTEX_GLSL = `
in vec3 vertex_position;
void main(void) { gl_Position = vec4(vertex_position.xy, 0.0, 1.0); }
`

// Full-screen "uncorrected vision" overlay: blur + chromatic aberration. This
// is the world the lenses correct; it stays on for the whole session.
// chroma: per-channel offset blurs (3x the taps) for chromatic aberration.
// The offset is sub-pixel on phones (uChroma 0.001 at <=0.5 device pixel
// ratio), so touch devices compile the single-blur variant — a third of the
// heaviest full-screen pass — with no visible difference.
export const impairedFragmentGLSL = (chroma: boolean) => `
precision highp float;
uniform sampler2D uSceneColorMap;
uniform vec4 uScreenSize;
uniform float uBlurRadius;
uniform float uChroma;
uniform float uStrength;
${INBOUNDS_GLSL}

vec3 blur9(vec2 base, vec2 px) {
  vec3 c = vec3(0.0);
  float wsum = 0.0;
  vec2 s; float k;
  s = base + vec2( 0.0,  0.0); k = 0.227027 * inBounds(s); c += texture(uSceneColorMap, s).rgb * k; wsum += k;
  s = base + vec2( px.x, 0.0); k = 0.1945946 * inBounds(s); c += texture(uSceneColorMap, s).rgb * k; wsum += k;
  s = base + vec2(-px.x, 0.0); k = 0.1945946 * inBounds(s); c += texture(uSceneColorMap, s).rgb * k; wsum += k;
  s = base + vec2( 0.0,  px.y); k = 0.1216216 * inBounds(s); c += texture(uSceneColorMap, s).rgb * k; wsum += k;
  s = base + vec2( 0.0, -px.y); k = 0.1216216 * inBounds(s); c += texture(uSceneColorMap, s).rgb * k; wsum += k;
  s = base + vec2( px.x,  px.y); k = 0.054054 * inBounds(s); c += texture(uSceneColorMap, s).rgb * k; wsum += k;
  s = base + vec2(-px.x, -px.y); k = 0.054054 * inBounds(s); c += texture(uSceneColorMap, s).rgb * k; wsum += k;
  s = base + vec2( px.x, -px.y); k = 0.054054 * inBounds(s); c += texture(uSceneColorMap, s).rgb * k; wsum += k;
  s = base + vec2(-px.x,  px.y); k = 0.054054 * inBounds(s); c += texture(uSceneColorMap, s).rgb * k; wsum += k;
  return c / max(wsum, 1e-4);
}

void main(void) {
  vec2 uv = gl_FragCoord.xy * uScreenSize.zw;
  vec2 px = uScreenSize.zw * uBlurRadius;
  // Chromatic aberration: blur each channel at a slightly offset base UV. R
  // and B shift radially in opposite directions; G stays centered. Since all
  // three reads are blurred (not sharp), there's no fringing when uChroma = 0
  // — the offset just collapses and all three sample the same place.
${
  chroma
    ? `
  vec2 dir = uv - vec2(0.5);
  vec2 off = dir * uChroma;
  vec3 cR = blur9(uv + off, px);
  vec3 cG = blur9(uv, px);
  vec3 cB = blur9(uv - off, px);
  vec3 impaired = vec3(cR.r, cG.g, cB.b);`
    : `
  vec3 impaired = blur9(uv, px);`
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
