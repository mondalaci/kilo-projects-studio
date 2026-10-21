<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "reka-ui"
import { X, CircleAlert, Check, Copy, ExternalLink, Link2, Link2Off, Moon, Share2, Sun } from "lucide-vue-next"
import type { AssistantMessage } from "@/api/types"
import Sidebar from "./Sidebar.vue"
import SourceControl from "./SourceControl.vue"
import DiffViewer from "./DiffViewer.vue"
import MessageThread from "./MessageThread.vue"
import Composer from "./Composer.vue"
import PromptDock from "./PromptDock.vue"
import FileViewer from "./FileViewer.vue"
import ImageLightbox from "./ImageLightbox.vue"
import { useApp } from "@/stores/app"
import { useFileViewer } from "@/stores/fileViewer"
import { startFilter, stopFilter } from "@/stores/filter"
import { useGit } from "@/stores/git"
import { useTray } from "@/stores/tray"
import { requestComposerFocus } from "@/stores/draft"
import { requestOpen, shortcutKeys, shortcutsVisible, togglePronunciation } from "@/stores/shortcuts"
import { searchOpen, openSearch } from "@/stores/search"
import { applyScmWidth, scmWidth, setScmWidth } from "@/stores/layout"
import { theme, toggleTheme } from "@/theme"
import { formatConversationDate, formatConversationDateTime, formatCost } from "@/utils/format"

const app = useApp()
const git = useGit()
const fileViewer = useFileViewer()
const tray = useTray()
const { current, currentID } = app.sessions
const { error, messages, isBusy } = app.chat
const { providers, selectedModelInfo } = app.server
const { newChat } = app

/** The change row whose diff is open; while set, the diff replaces the chat. */
const activeDiff = git.selection
/** A read-only file opened from the file search, when it has nothing to diff. */
const activeFile = fileViewer.view

/**
 * Returning to the conversation — from a diff, a file, or the search — should show
 * where it left off rather than wherever it was scrolled to before, which may be
 * thousands of lines away in a long thread.
 */
watch(
  () => [Boolean(activeDiff.value), Boolean(activeFile.value)],
  ([hadDiff, hadFile], [wasDiff, wasFile]) => {
    if ((wasDiff || wasFile) && !hadDiff && !hadFile) app.chat.requestScrollToBottom()
  },
  // After the DOM update: the thread is only back in the tree once the diff has
  // gone, and a request made before that would not reach it.
  { flush: "post" },
)

const shareState = ref<"idle" | "shared" | "copied" | "unshared">("idle")

/** Whether the open session currently has a public share link. */
const isShared = computed(() => Boolean(current.value?.share?.url))

function flashShare(state: "shared" | "copied" | "unshared") {
  shareState.value = state
  setTimeout(() => {
    shareState.value = "idle"
  }, 1500)
}

const shareTitle = computed(() => {
  if (shareState.value === "shared") return "Public link created"
  if (shareState.value === "copied") return "Link copied"
  if (shareState.value === "unshared") return "Sharing revoked"
  return isShared.value ? "Shared — manage link" : "Share chat"
})

/** Create a public share link for the open session (open/copy it on success). */
async function shareChat() {
  const sessionID = currentID.value
  if (!sessionID) return
  const shared = await app.shareSession(sessionID)
  if (shared) {
    if (navigator.share) {
      try {
        await navigator.share({ title: title.value, url: shared })
        flashShare("shared")
        return
      } catch {
        /* user cancelled */
      }
    }
    window.open(shared, "_blank", "noopener")
    flashShare("shared")
    return
  }
  // Fall back to the local per-chat URL when the server cannot create a share.
  const url = new URL(window.location.href)
  url.searchParams.set("session", sessionID)
  try {
    await navigator.clipboard.writeText(url.toString())
    flashShare("copied")
  } catch {
    /* clipboard unavailable */
  }
}

const shareURL = computed(() => current.value?.share?.url ?? "")

function openShare() {
  if (shareURL.value) window.open(shareURL.value, "_blank", "noopener")
}

async function copyShare() {
  if (!shareURL.value) return
  try {
    await navigator.clipboard.writeText(shareURL.value)
    flashShare("copied")
  } catch {
    /* clipboard unavailable */
  }
}

async function unshare() {
  const sessionID = currentID.value
  if (sessionID && (await app.unshareSession(sessionID))) flashShare("unshared")
}

