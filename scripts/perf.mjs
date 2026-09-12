// Production-build benchmark. Instrumentation exists only in this temporary build.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/perf.mjs <label>
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build, preview } from 'vite'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const label = process.argv[2] || 'baseline'
assert.match(label, /^[a-zA-Z0-9_-]+$/)
const output = path.resolve('artifacts/perf', label)
const reference = process.env.PERF_REFERENCE
  ? JSON.parse(await readFile(process.env.PERF_REFERENCE, 'utf8'))
  : null
const revision = reference
  ? { commit: reference.commit, diff: reference.diff }
  : {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      diff: execFileSync('git', ['diff', 'HEAD'], { encoding: 'utf8' }),
    }
await mkdir(output, { recursive: true })
const outDir =
  reference?.outDir ?? (await mkdtemp(path.join(tmpdir(), 'hoya-perf-')))
if (!reference)
  await build({
    logLevel: 'error',
    build: { outDir, emptyOutDir: true },
    plugins: [
      {
        name: 'benchmark-access',
        enforce: 'pre',
        transform(code, id) {
          if (!id.endsWith('/src/lib/playcanvasApp.ts')) return
          return code.replace(
            'const cameraEntity = setupScene(app)',
            'const cameraEntity = setupScene(app); window.__hoya = { app, lookState, pc };',
          )
        },
      },
    ],
  })
const server = await preview({
  build: { outDir },
  preview: { port: 4174, strictPort: true },
})
const uncapped = process.env.PERF_UNCAPPED === '1'
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: uncapped ? ['--disable-frame-rate-limit'] : [],
})
const errors = []
const results = []
try {
  for (const product of (
    process.env.PERF_PRODUCTS || 'off,MySense,Balansis,MySelf Profile'
  ).split(',')) {
    assert(['off', 'MySense', 'Balansis', 'MySelf Profile'].includes(product))
    const page = await browser.newPage({
      viewport: { width: 852, height: 393 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    })
    await page.route('**/favicon.ico', (route) =>
      route.fulfill({ status: 204 }),
    )
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      // Chrome requests this outside page routing; the app has no favicon.
      if (message.location().url === 'http://localhost:4174/favicon.ico') return
      if (
        message.type() === 'error' ||
        (message.type() === 'warning' &&
          /error:|Invalid (Shader|Render|Command)/.test(message.text()))
      )
        errors.push(`${message.location().url}: ${message.text()}`)
    })
    // Emulated touch has no sensor. Bypass only the permission prompt in the test browser.
    await page.addInitScript(() => {
      delete DeviceOrientationEvent.requestPermission
    })
    if (process.env.PERF_FORCE_WEBGL === '1')
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'gpu', { value: undefined })
      })
    await page.goto('http://localhost:4174/hoyasim/scenes/1')
    await page.waitForFunction(() => window.__hoya?.app.frame > 5)
    const readyMs = await page.evaluate(() => performance.now())
    await page.waitForTimeout(2000)
    await page.evaluate(() => {
      window.__hoya.app.timeScale = 0
    })
    await page.waitForTimeout(12000)
    if (product !== 'off') {
      await page.evaluate(() => {
        window.__hoya.app.timeScale = 1
      })
      await page.getByRole('button', { name: 'Experience HOYA vision' }).click()
      const selector = page.getByRole('button', { name: /Swap lenses/ })
      await selector.waitFor()
      for (
        let i = 0;
        i < ['MySense', 'Balansis', 'MySelf Profile'].indexOf(product);
        i++
      )
        await selector.click()
      await page.waitForTimeout(4000)
    }
    const result = await page.evaluate(
      async ({ product, seconds }) => {
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
        if (device.gpuProfiler) device.gpuProfiler.enabled = true
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
      },
      { product, seconds: Number(process.env.PERF_SECONDS || 30) },
    )
    assert.equal(result.hidden, false, 'Hidden tab invalidates measurement')
    assert.equal(
      result.backend,
      process.env.PERF_BACKEND || 'webgl2',
      'Unexpected renderer or fallback',
    )
    assert.deepEqual(result.resolution, [852, 393])
    assert.equal(result.budget, 500000)
    assert(
      result.splats.mean > 0,
      'Missing splat scene invalidates measurement',
    )
    assert.deepEqual(errors, [])
    await page.waitForTimeout(6000)
    // Capture the displayed surface. Hide DOM controls only after timing.
    await page.evaluate(() => {
      const canvas = document.getElementById('application-canvas')
      for (const sibling of canvas.parentElement.children)
        if (sibling !== canvas)
          sibling.style.setProperty('opacity', '0', 'important')
    })
    results.push({ ...result, readyMs })
    console.log(JSON.stringify({ ...result, frames: undefined }))
    // Uncapped RAF can starve Playwright's element-stability heuristic.
    // Capture the canvas bounds directly after the fixed-pose settling period.
    await page.screenshot({
      path: path.join(output, `${product}.png`),
      scale: 'css',
      clip: await page.locator('canvas').boundingBox(),
    })
    await page.close()
  }
  assert.deepEqual(errors, [])
} catch (error) {
  errors.push(String(error))
  throw error
} finally {
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify(
      {
        label,
        outDir,
        uncapped,
        date: new Date().toISOString(),
        ...revision,
        errors,
        results,
      },
      null,
      2,
    ),
  )
  await browser.close()
  await new Promise((resolve) => server.httpServer.close(resolve))
}
