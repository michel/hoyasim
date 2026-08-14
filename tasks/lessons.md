# Lessons

## 2026-08-14 — mobile perf pass: two tuning knobs were silent no-ops

- **Read a knob back at runtime after setting it.** Two engine settings this
  app relied on were silently discarded: `app.scene.gsplat.lodRangeMin/Max`
  (deprecated warn-only stubs since pc 2.20 — the real property moved to the
  GSplatComponent) and `device.maxPixelRatio` (config.json ships
  `useDevicePixelRatio`, so `app.configure()` overwrites the cap with native
  DPR — phones rendered at ~36x the intended fill). Neither produced an error.
  After wiring any perf/tuning knob, inspect the live value in the running app
  (React fiber → `.app`, or CDP) before trusting it; when an API smells
  deprecated, grep `node_modules/playcanvas/build/playcanvas.dbg.mjs` for the
  actual setter body.
- **`app.configure()` applies config.json DURING boot and can stomp device
  state you set earlier.** Order-sensitive setup (pixel ratio, canvas
  fill/resolution) belongs after configure, not before.
- **Blur radii in framebuffer pixels change meaning when the framebuffer
  scale changes.** Capping maxPixelRatio made the 16px impaired blur cover ~6x
  more screen and turned it into visible echo-ghosting; scaling the radii by
  maxPixelRatio/devicePixelRatio (pc-utils `blurPixelScale`) preserved the
  designed look exactly.

## 2026-08-13 — splat swap (v03)

- **Point-cloud stats are not a ride-through.** Density profiles and top-down
  composites said the v03 tiling was seamless, but the first-person lap rode
  straight through a hedge at a T-junction. Always ride the full lap in the
  browser (stop, seam, wrap) before calling a splat swap done — the user should
  never be the one to discover "the bike is driving in the splat".
- **Background tabs freeze PlayCanvas.** rAF doesn't fire in hidden Chrome
  tabs: `app.frame` stays 0, LOD streaming never starts, and the scene looks
  "broken" (missing splat) when it's actually fine. Check
  `document.visibilityState` before diagnosing render bugs; use the
  chrome-devtools MCP (foreground pages) for visual tests.
- **Screenshots taken mid-stream lie.** Teleporting the rig outruns LOD
  streaming; wait several seconds after any teleport before judging visuals.
- **The loop length tracks the RIDEABLE road, not the content span.** Measure
  where the road ends on the riding line; crop the bundle there (`-B`) and wrap
  the lap at that edge (the pre-v03 scene did the same implicitly).

## 2026-08-14 — bike turned around after "no-op knob" cleanup

- **A `[0,0,0]` transform call on a scene-baked entity is a reset, not a
  no-op.** The ponytail audit deleted `setLocalEulerAngles(0,0,0)` on the bike
  anchor; the scene JSON bakes `[177, 0, 180]` there, so the call was
  load-bearing and the bike rendered turned around. Before deleting any
  "redundant" transform on an entity that comes from the PlayCanvas scene,
  check its baked transform in `public/playcanvas/2483428.json` first — and
  when a zero-reset must stay, comment WHY so the next audit doesn't re-delete it.
