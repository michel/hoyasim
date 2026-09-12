# Mobile rendering performance research

## Objective and acceptance criteria

Target a 50% increase in sustained mobile frame rate relative to commit `e48f074`, while preserving the rendered resolution, scene detail, lens optics, animations, controls, and user experience. A 50% FPS increase requires frame time to fall to two-thirds of baseline: 30 to 45 FPS means 33.33 to 22.22 ms. GPU-time improvements on a desktop are screening evidence, not proof of mobile FPS improvement.

The mobile framebuffer remains one pixel per CSS pixel, the splat budget remains 500,000, and the existing distance and streaming settings remain fixed. Preserve all three products, their depth-aware blur, blur samples, texture mipmaps, fog, field of view, camera placement, scene assets, traffic-light behavior, and gyro/pointer input. Reducing any of these to reach a score is outside scope.

## Experiment protocol

The loop follows Karpathy's autoresearch structure: establish a baseline, propose one change, run a fixed evaluation, record the result, retain supported improvements, and revert failures. The original uses validation loss; this application uses frame intervals plus fidelity gates. Evaluation code and workload must remain fixed once calibrated. Changes to the benchmark invalidate earlier comparisons and require a new baseline. [1]

`scripts/perf.mjs` builds the real application in production mode with test-only access to the PlayCanvas instance. It runs a landscape touch viewport at 852 × 393 CSS pixels and DPR 3, verifies that the actual framebuffer is 852 × 393, and exercises glasses off and all three lens products. Each state receives loading/animation warmup, then the same timed camera path for 30 seconds. The path is a rendering workload; it deliberately controls pose independently of achieved FPS and is not a test of the natural traffic-light cycle.

The runner saves raw frame intervals, achieved FPS, frame-time percentiles, GPU timing when supported, CPU update/render duration, splat and draw counts, errors, source diff, engine/browser versions, and unscaled canvas captures under `artifacts/perf/<label>`. Hidden tabs, missing splats, incorrect resolution/budget, and browser errors fail the run. Canvas capture clips its viewport bounds directly: uncapped requestAnimationFrame can otherwise starve Playwright’s element-stability heuristic. Capture exceptions are recorded as failed runs. Instrumentation is injected only into the temporary benchmark build; normal production builds have no benchmark globals or runtime overhead.