const SIDEBAR_KEY = "kilo-projects-studio.sidebar-width"
const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 520
const DEFAULT_SIDEBAR = 264

function loadSidebarWidth() {
  const value = Number(localStorage.getItem(SIDEBAR_KEY))
  return Number.isFinite(value) && value >= SIDEBAR_MIN && value <= SIDEBAR_MAX ? value : DEFAULT_SIDEBAR
}

const sidebarWidth = ref(loadSidebarWidth())

function applySidebarWidth() {
  document.documentElement.style.setProperty("--sidebar-width", `${sidebarWidth.value}px`)
}

/** Split.js-style drag handle between the sidebar and the conversation. */
function startResize(event: PointerEvent) {
  event.preventDefault()
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  const onMove = (move: PointerEvent) => {
    sidebarWidth.value = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, move.clientX))
    applySidebarWidth()
  }
  const onUp = () => {
    handle.removeEventListener("pointermove", onMove)
    handle.removeEventListener("pointerup", onUp)
    try {
      localStorage.setItem(SIDEBAR_KEY, String(sidebarWidth.value))
    } catch {
      /* ignore */
    }
  }
  handle.addEventListener("pointermove", onMove)
  handle.addEventListener("pointerup", onUp)
}

/** Drag handle for the source-control panel on the right; it grows leftwards. */
function startScmResize(event: PointerEvent) {
  event.preventDefault()
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  const startX = event.clientX
  const startWidth = scmWidth.value
  const onMove = (move: PointerEvent) => setScmWidth(startWidth + (startX - move.clientX))
  const onUp = () => {
    handle.removeEventListener("pointermove", onMove)
    handle.removeEventListener("pointerup", onUp)
  }
  handle.addEventListener("pointermove", onMove)
  handle.addEventListener("pointerup", onUp)
}

const title = computed(() => current.value?.title || "New chat")

// Reflect the active chat in the browser tab title.
watch(
  title,
  (value) => {
    document.title = current.value ? `${value} · Kilo Projects Studio` : "Kilo Projects Studio"
  },
  { immediate: true },
)

/**
 * Keep the source-control panel pointed at the active project, and re-scan it
 * on a timer: git has no change notification we can subscribe to, so polling
 * is what keeps the file list live while the agent edits the working tree.
 */
watch(
  () => app.server.directory.value,
  (directory) => {
    if (!directory) return
    void git.setDirectory(directory)
    git.startPolling(directory)
  },
  { immediate: true },
)

// Session cost: the higher of the session total and the sum of assistant message
// costs, matching the TUI.
const sessionCost = computed(() => {
  const total = messages.value.reduce((sum, item) => (item.info.role === "assistant" ? sum + (item.info.cost ?? 0) : sum), 0)
  return Math.max(current.value?.cost ?? 0, total)
})

// Context usage is taken from the last assistant message that produced output.
const lastAssistant = computed<AssistantMessage | null>(() => {
  const list = messages.value
  for (let i = list.length - 1; i >= 0; i--) {
    const info = list[i].info
    if (info.role === "assistant" && (info.tokens?.output ?? 0) > 0) return info
  }
  return null
})

const contextTokens = computed(() => {
  const tokens = lastAssistant.value?.tokens
  if (!tokens) return 0
  return (
    (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)
  )
})

const contextLimit = computed(() => {
  const info = lastAssistant.value
  if (info) {
    const model = providers.value.find((provider) => provider.id === info.providerID)?.models?.[info.modelID]
    if (model?.limit?.context) return model.limit.context
  }
  return selectedModelInfo.value?.limit?.context ?? 0
})

const contextPercent = computed(() => (contextLimit.value ? Math.round((contextTokens.value / contextLimit.value) * 100) : 0))

const costTitle = computed(() => `Session cost: ${formatCost(sessionCost.value)}`)
// The conversation date, showing a range when it spans more than one day.
const conversationDate = computed(() => formatConversationDate(current.value?.time))
const conversationDateTitle = computed(() => formatConversationDateTime(current.value?.time))
const contextTitle = computed(() =>
  contextLimit.value
    ? `${contextTokens.value.toLocaleString()} tokens (${contextPercent.value}% of context)`
    : `${contextTokens.value.toLocaleString()} tokens`,
)

function dismissError() {
  error.value = null
}

