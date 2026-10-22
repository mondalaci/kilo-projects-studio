<script setup lang="ts">
import { onMounted, ref } from "vue"
import { ArrowRight, Plus, RefreshCw, Server, KeyRound } from "lucide-vue-next"
import Spinner from "./Spinner.vue"
import WindowControls from "./WindowControls.vue"
import { normalizeOrigin, type InstanceInfo } from "@/api/discovery"
import { useApp } from "@/stores/app"

const app = useApp()
const { instances, scanning, connecting, connectError, credentialsFor, scan } = app.connection

const origin = ref("")
const username = ref("opencode")
const password = ref("")
const showManual = ref(false)
const busyOrigin = ref<string | null>(null)
const localError = ref<string | null>(null)

onMounted(() => {
  if (instances.value.length === 0) void scan()
})

function productLabel(product: InstanceInfo["product"]) {
  if (product === "kilo") return "Kilo Code"
  if (product === "opencode") return "opencode"
  return "Server"
}

async function open(info: InstanceInfo) {
  localError.value = null
  const creds = credentialsFor(info.origin)
  if (info.requiresAuth && !creds) {
    showManual.value = true
    origin.value = info.origin
    localError.value = "This server requires a password."
    return
  }
  busyOrigin.value = info.origin
  await app.connect(info, creds)
  busyOrigin.value = null
}

async function manualConnect() {
  localError.value = null
  const normalized = normalizeOrigin(origin.value)
  if (!normalized) {
    localError.value = "Enter a valid address, e.g. 127.0.0.1:4097"
    return
  }
  const creds = password.value
    ? { username: username.value || "opencode", password: password.value }
    : credentialsFor(normalized)
  busyOrigin.value = normalized
  const info: InstanceInfo = {
    id: normalized,
    origin: normalized,
    product: "unknown",
    version: "unknown",
    requiresAuth: false,
  }
  await app.connect(info, creds)
  busyOrigin.value = null
}
</script>

<template>
  <div class="picker">
    <div class="panel">
      <header class="head drag-region">
        <div class="logo" aria-hidden="true">K</div>
        <div>
          <h1>OpenCode Projects Studio</h1>
          <p>Connect to a Kilo Code or opencode server</p>
        </div>
        <!-- The window has no OS decoration, so the picker carries the window
             buttons as well. -->
        <WindowControls />
      </header>

      <div class="toolbar">
        <button class="ghost" :disabled="scanning" @click="scan()">
          <RefreshCw :size="15" :class="{ spin: scanning }" />
          {{ scanning ? "Scanning…" : "Scan for servers" }}
        </button>
        <button class="ghost" @click="showManual = !showManual">
          <Plus :size="15" />
          Add address
        </button>
      </div>

      <ul class="list">
        <li
          v-for="info in instances"
          :key="info.origin"
          class="item"
          :class="{ busy: busyOrigin === info.origin, disabled: busyOrigin !== null && busyOrigin !== info.origin }"
          role="button"
          tabindex="0"
          @click="open(info)"
          @keydown.enter.prevent="open(info)"
          @keydown.space.prevent="open(info)"
        >
          <Server :size="18" class="item-icon" />
          <div class="item-text">
            <div class="item-title">
              <span class="badge" :class="info.product">{{ productLabel(info.product) }}</span>
              <span class="mono">{{ info.origin }}</span>
            </div>
            <div class="item-sub">
              <template v-if="info.requiresAuth">
                <KeyRound :size="12" /> password required
              </template>
              <template v-else>
                v{{ info.version }}<template v-if="info.directory"> · {{ info.directory }}</template>
              </template>
            </div>
          </div>
          <span class="item-go">
            <Spinner v-if="busyOrigin === info.origin" :size="16" />
            <ArrowRight v-else :size="16" />
          </span>
        </li>
        <li v-if="!instances.length && !scanning" class="empty">
          No servers found on local ports. Start one with <code>kilo serve</code> and scan again, or add an address.
        </li>
      </ul>

      <form v-if="showManual" class="manual" @submit.prevent="manualConnect">
        <label>
          Address
          <input v-model="origin" placeholder="127.0.0.1:4097" autocomplete="off" spellcheck="false" />
        </label>
        <div class="row">
          <label>
            Username
            <input v-model="username" placeholder="opencode" autocomplete="username" />
          </label>
          <label>
            Password
            <input v-model="password" type="password" placeholder="optional" autocomplete="current-password" />
          </label>
        </div>
        <button class="primary wide" type="submit" :disabled="connecting">
          <Spinner v-if="connecting" :size="14" />
          <template v-else>Connect</template>
        </button>
      </form>

      <p v-if="localError || connectError" class="error">{{ localError || connectError }}</p>
    </div>
  </div>
