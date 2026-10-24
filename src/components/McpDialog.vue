<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue"
import { ExternalLink, X } from "lucide-vue-next"
import { useApp } from "@/stores/app"
import { actionLabel, errorText, statusLabel, statusTone, useMcp } from "@/stores/mcp"
import type { McpServer } from "@/api/types"

/**
 * The `/mcps` dialog: the MCP servers of the open project, and the one thing
 * each of them can do next.
 *
 * It follows the TUI's own dialog — the same status wording, the same single
 * action per row, and the same rule that a server waiting on a login is signed
 * in rather than connected. The one liberty taken is that the detail behind a
 * failing row is shown under the list rather than on a second screen, because
 * there is room for it here.
 */

const app = useApp()
const mcp = useMcp()
const directory = app.server.directory
const client = computed(() => app.connection.client.value)

const query = ref("")
const selected = ref(0)
const code = ref("")
const searchEl = ref<HTMLInputElement | null>(null)

const rows = computed(() => {
  const wanted = query.value.trim().toLowerCase()
  if (!wanted) return mcp.servers.value
  return mcp.servers.value.filter((server) => server.name.toLowerCase().includes(wanted))
})

const current = computed<McpServer | undefined>(() => rows.value[selected.value])
const isPending = (server: McpServer) => mcp.pending.value.includes(server.name)

// A filter can shrink the list out from under the highlight.
watch(rows, () => {
  selected.value = Math.min(selected.value, Math.max(0, rows.value.length - 1))
})

watch(
  () => mcp.open.value,
  (open) => {
    if (!open) {
      window.removeEventListener("keydown", onKeydown)
      return
    }
    query.value = ""
    selected.value = 0
    code.value = ""
    window.addEventListener("keydown", onKeydown)
    void nextTick(() => searchEl.value?.focus())
  },
)

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown))

function move(delta: number) {
  const count = rows.value.length
  if (!count) return
  const next = (selected.value + delta) % count
  selected.value = next < 0 ? next + count : next
}

/** Run the highlighted row's action, which is never "connect" for a login. */
async function act(server: McpServer | undefined = current.value) {
  if (!server || !client.value) return
  await mcp.toggle(client.value, server, directory.value ?? undefined)
}

/**
 * Keys the dialog claims while it is open.
 *
 * The search box keeps the focus, so this hears every key it receives; Escape
 * closes, the arrows walk the list, and Enter runs the current action.
 */
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault()
    mcp.hide()
    return
  }
  if (event.key === "ArrowDown") {
    event.preventDefault()
    move(1)
    return
  }
  if (event.key === "ArrowUp") {
    event.preventDefault()
    move(-1)
    return
  }
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault()
    void act()
  }
}

async function submitCode() {
  const server = current.value
  if (!server || !client.value || !code.value.trim()) return
  await mcp.submitCode(client.value, server, code.value.trim(), directory.value ?? undefined)
}

/** End the sign-in the server is waiting on. */
async function cancelSignIn() {
  if (!client.value) return
  await mcp.cancelSignIn(client.value)
}

function returnToBrowser() {
  const url = mcp.signIn.value?.url
  if (url) window.open(url, "_blank", "noopener,noreferrer")
}
</script>