/**
 * Shortcuts use `Alt` + a letter; matching on `event.code` keeps them working on
 * macOS, where Option+letter produces a different `event.key`. Holding Alt
 * reveals the key badges on the controls they trigger.
 */
function onKeyDown(event: KeyboardEvent) {
  if (event.altKey) shortcutsVisible.value = true

  // The incremental searches use the familiar editor bindings: Ctrl+R filters
  // the projects sidebar, Ctrl+P the source-control list. Chromium's own Ctrl+R
  // reload and Ctrl+P print are not wanted here, and with no application menu
  // there is no accelerator keeping them alive.
  if ((event.ctrlKey || event.metaKey) && !event.altKey) {
    if (event.code === "KeyR") {
      event.preventDefault()
      startFilter("projects")
      return
    }
    if (event.code === "KeyP") {
      event.preventDefault()
      startFilter("changes")
      return
    }
  }

  if (!event.altKey) return
  switch (event.code) {
    case shortcutKeys.model:
      event.preventDefault()
      requestOpen("model")
      break
    case shortcutKeys.agent:
      event.preventDefault()
      requestOpen("agent")
      break
    case shortcutKeys.project:
      event.preventDefault()
      requestOpen("project")
      break
    case shortcutKeys.sessions:
      event.preventDefault()
      requestOpen("sessions")
      break
    case shortcutKeys.chats:
      event.preventDefault()
      requestOpen("chats")
      break
    case shortcutKeys.search:
      event.preventDefault()
      openSearch()
      break
    case shortcutKeys.effort:
      event.preventDefault()
      requestOpen("effort")
      break
    case shortcutKeys.tools:
      event.preventDefault()
      requestOpen("tools")
      break
    case shortcutKeys.pronounce:
      event.preventDefault()
      togglePronunciation()
      break
    case shortcutKeys.stop:
      event.preventDefault()
      if (isBusy.value) void app.abort()
      break
    case shortcutKeys.newChat:
      event.preventDefault()
      void newChat()
      break
    case shortcutKeys.focusChat:
      event.preventDefault()
      requestComposerFocus()
      break
    default:
      break
  }
}

function onKeyUp(event: KeyboardEvent) {
  if (event.key === "Alt" || !event.altKey) shortcutsVisible.value = false
}

function onBlur() {
  shortcutsVisible.value = false
}

function onPopState() {
  void app.openInitialSession()
}

onMounted(() => {
  applySidebarWidth()
  applyScmWidth()
  // Tray clicks (and notification clicks) open the conversation they name.
  tray.start({
    onFocusSession: (sessionID) => {
      void app.openSessionByID(sessionID)
    },
  })
  window.addEventListener("keydown", onKeyDown)
  window.addEventListener("keyup", onKeyUp)
  window.addEventListener("blur", onBlur)
  window.addEventListener("popstate", onPopState)
})
onBeforeUnmount(() => {
  git.stopPolling()
  stopFilter()
  window.removeEventListener("keydown", onKeyDown)
  window.removeEventListener("keyup", onKeyUp)
  window.removeEventListener("blur", onBlur)
  window.removeEventListener("popstate", onPopState)
  shortcutsVisible.value = false
})
</script>