</template>

<style scoped>
.picker {
  height: 100%;
  display: grid;
  place-items: center;
  padding: 24px;
  /* The empty space around the card moves the frameless window; the card itself
     stays interactive and is dragged by its own header. */
  -webkit-app-region: drag;
  background:
    radial-gradient(1200px 600px at 50% -10%, color-mix(in srgb, var(--accent) 10%, transparent), transparent),
    var(--bg);
}
.panel {
  -webkit-app-region: no-drag;
  width: 100%;
  max-width: 560px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px;
  box-shadow: var(--shadow);
}
.head {
  display: flex;
  gap: 14px;
  align-items: center;
  margin-bottom: 18px;
}
/* The window buttons sit at the far right of the header strip. */
.head :deep(.window-controls) {
  margin-left: auto;
}
.logo {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--accent);
  color: var(--accent-text);
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 22px;
}
h1 {
  margin: 0;
  font-size: 20px;
}
.head p {
  margin: 2px 0 0;
  color: var(--text-muted);
  font-size: 13px;
}
.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow: auto;
}
.item {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.item:hover,
.item:focus-visible {
  background: var(--bg-hover);
  border-color: var(--border-strong);
  outline: none;
}
.item.busy {
  border-color: var(--accent);
}
.item.disabled {
  opacity: 0.55;
  pointer-events: none;
}
.item-icon {
  color: var(--text-muted);
  flex: none;
}
.item-text {
  flex: 1;
  min-width: 0;
}
.item-go {
  flex: none;
  display: inline-flex;
  color: var(--text-faint);
}
.item:hover .item-go {
  color: var(--accent);
}
.item-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.item-sub {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--text-muted);
  font-size: 12px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono {
  font-family: var(--font-mono);
  font-size: 12.5px;
}
.badge {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--bg-active);
  color: var(--text-muted);
  border: 1px solid var(--border);
  white-space: nowrap;
}
.badge.kilo {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 50%, transparent);
}
.manual {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row {
  display: flex;
  gap: 10px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
  flex: 1;
}
input {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  color: var(--text);
  outline: none;
}
input:focus {
  border-color: var(--accent);
}
button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg);
  padding: 7px 12px;
  font-size: 13px;
  transition: background 0.12s, border-color 0.12s;
}
button:hover:not(:disabled) {
  background: var(--bg-hover);
}
button:disabled {
  opacity: 0.6;
  cursor: default;
}
button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
}
button.primary:hover:not(:disabled) {
  background: var(--accent-hover);
}
button.wide {
  justify-content: center;
}
.ghost {
  color: var(--text-muted);
}
.empty {
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
  padding: 18px 8px;
  line-height: 1.6;
}
.empty code {
  font-family: var(--font-mono);
  background: var(--bg-active);
  padding: 1px 5px;
  border-radius: 4px;
}
.error {
  color: var(--danger);
  font-size: 13px;
  margin: 12px 0 0;
}
.spin {
  animation: opencode-spin 0.8s linear infinite;
}
@keyframes opencode-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>