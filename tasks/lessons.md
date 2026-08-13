# Lessons

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
