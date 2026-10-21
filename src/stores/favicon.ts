import { computed, onScopeDispose, watch } from "vue"
import { useChat } from "./chat"

/**
 * Drives the tab favicon while an agent is working.
 *
 * The favicon animates as an indeterminate spinner for the whole time the
 * session is busy, then reverts to the static logo once the turn finishes.
 * Chrome does not animate SVG (or GIF) favicons, so we cycle pre-rendered
 * canvas frames instead.
 */

const SIZE = 64
const FRAME_COUNT = 12
const FRAME_MS = 80
const BRAND = "#c96442"

let frames: string[] | null = null
let originalHref: string | null = null
let timer: ReturnType<typeof setInterval> | null = null
let frameIndex = 0

function iconLink(): HTMLLinkElement | null {
  if (typeof document === "undefined") return null
  return document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function renderFrame(ctx: CanvasRenderingContext2D, index: number) {
  ctx.clearRect(0, 0, SIZE, SIZE)
  roundedRect(ctx, 0, 0, SIZE, SIZE, 15)
  ctx.fillStyle = BRAND
  ctx.fill()

  ctx.globalAlpha = 0.3
  ctx.fillStyle = "#ffffff"
  ctx.font = "700 38px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText("K", SIZE / 2, SIZE / 2 + 1)
  ctx.globalAlpha = 1

  const angle = (index / FRAME_COUNT) * Math.PI * 2
  ctx.beginPath()
  ctx.arc(SIZE / 2, SIZE / 2, 20, angle, angle + Math.PI * 1.5)
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 6.5
  ctx.lineCap = "round"
  ctx.stroke()
}

function buildFrames(): string[] {
  const out: string[] = []
  for (let i = 0; i < FRAME_COUNT; i++) {
    const canvas = document.createElement("canvas")
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext("2d")
    if (!ctx) continue
    renderFrame(ctx, i)
    out.push(canvas.toDataURL("image/png"))
  }
  return out
}

function setFaviconProgress(active: boolean) {
  const link = iconLink()
  if (!link) return

  if (!active) {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (originalHref != null) link.href = originalHref
    return
  }

  if (originalHref == null) originalHref = link.getAttribute("href") ?? "/favicon.svg"
  if (!frames) frames = buildFrames()
  if (timer || frames.length === 0) return

  frameIndex = 0
  link.href = frames[0]
  timer = setInterval(() => {
    frameIndex = (frameIndex + 1) % frames!.length
    link.href = frames![frameIndex]
  }, FRAME_MS)
}

export function useFaviconProgress() {
  const chat = useChat()
  const active = computed(() => chat.isBusy.value)

  watch(active, (value) => setFaviconProgress(value), { immediate: true })
  onScopeDispose(() => setFaviconProgress(false))

  return { active }
}
