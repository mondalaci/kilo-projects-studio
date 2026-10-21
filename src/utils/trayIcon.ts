import type { ConversationState } from "./sessionState"

/**
 * Tray icon rendering.
 *
 * Trays have no numeric-badge API, so the badge is part of the bitmap: the Kilo
 * mark with a state dot in the corner, and the attention count drawn into the
 * dot. Drawing happens in the renderer (a canvas is right there) and the PNG is
 * handed to the main process through IPC.
 */

/**
 * Dot colour per state: the traffic light from the sidebar. The idle grey is a
 * light one on purpose — against a dark panel the muted grey the sidebar uses is
 * invisible at tray size.
 */
const DOT_COLOURS: Record<ConversationState, string> = {
  blocked: "#e5484d",
  working: "#f5a623",
  done: "#35c06a",
  idle: "#c2c2c2",
}

/**
 * The glyph is drawn monochrome, like the panel's own icons: a white "K" with a
 * hairline dark edge so it still reads on a light panel. The state is carried by
 * the dot, not by the glyph, so the badge stays a traffic light rather than a
 * coloured tile.
 */
const GLYPH_COLOUR = "#ffffff"
const GLYPH_EDGE = "rgba(0, 0, 0, 0.45)"
/**
 * Drawn at 64px. The panel slot is about 30 logical pixels, so on a 2× display
 * this maps close to one image pixel per device pixel and stays crisp, where a
 * 32px bitmap had to be upscaled and looked soft next to other apps' icons.
 */
const SIZE = 64

let cache = new Map<string, string>()

/**
 * A PNG data URL for the tray: the Kilo mark plus a state dot carrying `count`.
 * Results are cached per (state, count) since the panel is redrawn rarely.
 */
export function trayIconDataURL(state: ConversationState, count: number): string {
  const key = `${state}:${count}`
  const cached = cache.get(key)
  if (cached) return cached

  const canvas = document.createElement("canvas")
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext("2d")
  if (!ctx) return ""

  // Everything below is expressed as a fraction of SIZE, so the icon can be drawn
  // at any resolution without retuning.
  const badge = count > 0
  const offset = SIZE / 32

  // The Kilo glyph, monochrome, with room around it like the panel's own icons.
  // With a badge it shifts left so the dot never lands on the letter.
  const glyphSize = badge ? SIZE * 0.72 : SIZE * 0.82
  const centreX = badge ? SIZE * 0.42 : SIZE / 2
  const centreY = SIZE * 0.5

  ctx.font = `600 ${Math.round(glyphSize)}px system-ui, -apple-system, 'Segoe UI', Roboto, 'DejaVu Sans', sans-serif`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.lineJoin = "round"
  ctx.lineWidth = SIZE * 0.035
  ctx.strokeStyle = GLYPH_EDGE
  ctx.strokeText("K", centreX, centreY + glyphSize * 0.04)
  ctx.fillStyle = GLYPH_COLOUR
  ctx.fillText("K", centreX, centreY + glyphSize * 0.04)

  // The state dot, bottom right, ringed so it separates from the panel behind.
  // Two characters ("9+") need a wider dot, or the text overflows it.
  const radius = badge ? (count > 9 ? SIZE * 0.28 : SIZE * 0.22) : SIZE * 0.15
  const cx = SIZE - radius - offset / 2
  const cy = SIZE - radius - offset / 2

  ctx.beginPath()
  ctx.arc(cx, cy, radius + offset, 0, Math.PI * 2)
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)"
  ctx.fill()

  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fillStyle = DOT_COLOURS[state]
  ctx.fill()

  if (badge) {
    const text = count > 9 ? "9+" : String(count)
    ctx.fillStyle = "#ffffff"
    ctx.font = `700 ${Math.round(text.length > 1 ? SIZE * 0.24 : SIZE * 0.28)}px system-ui, -apple-system, 'Segoe UI', Roboto, 'DejaVu Sans', sans-serif`
    ctx.fillText(text, cx, cy + 0.5)
  }

  const url = canvas.toDataURL("image/png")
  cache.set(key, url)
  // The cache is keyed by state and count, so it stays tiny; bound it anyway.
  if (cache.size > 40) cache = new Map(cache)
  return url
}
