<script setup lang="ts">
import { onMounted } from "vue"
import { Copy, Minus, Square, X } from "lucide-vue-next"
import { desktopBridge } from "@/api/desktop"
import { trackWindowState, windowMaximized as maximized } from "@/stores/desktopWindow"

/**
 * Window buttons for the chromeless frame.
 *
 * The window has no OS title bar, so minimize/maximize/close live here, at the
 * right end of whichever header is topmost-right. In a plain browser there is no
 * window to control and the component renders nothing.
 *
 * The glyph follows the shared maximize state rather than the result of a click:
 * the window manager applies the change asynchronously, so a state read right
 * after the request would be stale.
 */
const api = desktopBridge()?.window

onMounted(() => trackWindowState())
</script>

<template>
  <div v-if="api" class="window-controls">
    <button class="control" title="Minimize" aria-label="Minimize window" @click="api.minimize()">
      <Minus :size="14" />
    </button>
    <button
      class="control"
      :title="maximized ? 'Restore' : 'Maximize'"
      :aria-label="maximized ? 'Restore window' : 'Maximize window'"
      @click="api.toggleMaximize()"
    >
      <Copy v-if="maximized" :size="11" />
      <Square v-else :size="11" />
    </button>
    <button class="control close" title="Close" aria-label="Close window" @click="api.close()">
      <X :size="14" />
    </button>
  </div>
</template>

<style scoped>
.window-controls {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: 4px;
}
.control {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  /* Never part of a drag region, or clicks would move the window instead. */
  -webkit-app-region: no-drag;
}
.control:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.control.close:hover {
  background: #d64545;
  color: #ffffff;
}
</style>
