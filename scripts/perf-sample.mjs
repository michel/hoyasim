// Shared in-page workload for desktop screening and physical iPhone checks.
export async function sample({ product, seconds, profileGPU = true }) {
  const { app, lookState, pc } = window.__hoya
  const rig = app.root.findByName('waa')
  const pos = rig.getLocalPosition().clone()
  const device = app.graphicsDevice
  const timings = { update: 0, render: 0 }
  for (const method of ['update', 'render']) {
    const original = app[method]
    app[method] = function (...args) {
      const begin = performance.now()
      const result = original.apply(this, args)
      timings[method] = performance.now() - begin
      return result
    }
  }
  app.timeScale = 0
  // Same position at each elapsed time, independent of achieved frame rate.
  const start = performance.now()
  const move = () => {
    const t = (performance.now() - start) / 1000
    rig.setLocalPosition(pos.x, pos.y, 11 - ((t * 1.44) % 35.2))
    lookState.lon = Math.sin(t * 0.4) * 35
    lookState.lat = -29.5 + Math.sin(t * 0.27) * 20
  }
  app.on('update', move)
  if (device.gpuProfiler) device.gpuProfiler.enabled = profileGPU
  const frames = [],
    gpu = [],
    cpu = [],
    splats = [],
    draws = []
  let last = performance.now()
  let hidden = false
  await new Promise((resolve) => {
    const sample = () => {
      const now = performance.now()
      hidden ||= document.visibilityState !== 'visible'
      frames.push(now - last)
      last = now
      const timing = device.gpuProfiler?._frameTime
      if (timing > 0) gpu.push(timing)
      cpu.push(timings.update + timings.render)
      splats.push(app.stats.frame.gsplats)
      draws.push(app.stats.drawCalls.total)
      if (now - start >= seconds * 1000) {
        app.off('frameend', sample)
        resolve()
      }
    }
    app.on('frameend', sample)
  })
  app.off('update', move)
  const summary = (values) => {
    const ordered = [...values].sort((a, b) => a - b)
    return {
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      median: ordered[Math.floor(ordered.length / 2)],
      p95: ordered[Math.floor(ordered.length * 0.95)],
    }
  }
  // Fixed capture pose; allow sorting/streaming to settle after returning.
  rig.setLocalPosition(pos.x, pos.y, 11)
  lookState.lon = 0
  lookState.lat = -29.5
  return {
    product,
    version: pc.version,
    userAgent: navigator.userAgent,
    renderer: device.unmaskedRenderer,
    backend: device.deviceType,
    resolution: [device.width, device.height],
    pixelRatio: device.maxPixelRatio,
    budget: app.scene.gsplat.splatBudget,
    hidden,
    frames,
    fps: 1000 / summary(frames).mean,
    frameMs: summary(frames),
    gpuMs: gpu.length ? summary(gpu) : null,
    gpuPasses: Object.fromEntries(device.gpuProfiler?.passTimings ?? []),
    cpuMs: summary(cpu),
    splats: summary(splats),
    draws: summary(draws),
  }
}