<template>
  <div v-if="mcp.open.value" class="mcp-overlay" @click.self="mcp.hide()">
    <div class="mcp-dialog" role="dialog" aria-modal="true" aria-label="MCP servers">
      <header class="head">
        <h2>MCP servers</h2>
        <button type="button" class="icon" title="Close (Esc)" @click="mcp.hide()">
          <X :size="14" />
        </button>
      </header>

      <input
        ref="searchEl"
        v-model="query"
        class="search"
        type="text"
        placeholder="Search MCP servers"
        spellcheck="false"
      />

      <ul v-if="rows.length" class="servers">
        <li
          v-for="(server, index) in rows"
          :key="server.name"
          class="server"
          :class="{ active: index === selected }"
          @mousemove="selected = index"
          @click="act(server)"
        >
          <span class="name">{{ server.name }}</span>
          <span class="status" :class="statusTone(server, isPending(server))">
            {{ statusLabel(server, isPending(server)) }}
          </span>
        </li>
      </ul>
      <p v-else class="empty">
        {{ mcp.servers.value.length ? "No matching servers" : "No MCP servers are configured" }}
      </p>

      <!-- The detail behind a row that says "Failed" or "Sign in required". -->
      <div v-if="errorText(current)" class="section detail">
        <p class="message">{{ errorText(current) }}</p>
        <p v-if="current" class="context">
          Status: {{ current.status.status }} · Configuration: mcp.servers.{{ current.name }}
          <template v-if="current.integrationID"> · Integration: {{ current.integrationID }}</template>
        </p>
      </div>

      <!-- The sign-in the server is waiting on, if there is one. -->
      <div v-if="mcp.signIn.value" class="section signin">
        <p class="signin-title">
          Signing in to
          <strong>{{ mcp.signIn.value.server }}</strong>
        </p>

        <template v-if="mcp.signIn.value.status === 'waiting' && mcp.signIn.value.mode === 'auto'">
          <p class="message">{{ mcp.signIn.value.instructions || "Waiting for the browser…" }}</p>
          <div class="signin-actions">
            <button type="button" class="link" @click="returnToBrowser">
              <ExternalLink :size="12" /> Open the sign-in page again
            </button>
            <button type="button" class="ghost" @click="cancelSignIn">Cancel</button>
          </div>
        </template>

        <template v-else-if="mcp.signIn.value.status === 'waiting'">
          <p class="message">{{ mcp.signIn.value.instructions }}</p>
          <pre class="url">{{ mcp.signIn.value.url }}</pre>
          <div class="signin-actions">
            <input
              v-model="code"
              class="code"
              type="text"
              placeholder="Paste the code"
              spellcheck="false"
              @keydown.enter.prevent="submitCode"
            />
            <button type="button" class="action" @click="submitCode">Submit</button>
            <button type="button" class="ghost" @click="cancelSignIn">Cancel</button>
          </div>
        </template>

        <template v-else-if="mcp.signIn.value.status === 'complete'">
          <p class="message ok">Signed in ✓</p>
        </template>

        <template v-else>
          <p class="message bad">{{ mcp.signIn.value.message }}</p>
          <div class="signin-actions">
            <button type="button" class="ghost" @click="mcp.dismissSignIn()">Dismiss</button>
          </div>
        </template>
      </div>

      <p v-if="mcp.error.value" class="message bad section">{{ mcp.error.value }}</p>

      <footer class="foot">
        <button
          type="button"
          class="action"
          :disabled="!current || (current ? isPending(current) : false)"
          @click="act()"
        >
          {{ actionLabel(current, current ? isPending(current) : false) }}
        </button>
        <span class="hint">↑↓ choose · Enter run · Esc close</span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.mcp-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 24px;
}
.mcp-dialog {
  width: min(520px, 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 10px 10px 14px;
}
.head h2 {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
}
.icon {
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  display: grid;
  place-items: center;
}
.icon:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.search {
  margin: 0 14px 8px;
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text);
  font-size: 13px;
  outline: none;
}
.search:focus {
  border-color: var(--accent);
}
.servers {
  list-style: none;
  margin: 0;
  padding: 0 8px 8px;
  overflow-y: auto;
}
.server {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
}
.server.active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.name {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status {
  flex: none;
  font-size: 12px;
  color: var(--text-muted);
}
.status.success {
  color: var(--accent);
}
.status.error {
  color: var(--danger);
}
.status.warning {
  color: var(--accent);
}
.empty {
  margin: 0;
  padding: 8px 16px 14px;
  font-size: 12.5px;
  color: var(--text-faint);
}
.section {
  padding: 10px 14px;
  border-top: 1px solid var(--border);
}
.message {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-muted);
  word-break: break-word;
}
.message.ok {
  color: var(--accent);
}
.message.bad {
  color: var(--danger);
}
.context {
  margin: 6px 0 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-faint);
  word-break: break-all;
}
.signin-title {
  margin: 0 0 6px;
  font-size: 12.5px;
  color: var(--text);
}
.url {
  margin: 6px 0 0;
  font-family: var(--font-mono);
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--text-faint);
  white-space: pre-wrap;
  word-break: break-all;
}
.signin-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.code {
  flex: 1 1 160px;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text);
  font-size: 12.5px;
  outline: none;
}
.link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 12.5px;
}
.link:hover {
  text-decoration: underline;
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-top: 1px solid var(--border);
  background: var(--bg-elevated);
}
.action {
  padding: 5px 12px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--accent-text);
  font-size: 12.5px;
}
.action:hover:not(:disabled) {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
.action:disabled {
  opacity: 0.4;
  cursor: default;
}
.ghost {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 12.5px;
}
.ghost:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.hint {
  font-size: 11px;
  color: var(--text-faint);
}
</style>
