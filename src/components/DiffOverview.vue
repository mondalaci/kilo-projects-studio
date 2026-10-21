<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue"
import { drawChangeMap, type ChangeMark } from "@/utils/changeMap"

/**
 * The change map beside the diff: the whole file compressed into a narrow strip
 * with red regions where lines were removed and green where they were added —
 * the red and green regions an editor shows next to its file list.
 *
 * The strip is also a scrubber: clicking or dragging it moves the diff, and the
 * translucent block shows which part of the file is on screen.
 */
const props = defineProps<{
  /** One entry per rendered row of the diff, in order. */
  marks: ChangeMark[]
  /** The scrolling element the strip maps, once it exists. */
  body: HTMLElement | null
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
const viewport = ref({ top: 0, height: 0, visible: false })

/** The change colours come from the theme, so light mode reads correctly. */
function colours() {
  const styles = getComputedStyle(document.documentElement)
  return {
    del: styles.getPropertyValue("--git-deleted").trim() || "#f85149",
    add: styles.getPropertyValue("--git-added").trim() || "#3fb950",
  }
}

function draw() {
  const element = canvas.value
  if (!element) return
  const width = element.clientWidth
  const height = element.clientHeight
  if (!width || !height) return

  const dpr = window.devicePixelRatio || 1
  element.width = Math.round(width * dpr)
  element.height = Math.round(height * dpr)
  const ctx = element.getContext("2d")
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  drawChangeMap(ctx, width, height, props.marks, colours())
}

/** Track which part of the file the diff is showing. */
function syncViewport() {
  const body = props.body
  if (!body) {
    viewport.value = { top: 0, height: 0, visible: false }
    return
  }
  const total = body.scrollHeight
  if (!total) {
    viewport.value = { top: 0, height: 0, visible: false }
    return
  }
  viewport.value = {
    top: (body.scrollTop / total) * 100,
    height: (body.clientHeight / total) * 100,
    visible: true,
  }
}

function scrollToPointer(event: PointerEvent) {
  const body = props.body
  const element = canvas.value
  if (!body || !element) return
  const rect = element.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
  body.scrollTop = ratio * body.scrollHeight - body.clientHeight / 2
  syncViewport()
}

function onPointerDown(event: PointerEvent) {
  const element = event.currentTarget as HTMLElement
  element.setPointerCapture(event.pointerId)
  scrollToPointer(event)
  const onMove = (move: PointerEvent) => scrollToPointer(move)
  const onUp = () => {
    element.removeEventListener("pointermove", onMove)
    element.removeEventListener("pointerup", onUp)
  }
  element.addEventListener("pointermove", onMove)
  element.addEventListener("pointerup", onUp)
}

let detach: (() => void) | null = null
let observer: ResizeObserver | null = null

watch(
  () => props.body,
  (body) => {
    detach?.()
    detach = null
    if (!body) return
    const onScroll = () => syncViewport()
    const onResize = () => {
      draw()
      syncViewport()
    }
    body.addEventListener("scroll", onScroll, { passive: true })
    observer = new ResizeObserver(onResize)
    observer.observe(body)
    detach = () => {
      body.removeEventListener("scroll", onScroll)
      observer?.disconnect()
      observer = null
    }
    draw()
    syncViewport()
  },
  { immediate: true },
)

watch(
  () => props.marks,
  () => {
    draw()
    syncViewport()
  },
)

onBeforeUnmount(() => {
  detach?.()
  observer?.disconnect()
})
</script>

<template>
  <div class="overview" title="Change map — click or drag to move through the file" @pointerdown="onPointerDown">
    <canvas ref="canvas" class="map"></canvas>
    <div
      v-if="viewport.visible"
      class="viewport"
      :style="{ top: `${viewport.top}%`, height: `${Math.max(viewport.height, 3)}%` }"
    ></div>
  </div>
</template>

<style scoped>
.overview {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 11px;
  background: color-mix(in srgb, var(--bg) 85%, var(--border));
  border-left: 1px solid var(--border);
  cursor: pointer;
  touch-action: none;
}
.map {
  display: block;
  width: 100%;
  height: 100%;
}
/* Where the diff is currently scrolled to. */
.viewport {
  position: absolute;
  left: 0;
  right: 0;
  background: color-mix(in srgb, var(--text) 18%, transparent);
  border-top: 1px solid color-mix(in srgb, var(--text) 30%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--text) 30%, transparent);
  pointer-events: none;
}
</style>
