<script setup lang="ts">
import { onMounted } from "vue"
import { desktopBridge, type ScreenPoint, type WindowBounds } from "@/api/desktop"
import { trackWindowState, windowMaximized } from "@/stores/desktopWindow"

/**
 * Edge and corner grips for the chromeless window.
 *
 * Electron's frameless windows keep edge resizing on Windows (via `thickFrame`)
 * but not on Linux, where the window manager has no decoration to grab. These
 * thin overlays on all eight edges move the window themselves, so the chromeless
 * window stays resizable everywhere.
 *
 * Each grip only covers the outermost few pixels, which is also where a native
 * frame would take over: just inside them the header strips remain draggable.
 *
 * While the window is maximized the grips are not rendered at all — a maximized
 * window cannot be resized, so showing a resize cursor there would only mislead.
 */
const api = desktopBridge()?.window

onMounted(() => trackWindowState())

interface Edges {
  left?: boolean
  right?: boolean
  top?: boolean
  bottom?: boolean
}

const handles: Array<{ name: string; edges: Edges; cursor: string }> = [
  { name: "top", edges: { top: true }, cursor: "ns-resize" },
  { name: "bottom", edges: { bottom: true }, cursor: "ns-resize" },
  { name: "left", edges: { left: true }, cursor: "ew-resize" },
  { name: "right", edges: { right: true }, cursor: "ew-resize" },
  { name: "top-left", edges: { left: true, top: true }, cursor: "nwse-resize" },
  { name: "top-right", edges: { right: true, top: true }, cursor: "nesw-resize" },
  { name: "bottom-left", edges: { left: true, bottom: true }, cursor: "nesw-resize" },
  { name: "bottom-right", edges: { right: true, bottom: true }, cursor: "nwse-resize" },
]

/** Apply the pointer delta to the dragged edges, holding the minimum size. */
function resizeBy(start: WindowBounds, edges: Edges, dx: number, dy: number): WindowBounds {
  let { x, y, width, height } = start

  if (edges.right) width = start.width + dx
  else if (edges.left) width = start.width - dx
  if (edges.bottom) height = start.height + dy
  else if (edges.top) height = start.height - dy

  if (width < start.minWidth) width = start.minWidth
  if (height < start.minHeight) height = start.minHeight
  // Moving a left/top edge also moves the window, pinned so the opposite edge
  // stays put even once the minimum size is reached.
  if (edges.left) x = start.x + (start.width - width)
  if (edges.top) y = start.y + (start.height - height)

  return { x, y, width, height, minWidth: start.minWidth, minHeight: start.minHeight }
}

function start(event: PointerEvent, handle: { edges: Edges; cursor: string }) {
  if (!api || event.button !== 0) return
  event.preventDefault()

  const element = event.currentTarget as HTMLElement
  element.setPointerCapture(event.pointerId)

  // Both the geometry and the cursor come from the main process, in the same
  // DIP space, so the deltas stay correct while the window itself moves.
  let origin: { bounds: WindowBounds; point: ScreenPoint } | null = null
  let busy = false
  let live = true

  void (async () => {
    const [bounds, point] = await Promise.all([api.bounds(), api.cursorPoint()])
    if (live && bounds) origin = { bounds, point }
  })()

  const root = document.documentElement
  root.classList.add("window-resizing")
  root.style.setProperty("--kilo-resize-cursor", handle.cursor)

  const onMove = () => {
    if (!origin || busy) return
    const { bounds, point } = origin
    busy = true
    void api
      .cursorPoint()
      .then((now) => {
        if (!live) return
        void api.setBounds(resizeBy(bounds, handle.edges, now.x - point.x, now.y - point.y))
      })
      .finally(() => {
        busy = false
      })
  }

  const onEnd = () => {
    live = false
    root.classList.remove("window-resizing")
    root.style.removeProperty("--kilo-resize-cursor")
    element.removeEventListener("pointermove", onMove)
    element.removeEventListener("pointerup", onEnd)
    element.removeEventListener("pointercancel", onEnd)
  }

  element.addEventListener("pointermove", onMove)
  element.addEventListener("pointerup", onEnd)
  element.addEventListener("pointercancel", onEnd)
}
</script>

<template>
  <div v-if="api && !windowMaximized" class="resize-layer" aria-hidden="true">
    <div
      v-for="handle in handles"
      :key="handle.name"
      class="resize-handle"
      :class="handle.name"
      :style="{ cursor: handle.cursor }"
      @pointerdown="start($event, handle)"
    ></div>
  </div>
</template>

<style scoped>
/* The layer itself is transparent to the pointer; only the grips are live. */
.resize-layer {
  position: fixed;
  inset: 0;
  z-index: 60;
  pointer-events: none;
}
.resize-handle {
  position: fixed;
  pointer-events: auto;
  /* Without this, the top grip would be treated as part of the header's drag
     region and the window would move instead of resizing. */
  -webkit-app-region: no-drag;
}
.top {
  top: 0;
  left: 0;
  right: 0;
  height: 5px;
}
.bottom {
  bottom: 0;
  left: 0;
  right: 0;
  height: 5px;
}
.left {
  top: 0;
  bottom: 0;
  left: 0;
  width: 5px;
}
.right {
  top: 0;
  bottom: 0;
  right: 0;
  width: 5px;
}
.top-left,
.top-right,
.bottom-left,
.bottom-right {
  width: 12px;
  height: 12px;
}
.top-left {
  top: 0;
  left: 0;
}
.top-right {
  top: 0;
  right: 0;
}
.bottom-left {
  bottom: 0;
  left: 0;
}
.bottom-right {
  bottom: 0;
  right: 0;
}
</style>
