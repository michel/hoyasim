# Replace shipped splat with fixed2.ply (same compression + LOD, matched scale/orientation)

**Date:** 2026-06-15

New render `/Users/micheldegraaf/Downloads/fixed2.ply` (3,245,586 gaussians, full-SH) — same
model as current source `fixed.ply` (3,246,724), byte-identical PLY property layout. Goal: drop-in
replace the shipped LOD bundle, same compression (`-H 0`, `-C 128`, decimate 50/25/12.5%), matched
scale + orientation. Pipeline documented in-repo (`derive-splat-align.py`, `build-splat.sh`, README).

## Plan
- [x] 1. Derived: scale=0.049533579662214819, translate=0.00958941,-0.0044322,4.17115,
      rotation=0.055° (no `-r`), **overlap=1.000**. fixed2 lands perfectly on current frame.
- [x] 2. build-splat.sh updated: SRC→fixed2.ply, scale + translate (incl. road-seat Y) + comment.
- [x] 3. README updated: `-s`/`-t`, source name, ground re-seat note.
- [x] 4a. First rebuild → 22/11/6/3, 78MB. Geometric check PASS, but road plane +0.124 world high
      (ground re-seat gotcha). Fix: nudge align Y −0.0247 (−0.0044→−0.0292) to seat road on old plane.
- [x] 4b. 2nd rebuild: road went +0.203 world — wrong sign. Found via deterministic PASS-1
      probes that splat-transform applies `-t` Y with a sign flip (slope −1; X/Z normal).
- [~] 4c. Solved t_y=+0.020316 (road → −0.0443). Final rebuild running.
- [ ] 5. Update `config.json` size/hash.
- [ ] 6. Adversarially VERIFY: scale/orientation/road/LOD/config/docs (multi-agent).
- [ ] 7. Update memory + review section.

## Review
_(to be filled after implementation)_

---

# Three-Lens Blur Redesign — Plan

**Date:** 2026-06-08
**Status:** Designed (grilled), awaiting go-ahead before implementation

## Goal

Replace the current 4 Hoya products with the customer's **3 lens designs** — **Balansis**,
**MySelf Profile**, **MySense** — from the renders in `~/Downloads/Lens Design/`. All three
share the **premium progressive multifocal** effect. The **new** feature is a per-product
**peripheral soft-zone blur** that visually distinguishes the tiers (the dotted-line zones in
the images).

## Resolved decisions (from grilling)