<template>
  <div class="shell" :class="{ searching: searchOpen }">
    <div class="sidebar-host">
      <Sidebar />
    </div>
    <div class="resizer" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" @pointerdown="startResize"></div>

    <main class="main">
      <DiffViewer v-if="activeDiff" />
      <FileViewer v-else-if="activeFile" />

      <template v-else>
        <header class="topbar drag-region">
          <h1 class="title">{{ title }}</h1>
          <div v-if="current" class="stats">
            <span v-if="conversationDate" class="stat" :title="conversationDateTitle">{{ conversationDate }}</span>
            <span v-if="conversationDate" class="stat-divider">·</span>
            <span class="stat" :title="costTitle">{{ formatCost(sessionCost) }}</span>
            <span class="stat-divider">·</span>
            <span class="stat" :class="{ warn: contextPercent >= 80 }" :title="contextTitle">
              {{ contextLimit ? `${contextPercent}%` : "—" }}
            </span>
          </div>
          <button
            class="theme-btn"
            :title="theme === 'dark' ? 'Light theme' : 'Dark theme'"
            aria-label="Toggle dark mode"
            @click="toggleTheme()"
          >
            <Sun v-if="theme === 'dark'" :size="16" />
            <Moon v-else :size="16" />
          </button>
          <DropdownMenuRoot v-if="isShared">
            <DropdownMenuTrigger as-child>
              <button
                class="share-btn"
                :class="{ active: isShared || shareState !== 'idle' }"
                :title="shareTitle"
                aria-label="Manage share link"
              >
                <Check v-if="shareState !== 'idle'" :size="16" />
                <Link2 v-else :size="16" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent class="kilo-menu" :side-offset="4" align="end">
                <DropdownMenuItem class="kilo-menu-item" @select="openShare">
                  <ExternalLink :size="14" /> Open public link
                </DropdownMenuItem>
                <DropdownMenuItem class="kilo-menu-item" @select="copyShare">
                  <Copy :size="14" /> Copy link
                </DropdownMenuItem>
                <DropdownMenuSeparator class="kilo-menu-sep" />
                <DropdownMenuItem class="kilo-menu-item danger" @select="unshare">
                  <Link2Off :size="14" /> Unshare
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
          <button
            v-else
            class="share-btn"
            :class="{ active: shareState !== 'idle' }"
            :title="shareTitle"
            aria-label="Share chat"
            @click="shareChat"
          >
            <Check v-if="shareState !== 'idle'" :size="16" />
            <Share2 v-else :size="16" />
          </button>
        </header>

        <MessageThread />

        <div class="bottom">
          <div v-if="error" class="error-banner">
            <CircleAlert :size="15" />
            <span>{{ error }}</span>
            <button @click="dismissError"><X :size="14" /></button>
          </div>
          <PromptDock />
          <Composer />
        </div>
      </template>
    </main>

    <ImageLightbox />

    <div
      class="resizer right"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize source control panel"
      @pointerdown="startScmResize"
    ></div>
    <div class="scm-host">
      <SourceControl />
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100%;
  overflow: hidden;
  position: relative;
}
.sidebar-host {
  flex: none;
  height: 100%;
}
.scm-host {
  flex: none;
  height: 100%;
  display: flex;
}
@media (max-width: 720px) {
  .sidebar-host {
    display: none;
  }
  /* Search has no full-page view any more: overlay the sidebar on small
     screens so results stay reachable. */
  .shell.searching .sidebar-host {
    display: flex;
    position: fixed;
    inset: 0;
    z-index: 30;
  }
  .shell.searching .sidebar-host :deep(.sidebar) {
    width: 100%;
  }
  /* The panel would leave no room for the conversation on a narrow window. */
  .scm-host,
  .resizer.right {
    display: none;
  }
}
.resizer {
  flex: none;
  width: 5px;
  cursor: col-resize;
  touch-action: none;
  background: transparent;
  transition: background 0.12s;
}
.resizer:hover,
.resizer:active {
  background: var(--accent);
  opacity: 0.5;
}
@media (max-width: 720px) {
  .resizer {
    display: none;
  }
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.topbar {
  position: relative;
  z-index: 2;
  height: var(--header-height);
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  background: color-mix(in srgb, var(--bg) 85%, transparent);
  backdrop-filter: blur(8px);
}
/* Fade the top of the conversation toward the header. */
.topbar::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  height: 14px;
  background: linear-gradient(to bottom, var(--bg), transparent);
  pointer-events: none;
  z-index: 1;
}
.title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.stats {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.stat {
  cursor: default;
  white-space: nowrap;
}
.stat:hover {
  color: var(--text-muted);
}
.stat.warn {
  color: var(--accent);
}
.stat-divider {
  opacity: 0.5;
}
.theme-btn,
.share-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
}
.theme-btn {
  margin-left: 12px;
}
.theme-btn:hover,
.share-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.share-btn.copied,
.share-btn.active {
  color: #4ade80;
}
.bottom {
  position: relative;
  flex: none;
}
/* Fade the conversation out as it approaches the composer. */
.bottom::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: -10px;
  height: 10px;
  background: linear-gradient(to bottom, transparent, var(--bg));
  pointer-events: none;
  z-index: 1;
}
.error-banner {
  max-width: var(--content-width);
  margin: 0 auto 10px;
  width: calc(100% - 40px);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, var(--danger) 45%, transparent);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
  border-radius: var(--radius-sm);
  font-size: 13px;
}
.error-banner span {
  flex: 1;
}
.error-banner button {
  background: transparent;
  border: none;
  color: inherit;
  display: inline-flex;
}
</style>
