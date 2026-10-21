<script setup lang="ts">
import { onMounted, ref } from "vue"
import ChatShell from "./components/ChatShell.vue"
import InstancePicker from "./components/InstancePicker.vue"
import Spinner from "./components/Spinner.vue"
import WindowResizeHandles from "./components/WindowResizeHandles.vue"
import { useApp } from "@/stores/app"
import { useFaviconProgress } from "@/stores/favicon"

const app = useApp()
useFaviconProgress()
const connected = app.connection.connected

// Keep the picker hidden while we try to restore the last server, so it does
// not flash on load when a stored server is actually reachable.
const booting = ref(!connected.value)

onMounted(async () => {
  if (connected.value) {
    booting.value = false
    return
  }
  try {
    await app.connection.scan()

    // Reconnect to the most recently used server when it is reachable and we
    // either already hold credentials or it needs none.
    const saved = [...app.connection.saved.value].sort((a, b) => b.lastUsed - a.lastUsed)
    const last = saved[0]
    if (!last) return
    const info = app.connection.instances.value.find((item) => item.origin === last.origin)
    if (!info) return
    if (info.requiresAuth && !last.password) return
    await app.connect(info, app.connection.credentialsFor(last.origin))
  } finally {
    booting.value = false
  }
})
</script>

<template>
  <div v-if="booting" class="booting">
    <Spinner :size="22" />
  </div>
  <InstancePicker v-else-if="!connected" />
  <ChatShell v-else />
  <!-- The window is frameless, so the grips that resize it are drawn here, in
       every screen, on top of everything else. -->
  <WindowResizeHandles />
</template>

<style scoped>
.booting {
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--text-muted);
  /* Nothing to interact with here, so the whole screen can move the window. */
  -webkit-app-region: drag;
  background:
    radial-gradient(1200px 600px at 50% -10%, color-mix(in srgb, var(--accent) 10%, transparent), transparent),
    var(--bg);
}
</style>