| # | Decision | Choice |
|---|---|---|
| 1 | Where blur lives | **Screen-space**, shown only through the lens windows (lens fragment shader) |
| 2 | Product differentiator | **Soft-zone blur only** — all 3 share premium multifocal (current iD MyStyle 3: `uPower 0.02`, `uCenterY 0.5`) |
| 3 | Soft-zone fidelity | **Tuned parametric model** (analytic corner zones, dialed to match images) |
| 4 | Dotted line | **Flash on switch (~1.5s) then fade**, drawn **within the lens windows** |
| 5 | Blur ramp | **Feather starting at the line** — sharp inside, ramps to max toward corners |
| 6 | Blur intensity | **Demo-exaggerated**, capped below the uncorrected overlay (~16px) so periphery reads "soft" not "blind" |
| 7 | L/R symmetry | **Mirror-symmetric** corners (ignore the marketing render's L/R asymmetry) |
| 8 | Cycle order | **Balansis → MySelf Profile → MySense → loop** |
| 9 | Default on put-on | **Both eyes = Balansis** |
| 10 | Per-eye UI | **Keep** two independent selectors |
| 11 | Base overlay | **Keep** full-screen blur + chromatic aberration (the uncorrected world) |
| 12 | Sun / god-rays / Sensity | **Remove entirely**, clean up |
| 13 | Branding | **Keep HOYA** (logo, CTA, palette) |
| 14 | Glasses geometry | **Unchanged** (GLBs, positions, scale, drop-in animation) |
| 15 | Taglines | Balansis = "Essential progressive", MySelf Profile = "Personalised progressive", MySense = "Premium progressive" |

## Soft-zone shapes (from image analysis, normalized, top-left origin)

Top ~37% of frame always sharp. Soft zones in the two **lower corners** only.
Modeled mirror-symmetric; per-product the corner intrusion shrinks as tier rises.

| Lens | Clear field | Corner climb (height) | Corner reach (inward) |
|---|---|---|---|
| Balansis (entry) | ~76% | high (~0.43–0.57 from top) | far in (~x 0.30 / 0.70) |
| MySelf Profile (mid) | ~86% | moderate (~0.50–0.62) | moderate (~x 0.20 / 0.80) |
| MySense (premium) | ~99% | edge-hugging (~0.62+) | slivers (~x 0.15 / 0.87) |

Parametrize each product with `cornerHeight`, `cornerWidth`, `feather` uniforms (+ shared
`blurMax`). Tune on device.

## Implementation checklist

### `src/lib/glasses-pc.ts`
- [ ] `LensProduct` → `'Balansis' | 'MySelf Profile' | 'MySense'`
- [ ] `LENS_PRODUCTS` → 3 profiles carrying soft-zone params (drop `power`/`centerY`/`sensity`; multifocal is now a shared constant)
- [ ] `LENS_PRODUCT_ORDER` → `['Balansis', 'MySelf Profile', 'MySense']`
- [ ] Lens `FRAGMENT_GLSL`: keep multifocal zoom; **add** screen-space soft-zone blur (in-bounds-weighted multi-tap, feathered from boundary outward); **add** dotted-line draw gated by `uLineFade`; **remove** `uSensityDarkness` multiply
- [ ] `applyProductUniforms` → push soft-zone uniforms; remove sensity branch
- [ ] `setLensProduct` → also kick the line-flash tween (`uLineFade` 1 → 0 over ~2s)
- [ ] Remove Sensity per-frame ramp + `SENSITY_*` constants + `SUN_EFFECTS_ENABLED`
- [ ] `IMPAIRED_FRAGMENT_GLSL`: keep blur + chroma; **remove** `uBlind`/`uSunUV`/halo/god-rays
- [ ] `setupImpairedVisionOverlay`: drop sun projection + blind ramp; keep strength fade-in
- [ ] Remove `import { SUN_DIRECTION, sunInView }`

### `src/lib/scripts/sun.ts`
- [ ] Delete

### `src/components/PlayCanvasView.tsx`
- [ ] `LENS_TAGLINES` → 3 entries (Essential / Personalised / Premium progressive)
- [ ] Default `leftProduct`/`rightProduct` → `'Balansis'`
- [ ] Verify progress-dot indicator adapts to 3 (it maps `LENS_PRODUCT_ORDER`)

### Docs
- [ ] Update `README.md` product table
- [ ] Add `docs/plans/2026-06-08-three-lens-blur-design.md` (supersede the 4-product design)

## Verification
- [ ] `bun run` / build clean (biome + tsc), no dead refs to sun/Sensity
- [ ] Visual: put on glasses → both eyes Balansis with pronounced lower-corner blur; cycle each eye → clear field widens to MySense; dotted line flashes then fades on each switch; top of view always sharp; uncorrected world still blurry outside lenses
- [ ] aislop hook clean

## Review
_(to be filled after implementation)_

---

# Tap hint on the left change-lens button

**Date:** 2026-06-08

Add the same tapping-hand hint (used on the "Experience HOYA vision" CTA) to the
bottom-left change-lens button, shown when the glasses are first put on, to teach
the tap-to-cycle gesture.

## Decisions (from grill-me)
- Left lens button only.
- Reuse existing `.cta-tap` + `.cta-tap-contact` animation (Pointer + ripple, 1.5s infinite).
- Placement: bottom-right of the button, same `-bottom-8 right-6` offset as the CTA.
- Show when `glassesOn && !hasCycledLens`.
- Hide on the first lens cycle (any side) — sets `hasCycledLens`.
- Reappears on re-wear only if never cycled; gone for good once cycled.
- Session-only in-memory state (no localStorage).

## Plan
- [x] Add `hasCycledLens` state (default `false`) in `PlayCanvasView`.
- [x] Set `hasCycledLens = true` inside `cycleSide`.
- [x] Add `showHint?: boolean` prop to `LensSelector`.
- [x] Restructure `LensSelector`: positioned wrapper `<div>` holds screen placement
      (`absolute bottom-8 {anchor} z-10`); inner `<button>` becomes `relative`
      (keeps `overflow-hidden`); hint rendered as a sibling of the button so it
      escapes the button's `overflow-hidden`.
- [x] Render the hint (`Pointer` + contact ripple, `pointer-events-none`,
      `absolute -bottom-8 right-6`) only when `showHint` is true.
- [x] Pass `showHint={!hasCycledLens}` to the left selector only.

## Verification
- [x] biome + tsc clean.
- [ ] Glasses on -> hand taps bottom-right of left button, looping. (visual — pending)
- [ ] Tap either lens button -> hint disappears and stays gone. (visual — pending)
- [ ] Take off + put back on after cycling -> no hint. Without cycling -> hint returns. (visual — pending)

## Review
Reused the existing `.cta-tap` / `.cta-tap-contact` animation verbatim, so the
hint is identical to the CTA's. `LensSelector` now returns a positioned wrapper
so the hint (a sibling of the `<button>`) escapes the button's `overflow-hidden`;
all visual button styling is unchanged. Logic: `hasCycledLens` (in-memory, default
`false`) flips to `true` on the first cycle of either side; the left selector gets
`showHint={!hasCycledLens}`. Net diff is small and touches only `PlayCanvasView.tsx`.
tsc + biome clean. Functional/visual check still to run in the browser.
