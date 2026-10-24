import { computed, onScopeDispose, watch } from "vue"
import iconUrl from "../../build/icon.png"
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

/** The app icon, once the browser has decoded it. */
let icon: HTMLImageElement | null = null

function loadIcon(): Promise<HTMLImageElement> {
  if (icon) return Promise.resolve(icon)
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      icon = image
      resolve(image)
    }
    image.onerror = () => reject(new Error(`could not load ${iconUrl}`))
    image.src = iconUrl
  })
}

let frames: string[] | null = null
let building: Promise<string[]> | null = null
let originalHref: string | null = null
let timer: ReturnType<typeof setInterval> | null = null
let frameIndex = 0

function iconLink(): HTMLLinkElement | null {
  if (typeof document === "undefined") return null
  return document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
}

function renderFrame(ctx: CanvasRenderingContext2D, index: number, image: HTMLImageElement) {
  ctx.clearRect(0, 0, SIZE, SIZE)
  // The app icon itself, faded, behind the spinner.
  ctx.globalAlpha = 0.35
  ctx.drawImage(image, 0, 0, SIZE, SIZE)
  ctx.globalAlpha = 1

  const angle = (index / FRAME_COUNT) * Math.PI * 2
  ctx.beginPath()
  ctx.arc(SIZE / 2, SIZE / 2, 20, angle, angle + Math.PI * 1.5)
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 6.5
  ctx.lineCap = "round"
  ctx.stroke()
}

async function buildFrames(): Promise<string[]> {
  const image = await loadIcon()
  const out: string[] = []
  for (let i = 0; i < FRAME_COUNT; i++) {
    const canvas = document.createElement("canvas")
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext("2d")
    if (!ctx) continue
    renderFrame(ctx, i, image)
    out.push(canvas.toDataURL("image/png"))
  }
  return out
}

async function setFaviconProgress(active: boolean) {
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

  if (originalHref == null) originalHref = link.getAttribute("href") ?? "/icon.png"
  // The frames need the icon decoded first, and the turn can end while that
  // happens: what is left over is a spinner for a turn that is already over.
  if (!frames) {
    if (!building) building = buildFrames()
    frames = await building.catch(() => null)
  }
  if (timer || !frames || frames.length === 0) return

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

  watch(active, (value) => void setFaviconProgress(value), { immediate: true })
  onScopeDispose(() => setFaviconProgress(false))

  return { active }
}
