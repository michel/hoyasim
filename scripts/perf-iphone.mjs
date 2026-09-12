// Physical Safari via pymobiledevice3's CDP bridge. No viewport/refresh emulation.
// node scripts/perf-iphone.mjs <https-url> <label> <webgl2|webgpu>
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { sample } from './perf-sample.mjs'

const [url, label, backend] = process.argv.slice(2)
assert.equal(new URL(url).protocol, 'https:')
assert.match(label, /^[a-zA-Z0-9_-]+$/)
assert(['webgl2', 'webgpu'].includes(backend))
const output = `artifacts/perf/${label}`
await mkdir(output, { recursive: true })
const pages = await (await fetch('http://127.0.0.1:9224/json/list')).json()
// Attach only to the temporary test tab opened for this task.
const page = pages.find((p) => p.url.includes('.trycloudflare.com/hoyasim/'))
assert(page, 'Open the test URL in Safari first')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})
let id = 0
const pending = new Map()
const errors = []
const results = []
ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id) {
    const callback = pending.get(message.id)
    if (!callback) return
    pending.delete(message.id)
    if (message.error) callback.reject(new Error(JSON.stringify(message.error)))
    else callback.resolve(message.result)
  } else if (message.method === 'Runtime.exceptionThrown') {
    errors.push(JSON.stringify(message.params))
  } else if (message.method === 'Runtime.consoleAPICalled') {
    const { type, args = [] } = message.params
    const text = args.map((a) => a.value ?? a.description ?? '').join(' ')
    if (
      type === 'error' ||
      (type === 'warning' &&
        /error:|Invalid (Shader|Render|Command)/.test(text))
    )
      errors.push(text)
  }
}
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error(`${method} timed out`))
    }, 90000)
    pending.set(requestId, {
      resolve: (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      },
    })
    ws.send(JSON.stringify({ id: requestId, method, params }))
  })
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  })
  if (response.exceptionDetails || response.wasThrown)
    throw new Error(JSON.stringify(response))
  return response.result?.value
}
async function waitFor(expression, seconds = 60) {
  for (let i = 0; i < seconds; i++) {
    if (await evaluate(expression)) return
    await delay(1000)
  }
  throw new Error(`Waiting for ${expression} timed out`)
}
async function save() {
  const reference = process.env.PERF_REFERENCE
    ? JSON.parse(await readFile(process.env.PERF_REFERENCE, 'utf8'))
    : null
  await writeFile(
    `${output}/results.json`,
    JSON.stringify(
      {
        label,
        date: new Date().toISOString(),
        url,
        device: 'iPhone 16 Pro Max, iOS 26.6.2',
        physical: true,
        uncapped: false,
        gpuProfiling: false,
        build: reference && {
          outDir: reference.outDir,
          commit: reference.commit,
          diff: reference.diff,
        },
        errors,
        results,
      },
      null,
      2,
    ),
  )
}
try {
  await send('Runtime.enable')
  await send('Page.enable')
  for (const product of (
    process.env.PERF_PRODUCTS || 'off,MySense,Balansis,MySelf Profile'
  ).split(',')) {
    assert(['off', 'MySense', 'Balansis', 'MySelf Profile'].includes(product))
    await send('Page.navigate', { url })
    await waitFor('window.__hoya?.app.frame > 5 && innerWidth > innerHeight')
    await delay(2000)
    // Deterministic camera replay: bypass the motion prompt in this test page only.
    // Do not request/change iOS sensor permissions or device settings.
    await evaluate(`(() => {
      DeviceOrientationEvent.requestPermission = async () => 'granted';
      [...document.querySelectorAll('button')].find(b => b.textContent.includes('Enable Motion'))?.click();
      const {app, lookState} = window.__hoya;
      app.timeScale = 0;
      lookState.gyroActive = false;
      app.on('update', () => { lookState.gyroActive = false });
    })()`)
    await delay(12000)
    if (product !== 'off') {
      await evaluate(`(() => {
        window.__hoya.app.timeScale = 1;
        [...document.querySelectorAll('button')].find(b => b.textContent.includes('Experience'))?.click();
      })()`)
      await waitFor(
        `!!document.querySelector('button[aria-label^="Swap lenses"]')`,
      )
      for (
        let i = 0;
        i < ['MySense', 'Balansis', 'MySelf Profile'].indexOf(product);
        i++
      ) {
        await evaluate(
          `document.querySelector('button[aria-label^="Swap lenses"]').click()`,
        )
        await delay(100)
      }
      await delay(4000)
    }
    const seconds = Number(process.env.PERF_SECONDS || 30)
    // The bridge doesn't implement CDP awaitPromise. Collect on-device and
    // retrieve only after sampling ends, with no inspector traffic during timing.
    await evaluate(`window.__phoneResult = null; window.__phoneError = null;
      (${sample.toString()})(${JSON.stringify({ product, seconds, profileGPU: false })})
        .then(r => window.__phoneResult = r)
        .catch(e => window.__phoneError = String(e)); true`)
    await delay((seconds + 1) * 1000)
    await waitFor(
      'window.__phoneResult !== null || window.__phoneError !== null',
      20,
    )
    assert.equal(await evaluate('window.__phoneError'), null)
    const result = await evaluate('window.__phoneResult')
    assert(result, 'No measurement returned')
    assert.equal(result.backend, backend)
    assert.equal(result.hidden, false)
    assert.equal(result.pixelRatio, 1)
    assert.equal(result.budget, 500000)
    assert(result.splats.mean > 0)
    const viewport = await evaluate(
      '({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,secure:isSecureContext})',
    )
    assert.equal(viewport.secure, true)
    assert.deepEqual(result.resolution, [viewport.width, viewport.height])
    assert.deepEqual(errors, [])
    results.push({ ...result, viewport })
    await save()
    console.log(
      JSON.stringify({
        ...result,
        frames: undefined,
        gpuPasses: undefined,
        viewport,
      }),
    )
    await delay(6000)
    const clip = await evaluate(`(() => {
      const canvas = document.getElementById('application-canvas');
      for(const sibling of canvas.parentElement.children) {
        if(sibling === canvas) continue;
        sibling.style.setProperty('transition','none','important');
        sibling.style.setProperty('animation','none','important');
        sibling.style.setProperty('opacity','0','important');
      }
      const r=canvas.getBoundingClientRect();
      return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1};
    })()`)
    // snapshotRect can otherwise capture the compositor before the DOM update.
    await delay(500)
    const screenshot = await send('Page.captureScreenshot', {
      format: 'png',
      clip,
    })
    await writeFile(
      `${output}/${product}.png`,
      Buffer.from(screenshot.data, 'base64'),
    )
  }
} catch (error) {
  errors.push(String(error))
  throw error
} finally {
  await save()
  ws.close()
}