Run with an existing Playwright installation:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/perf.mjs baseline
```

Use alternating baseline/candidate runs and at least three repeats for a final performance claim. Keep browser, device, power mode, viewport, temperature, background workloads, and camera path constant. A short screening run (`PERF_SECONDS=10`) is not interchangeable with the standard 30-second run. Review mean and p95 frame times, not only peak FPS. Preserve screenshots of each product and check near/far transitions, borders, animation, and full ride/stop/wrap behavior separately. A successful build is not a fidelity test.

## Application findings

The rendering path is React → `bootApp` → WebGL2 PlayCanvas → opaque meshes and Gaussian splats → scene-color grab and mip generation → impaired-vision fullscreen blur → lens meshes. Glasses additionally request a scene-depth grab. React owns interaction controls; it does not update the scene on every frame. This makes React/library-wide upgrades a weaker first hypothesis than rendering work.

The shipped engine is 2.21.4. The application explicitly requests WebGL2, despite the engine offering WebGPU. WebGL splat sorting runs in a worker; describing it as a GPU sort in existing comments is inaccurate. PlayCanvas's GPU-sorted renderer runs on WebGPU and avoids that worker round trip. [2]

The impaired overlay uses eight prefiltered disk taps on touch. Each blurred lens pixel performs color and depth samples to avoid drawing nearby phone content into blurred background. The overlay is overwritten inside fully opaque lens pixels, suggesting avoidable overdraw, but skipping it safely must preserve lens outlines, entrance animation, and arbitrary camera angles. Reducing tap count or removing depth rejection would change the image and is excluded.

The runtime already disables antialiasing and limits mobile DPR to 1. PlayCanvas recommends those controls for splat performance; this project has already taken that tradeoff, and further reduction would violate the present constraint. [3] The README's iOS-specific 200k budget and pinned LOD description is stale: the current source uses the shared touch budget and distance selection.

## Current versions and compatibility

Verified against GitHub releases and the npm registry on 12 September 2026:

| Package | Starting version | Latest stable observed | Performance relevance |
| --- | --- | --- | --- |
| PlayCanvas | 2.21.4 | 2.22.2 | Direct renderer, depth, culling, LOD changes |
| React / React DOM | 19.2.8 | 19.3.0 | UI; no demonstrated per-frame bottleneck |
| Vite | 8.2.1 | 8.3.0 | Build/development tooling, not steady-state GPU work |
| React Router | 7.18.2 | 7.18.3 | Navigation, not the rendering loop |
| Lucide React | 1.31.0 | 1.45.0 | Static UI icons |
| Biome | 2.5.8 | 2.5.13 | Development checks |

PlayCanvas 2.22.0 changes frustum representation and removes old wire drawing APIs; the app uses neither. It also changes scene-texture production, supports splat scene depth, and introduces error-driven LOD selection. These changes require image and workload comparison even when type-checking passes. In installed 2.22.2 source, distance LOD remains the default and `sceneDepthWrite` defaults to false. The 2.22.1 patch specifically addresses empty coarse LOD nodes and the distance default. [4][5]

The published renderer documentation still says splats do not write depth, while the newer release notes describe optional splat depth writes. Versioned source and actual runtime values resolve this discrepancy; the lens model must continue to treat the street as far depth. [2][4][6]

## Ranked hypotheses

1. **GPU sorting:** if CPU sorting/projection and uploads dominate, enabling the engine's WebGPU renderer at identical scene settings should reduce frame/GPU time. PlayCanvas reports about 2× FPS in its iPhone 13 Pro Max benchmark at 1–4 million splats. This is vendor evidence on a different workload, not an expected result for this 500k-budget app. [7]
2. **Redundant fragment work:** if overdraw dominates, avoiding calculations that are subsequently overwritten should reduce GPU time with unchanged pixels. Any mask must track actual lens geometry, including motion; approximate screen rectangles are insufficient.
3. **Engine update:** if current renderer overhead contributes materially, 2.22.2 should improve the fixed workload without changing LOD counts or lens output. Keep only with supporting measurements and fidelity checks.
4. **Constant shader arithmetic:** if the driver does not fold the disk sample offsets, precomputing the same constants may reduce shader work. This is likely a small improvement and may be a compiler no-op.

## WebGPU feasibility

Safari 26 introduced WebGPU, and Chrome enables it on supported Android 12+ devices. Feature detection and WebGL fallback remain necessary. [8][9] PlayCanvas supports translating custom GLSL via glslang/twgsl, or using native WGSL. The current custom shaders provide GLSL only, so merely changing `deviceTypes` is incomplete: shader compilation, coordinate conventions, depth decoding, and texture orientation must also work. [10]

Loading shader-translator WASM adds startup work and bytes. A renderer experiment must measure this cost before retaining that route. Native WGSL avoids runtime translation but requires keeping two shader implementations equivalent. Neither path should be accepted solely because a blank/broken scene renders faster.

WebGL guidance recommends avoiding synchronization and unnecessary transfers. The benchmark therefore uses asynchronous engine GPU queries and does not call `gl.finish()` to inflate apparent certainty. CPU throttling in desktop emulation does not emulate a phone GPU, bandwidth, or thermal behavior. [11]

## Evidence and remaining verification

The first pilot confirmed that Chrome 153 on an Apple M4 Max reaches roughly 60 FPS at the target mobile viewport. It also exposed benchmark issues: production engine CPU statistics were not valid elapsed durations, and the off-state fade was frozen too early. Those pilot CPU numbers and images must not be used for acceptance. The runner was corrected before establishing the comparable baseline.

A paired iPhone 16 Pro Max running iOS 26.6.2 is discoverable. Remote inspection currently returns no inspectable tabs. Physical-device measurements remain required; desktop results cannot establish the requested mobile improvement or thermal stability.

WebGPU experiments exposed two compatibility failures. First, raw GLSL `in`/`out` declarations and `textureLod` bypass the engine's GLSL-to-WGSL binding macros; use the documented `attribute`/`varying` and `texture2DLod` forms. Second, the engine's GLSL depth helper samples implicitly inside the lens's non-uniform blur branch, which WGSL validation rejects. Depth has no mip chain, so an explicit level-zero sample preserves its semantics. The failed render produced blank frames and thousands of nominal callbacks per second with zero GPU timings; all such results are rejected. The benchmark now checks GPU validation warnings as well as JavaScript/console errors, and image comparison remains mandatory.

## Candidate implementation

The candidate requests WebGPU on touch devices, with the existing WebGL2 fallback, and keeps desktop on WebGL2. Native WGSL implements the existing lens and impaired-vision shaders with eight identical golden-angle taps, unchanged mip selection, depth rejection, focus curves, soft zones, and dotted traces. Screen-space Y is reversed for the disk offsets to preserve the GLSL sampling positions. No runtime shader translator downloads or package upgrades are required. The existing engine's native depth helper uses `textureLoad`, avoiding the failed implicit-derivative path. [13]

A framebuffer comparison caught a renderer mismatch that successful compilation did not: the scene camera has a baked scale of 0.3. The mesh renderer constructs a rigid view, whereas WebGPU splat projection inverts the complete camera transform. That made distant splat fog roughly three times stronger. On WebGPU, normalizing the camera scale and moving the original 0.3 scale to a glasses parent preserves lens geometry and restores background depth. WebGL keeps its original camera scale; the additional glasses parent has unit scale there. The first corrected fixed-pose capture has mean absolute RGB error 0.091 on a 0–255 scale, with 99.81% of pixels within two channel levels of the original. Cross-renderer rasterization still produces isolated edge differences; this is evidence of close matching, not pixel identity at every pose.

The initial valid uncapped MySense screening measured 627 callbacks/sec for the original WebGL2 build and approximately 1,001 for native WebGPU. These are headless Chrome throughput measurements with `--disable-frame-rate-limit`, not frames presented on a phone display. The corrected camera candidate's first full run measured 1,011 / 995 / 971 / 857 callbacks/sec for off / MySense / Balansis / MySelf Profile, with no browser or GPU validation errors. Repeat comparisons and normal frame-pacing checks are required before interpreting this as an improvement.

## Paired desktop screening results

Original and candidate production builds, Chrome 153 / Apple M4 Max, 852 × 393 framebuffer, unchanged 500,000 splat budget, 30 seconds per state, refresh limiter disabled:

| State | Original callbacks/sec | Candidate callbacks/sec | Change | GPU-time reduction |
| --- | ---: | ---: | ---: | ---: |
| Glasses off | 648.3 | 1,010.8 | +55.9% | 44.7% |
| MySense | 645.6 | 994.5 | +54.0% | 43.9% |
| Balansis | 649.9 | 971.3 | +49.5% | 41.2% |
| MySelf Profile | 647.8 | 857.5 | +32.4% | 34.0% |

This is one full paired screening run. It does not satisfy the three-repeat protocol or prove +50% across products. Runs with the browser's normal limiter reached approximately 30 FPS in the unchanged original as well as preliminary candidate runs, despite much shorter GPU execution times. Earlier 60 FPS and later 30 FPS samples are therefore not a valid before/after comparison. Uncapped callback rates expose spare throughput but are not display FPS.

All three lens captures at the fixed pose had mean absolute RGB error below 0.10/255 and fewer than 0.20% of pixels differing by more than two channel levels. The initial off capture retained a faint animated DOM button because animation overrides ordinary inline opacity; its difference score is invalid. Capture hiding now uses important opacity, and the separate smoke check recaptures this state. Timing occurs before hiding controls.

Use `PERF_REFERENCE=artifacts/perf/<label>/results.json` to rerun exactly the same preserved build. `PERF_BACKEND=webgpu` asserts WebGPU selection. `PERF_FORCE_WEBGL=1` removes the browser's WebGPU capability only in the test page to exercise fallback. Set `PERF_UNCAPPED=1` only for throughput screening, and record it with results. Stage source files before building so the recorded `git diff HEAD` includes newly added shaders.

`scripts/perf-smoke.mjs <results.json> <label>` checks fixed-angle and traced lens captures, the actual ride listeners with fixed timesteps, traffic stop/wrap, lens teardown/re-entry, pointer look, and portrait remount. It does not simulate a physical gyroscope or certify Safari/Android GPU behavior. Compare its captures with `python3 scripts/perf-diff.py <baseline-directory> <candidate-directory>` (Pillow required).

## Regression checks and limits

The original, native-WebGPU and final WebGL-fallback smoke runs pass lens removal/re-entry, pointer look, portrait remount, and traffic stop/wrap. Final fallback captures (MySense, off, left, right and trace) are pixel-identical to the original; fallback lens matrices and ride positions are exactly equal. Their 7,200 fixed-step ride positions are exactly equal; lens world matrices differ by at most 7.5 × 10⁻⁹, consistent with floating-point transform multiplication.

Additional captures cover leftward/downward and rightward/upward looks plus the dotted lens trace. Mean absolute RGB errors are 0.081, 0.228, and 0.098 respectively. The rightward view contains the largest difference: 2.20% of pixels exceed two channel levels, primarily in detailed distant vegetation and building edges. The images look closely matched in desktop inspection, but they are not bit-identical and require physical-device review. The corrected off-state capture has error 0.060 and only 0.034% of pixels above two levels. These bounds describe sampled poses only.

The contemporary normally paced MySense pair measured 30.10 FPS on WebGL2 and 30.03 FPS on WebGPU; mean GPU times were 5.19 and 4.58 ms. This pair establishes no presented-FPS gain on this machine. Browser scheduling, power state and phone thermals need control in the final device evaluation.

The candidate is an experimental branch, not a validated production rollout. Physical iPhone and Android measurements, gyroscope checks, thermal soak and repeated all-product runs remain open in local task `hoya-1`. The paired iPhone was reported unavailable by `devicectl` during the final checks. No quality reduction, asset change, dependency update, or public deployment is part of this experiment.

A later repeat was aborted after the host load average reached 81.27 (five-minute 37.59), while ordinary shell checks also slowed substantially. Its MySense result of 549.5 callbacks/sec is excluded from the comparison; the subsequent baseline was not run. This reinforces why the first table remains provisional and why a controlled physical-device evaluation is the next useful step. The initial screenshot timeout and interrupted repeat are retained in the experiment ledger rather than counted as successes.

Final quality gates: production build, complete Biome lint and diff whitespace checks pass. Build reports the existing large-chunk/config warnings. Beads follow-up is persisted in local JSONL; this installed Beads version's sync command rejects JSONL-only mode even with `--no-db`, so source/report synchronization uses Git directly.

## Sources

1. Andrej Karpathy, [autoresearch experiment program](https://github.com/karpathy/autoresearch/blob/master/program.md), accessed 12 September 2026.
2. PlayCanvas, [Gaussian splat renderers](https://developer.playcanvas.com/user-manual/gaussian-splatting/rendering-architecture/renderers/), accessed 12 September 2026.
3. PlayCanvas, [`pc-gsplat` performance guidance](https://developer.playcanvas.com/user-manual/web-components/tags/pc-gsplat/), accessed 12 September 2026.
4. PlayCanvas, [2.22.0 release notes](https://github.com/playcanvas/engine/releases/tag/v2.22.0), 4 September 2026.
5. PlayCanvas, [engine releases](https://github.com/playcanvas/engine/releases), including 2.22.1 (8 September) and 2.22.2 (11 September 2026).
6. PlayCanvas, [Gaussian splats write scene depth, PR 9175](https://github.com/playcanvas/engine/pull/9175), merged 14 August 2026.
7. Will Eastcott, PlayCanvas, [WebGPU and streaming performance benchmarks](https://blog.playcanvas.com/new-in-supersplat-webgpu-and-streaming-bring-huge-performance-wins/), 3 June 2026.
8. WebKit, [WebKit features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/), 2025.
9. Chrome for Developers, [WebGPU in Chrome 121](https://developer.chrome.com/blog/new-in-webgpu-121), 2024.
10. PlayCanvas, [`createGraphicsDevice` API](https://api.playcanvas.com/engine/functions/createGraphicsDevice.html) and [GLSL requirements](https://developer.playcanvas.com/user-manual/graphics/shaders/glsl-specifics/), accessed 12 September 2026.
11. MDN, [WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices), accessed 12 September 2026.
12. npm registry, [PlayCanvas package metadata](https://registry.npmjs.org/playcanvas/latest); other version observations from `bun outdated`, 12 September 2026.

13. PlayCanvas, [WGSL shader requirements](https://developer.playcanvas.com/user-manual/graphics/shaders/wgsl-specifics/) and [vertex/fragment shaders](https://developer.playcanvas.com/user-manual/graphics/shaders/wgsl-vertex-fragment-shaders/), accessed 12 September 2026.
