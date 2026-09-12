// Production-build fidelity and lifecycle checks. Pass a perf result JSON and label.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { preview } from 'vite'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const reference = JSON.parse(await readFile(process.argv[2], 'utf8'))
const output = `artifacts/perf/${process.argv[3]}`
await mkdir(output, { recursive: true })
const server = await preview({
  build: { outDir: reference.outDir },
  preview: { port: 4174, strictPort: true },
})
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
try {
  const page = await browser.newPage({
    viewport: { width: 852, height: 393 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  })
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.location().url.endsWith('/favicon.ico')) return
    if (
      m.type() === 'error' ||
      (m.type() === 'warning' &&
        /error:|Invalid (Shader|Render|Command)/.test(m.text()))
    )
      errors.push(m.text())
  })
  await page.addInitScript((force) => {
    delete DeviceOrientationEvent.requestPermission
    if (force) Object.defineProperty(navigator, 'gpu', { value: undefined })
  }, process.env.PERF_FORCE_WEBGL === '1')
  await page.goto('http://localhost:4174/hoyasim/scenes/1')
  await page.waitForFunction(() => window.__hoya?.app.frame > 5)
  await page.waitForTimeout(2000)
  const state = await page.evaluate(() => {
    const { app } = window.__hoya
    app.timeScale = 0
    const rig = app.root.findByName('waa')
    rig.setLocalPosition(0, 0.05, 11)
    // Exercise the actual registered ride/traffic listeners with fixed timesteps.
    const ride = []
    for (let i = 0; i < 7200; i++) {
      app.fire('update', 1 / 60)
      ride.push(rig.getLocalPosition().z)
    }
    rig.setLocalPosition(0, 0.05, 11)
    return { backend: app.graphicsDevice.deviceType, ride }
  })
  await page.evaluate(() => {
    const canvas = document.getElementById('application-canvas')
    for (const sibling of canvas.parentElement.children)
      if (sibling !== canvas)
        sibling.style.setProperty('opacity', '0', 'important')
  })
  await page.waitForTimeout(6000)
  await page
    .locator('canvas')
    .screenshot({ path: `${output}/off.png`, scale: 'css' })
  await page.evaluate(() => {
    const canvas = document.getElementById('application-canvas')
    for (const sibling of canvas.parentElement.children)
      sibling.style.opacity = ''
  })
  assert.equal(state.backend, process.env.PERF_BACKEND || 'webgl2')
  assert(
    state.ride.some((z, i, a) => i > 0 && z === a[i - 1]),
    'Traffic stop missing',
  )
  assert(
    state.ride.some((z, i, a) => i > 0 && z - a[i - 1] > 30),
    'Ride wrap missing',
  )
  await page.evaluate(() => {
    window.__hoya.app.timeScale = 1
  })
  await page.getByRole('button', { name: 'Experience HOYA vision' }).click()
  await page.getByRole('button', { name: /Swap lenses/ }).waitFor()
  await page.waitForTimeout(2000)
  await page.evaluate(() => {
    window.__hoya.app.timeScale = 0
  })
  const transforms = await page.evaluate(() => {
    window.__hoya.app.root.findByName('waa').setLocalPosition(0, 0.05, 11)
    return ['GlassesLeft', 'GlassesRight'].map((name) =>
      Array.from(
        window.__hoya.app.root.findByName(name).getWorldTransform().data,
      ),
    )
  })
  for (const [name, lon, lat, trace] of [
    ['left', -35, -40, 0],
    ['right', 35, -10, 0],
    ['trace', 0, -29.5, 1],
  ]) {
    await page.evaluate(
      ({ lon, lat, trace }) => {
        const { app, lookState } = window.__hoya
        app.root.findByName('waa').setLocalPosition(0, 0.05, 11)
        lookState.lon = lon
        lookState.lat = lat
        for (const side of ['GlassesLeft', 'GlassesRight']) {
          for (const render of app.root
            .findByName(side)
            .findComponents('render')) {
            for (const mesh of render.meshInstances) {
              if (mesh.material.getParameter('uLineTrace')) {
                mesh.material.setParameter('uLineTrace', 1)
                mesh.material.setParameter('uLineFade', trace)
              }
            }
          }
        }
        const canvas = document.getElementById('application-canvas')
        for (const sibling of canvas.parentElement.children)
          if (sibling !== canvas)
            sibling.style.setProperty('opacity', '0', 'important')
      },
      { lon, lat, trace },
    )
    await page.waitForTimeout(6000)
    await page
      .locator('canvas')
      .screenshot({ path: `${output}/${name}.png`, scale: 'css' })
  }
  await page.evaluate(() => {
    const canvas = document.getElementById('application-canvas')
    for (const sibling of canvas.parentElement.children)
      sibling.style.opacity = ''
  })
  await page.getByRole('button', { name: 'Take off glasses' }).click()
  assert(
    await page.evaluate(
      () =>
        !window.__hoya.app.root.findByName('GlassesLeft') &&
        !window.__hoya.app.root.findByName('GlassesMount'),
    ),
  )
  await page.evaluate(() => {
    window.__hoya.app.timeScale = 1
  })
  await page.getByRole('button', { name: 'Experience HOYA vision' }).click()
  await page.getByRole('button', { name: /Swap lenses/ }).waitFor()
  const lon = await page.evaluate(() => window.__hoya.lookState.lon)
  await page.mouse.move(400, 130)
  await page.mouse.down()
  await page.mouse.move(450, 140)
  await page.mouse.up()
  assert.notEqual(
    await page.evaluate(() => window.__hoya.lookState.lon),
    lon,
    'Pointer look did not respond',
  )
  await page.setViewportSize({ width: 393, height: 852 })
  await page.getByRole('heading', { name: 'Rotate your device' }).waitFor()
  assert.equal(await page.locator('canvas').count(), 0)
  await page.setViewportSize({ width: 852, height: 393 })
  await page.waitForFunction(
    () => window.__hoya?.app.frame > 5 && document.querySelector('canvas'),
  )
  await page.getByRole('button', { name: 'Experience HOYA vision' }).waitFor()
  await page.waitForTimeout(2000)
  assert.deepEqual(errors, [])
  await writeFile(
    `${output}/checks.json`,
    JSON.stringify({ ...state, transforms, errors }, null, 2),
  )
  console.log(
    `${output}: ride, stop, wrap, lens teardown/re-entry, pointer look, portrait remount passed`,
  )
} finally {
  await browser.close()
  await new Promise((resolve) => server.httpServer.close(resolve))
}
