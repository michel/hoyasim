import * as pc from 'playcanvas'

// The phones' screen texture. The GLB ships a Google Maps screenshot whose
// labels can never be legible at the size the phone gets on screen, and the
// whole point of the demo is reading through the lens — so draw a navigation
// screen with big type instead: straight-ahead instruction (the ride is one
// straight street), distance, then ETA, over a map that mirrors the scene.
// Same 945x2048 texture space as the shipped screenshot; the phone mesh only
// shows the SCREEN window of it (measured with a labelled grid: u 0.17..0.83,
// v 0.15..0.83), so everything is laid out inside that.
const WIDTH = 945
const HEIGHT = 2048
const SCREEN = { x: 158, y: 307, w: 630, h: 1393 }
const BLUE = '#1a56db'
const INK = '#111827'
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif'

type Ctx = CanvasRenderingContext2D

function line(ctx: Ctx, pts: number[][], width: number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y)
  ctx.stroke()
}

function label(ctx: Ctx, text: string, x: number, y: number, angle = 0) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.fillStyle = '#4b5563'
  ctx.font = `600 26px ${FONT}`
  ctx.fillText(text, 0, 0)
  ctx.restore()
}

// Draws text at the requested size, shrinking it until it fits maxWidth — the
// screen window is only 630 texels wide and nothing may clip.
function fitText(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  px: number,
  weight = 'bold',
) {
  let size = px
  ctx.font = `${weight} ${size}px ${FONT}`
  while (size > 8 && ctx.measureText(text).width > maxWidth) {
    size -= 2
    ctx.font = `${weight} ${size}px ${FONT}`
  }
  ctx.fillText(text, x, y)
}

function drawStraightArrow(ctx: Ctx, x: number, y: number) {
  line(
    ctx,
    [
      [x, y + 190],
      [x, y + 40],
    ],
    34,
    '#fff',
  )
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.moveTo(x, y - 40)
  ctx.lineTo(x - 80, y + 60)
  ctx.lineTo(x + 80, y + 60)
  ctx.closePath()
  ctx.fill()
}

// The map mirrors the ride: our street runs straight up the middle with
// housing blocks either side, cross streets (the crossing with the lights
// sits about a third of the way), and the route goes straight on.
function drawMap(ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = '#e9ecef'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#dfe3e8'
  for (const [x, y, bw, bh] of [
    [0.06, 0.08, 0.3, 0.2],
    [0.64, 0.08, 0.3, 0.2],
    [0.06, 0.4, 0.3, 0.22],
    [0.64, 0.4, 0.3, 0.22],
    [0.06, 0.74, 0.3, 0.22],
    [0.64, 0.74, 0.3, 0.22],
  ])
    ctx.fillRect(x * w, y * h, bw * w, bh * h)
  ctx.fillStyle = '#c8e6c9'
  ctx.fillRect(w * 0.64, h * 0.4, w * 0.3, h * 0.22)
  const cross: [number, string][] = [
    [0.33, 'Groenestraat'],
    [0.68, 'St. Annastraat'],
  ]
  const main = [
    [w * 0.5, 0],
    [w * 0.5, h],
  ]
  // Casing first, then the lighter core, main street a step wider than the
  // cross streets.
  const strokeStreets = (width: number, color: string) => {
    for (const [y] of cross)
      line(
        ctx,
        [
          [0, y * h],
          [w, y * h],
        ],
        width,
        color,
      )
    line(ctx, main, width + 20, color)
  }
  strokeStreets(34, '#cfd4da')
  strokeStreets(26, '#ffffff')
  for (const [y, name] of cross) label(ctx, name, w * 0.06, y * h - 26)
  label(ctx, 'Willemsweg', w * 0.5 + 40, h * 0.2, -Math.PI / 2)
  line(
    ctx,
    [
      [w * 0.5, h * 0.92],
      [w * 0.5, h * 0.04],
    ],
    30,
    BLUE,
  )
  ctx.fillStyle = '#ef4444'
  ctx.beginPath()
  ctx.arc(w * 0.5, h * 0.04, 22, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = BLUE
  ctx.beginPath()
  ctx.arc(w * 0.5, h * 0.92, 40, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(w * 0.5, h * 0.92, 18, 0, Math.PI * 2)
  ctx.fill()
}

function drawNavScreen(ctx: Ctx) {
  ctx.fillStyle = INK
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  ctx.translate(SCREEN.x, SCREEN.y)
  ctx.beginPath()
  ctx.rect(0, 0, SCREEN.w, SCREEN.h)
  ctx.clip()
  const { w, h } = SCREEN
  // The instruction dominates: on a phone the whole screen is ~100 CSS px
  // wide, so only full-width type has a chance of being read through the lens.
  const bannerH = Math.round(h * 0.42)
  const footerH = Math.round(h * 0.14)
  const pad = 30
  ctx.save()
  ctx.translate(0, bannerH)
  drawMap(ctx, w, h - bannerH - footerH)
  ctx.restore()
  ctx.fillStyle = BLUE
  ctx.fillRect(0, 0, w, bannerH)
  drawStraightArrow(ctx, w / 2, 70)
  ctx.fillStyle = '#fff'
  fitText(ctx, '800 m', pad, 470, w - 2 * pad, 260)
  fitText(ctx, 'Rechtdoor', pad, 565, w - 2 * pad, 110)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, h - footerH, w, footerH)
  ctx.fillStyle = '#15803d'
  fitText(ctx, '12 min', pad, h - footerH + 120, w - 2 * pad, 120)
  ctx.fillStyle = INK
  fitText(ctx, '3,4 km · 15:12', pad, h - 34, w - 2 * pad, 56, 'normal')
}

// Draws the screen into a canvas and wraps it as a mipmapped texture. Returns
// null where 2D canvas is unavailable, so the caller keeps the GLB texture.
export function createNavScreenTexture(device: pc.GraphicsDevice) {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  drawNavScreen(ctx)
  const texture = new pc.Texture(device, {
    name: 'nav-screen',
    width: WIDTH,
    height: HEIGHT,
    format: pc.PIXELFORMAT_RGBA8,
    mipmaps: true,
    addressU: pc.ADDRESS_CLAMP_TO_EDGE,
    addressV: pc.ADDRESS_CLAMP_TO_EDGE,
  })
  texture.setSource(canvas)
  return texture
}
