<script setup lang="ts">
import { computed, ref } from "vue"
import { LogOut, MessageSquarePlus, Moon, Search, Sun } from "lucide-vue-next"
import ProjectsPanel from "./ProjectsPanel.vue"
import SidebarSearch from "./SidebarSearch.vue"
import ToolsRow from "./ToolsRow.vue"
import { useApp } from "@/stores/app"
import { theme, toggleTheme } from "@/theme"
import { shortcutsVisible } from "@/stores/shortcuts"
import { openSearch, searchOpen } from "@/stores/search"

const app = useApp()
const { connected, connectError } = app.connection
const { live, connecting } = app.live
const { isBusy } = app.chat
const { newChat, disconnect } = app

/** How many projects the list holds; shown next to the header label. */
const projectCount = computed(() => app.projects.entries.value.length)

type ConnectionState = "offline" | "connecting" | "working" | "live" | "reconnecting"
const connectionState = computed<ConnectionState>(() => {
  if (!connected.value) return "offline"
  if (connecting.value) return "connecting"
  if (isBusy.value) return "working"
  if (live.value) return "live"
  return "reconnecting"
})
</script>

<template>
  <aside class="sidebar">
    <SidebarSearch v-if="searchOpen" />
    <template v-else>
      <header class="head drag-region">
        <span class="logo">K</span>
        <span class="brand">Projects</span>
        <span class="brand-count" :title="`${projectCount} projects`">{{ projectCount }}</span>
        <button class="icon" title="Search conversations (Alt+F)" @click="openSearch()">
          <Search :size="16" />
          <kbd v-if="shortcutsVisible" class="kbd floating">F</kbd>
        </button>
        <button class="icon" title="New chat (Alt+N)" @click="newChat()">
          <MessageSquarePlus :size="17" />
          <kbd v-if="shortcutsVisible" class="kbd floating">N</kbd>
        </button>
      </header>

      <ProjectsPanel />

      <ToolsRow />

      <footer class="foot">
        <div class="foot-actions">
          <button class="icon" :title="theme === 'dark' ? 'Light theme' : 'Dark theme'" @click="toggleTheme()">
            <Sun v-if="theme === 'dark'" :size="16" />
            <Moon v-else :size="16" />
          </button>
          <button class="icon" title="Disconnect" @click="disconnect()"><LogOut :size="16" /></button>
        </div>
        <!-- The origin and live status are only interesting when they change, so
             nothing is shown while the connection is healthy. -->
        <span
          v-if="connectionState !== 'live'"
          class="conn-warning"
          :class="connectionState"
          :title="connectError ?? connected?.origin ?? 'Not connected'"
        ></span>
      </footer>
    </template>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  flex: none;
  height: 100%;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}
.head {
  /* Matches the conversation header height so the top strip is one band. */
  flex: none;
  height: var(--header-height);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
}
.logo {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--accent);
  color: var(--accent-text);
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 14px;
}
.brand {
  flex: none;
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
}
/* The list's count, in place of the subheader row it used to live in. */
.brand-count {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.foot {
  border-top: 1px solid var(--border);
  padding: 6px 10px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.foot-actions {
  display: flex;
  gap: 6px;
}
/* Shown only while the connection is not healthy; hover reveals the origin. */
.conn-warning {
  margin-left: auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}
.conn-warning.working,
.conn-warning.connecting,
.conn-warning.reconnecting {
  animation: kilo-pulse 1.2s ease-in-out infinite;
}
.conn-warning.offline {
  background: var(--danger);
  animation: none;
}
@keyframes kilo-pulse {
  50% {
    opacity: 0.35;
  }
}
.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-muted);
  padding: 6px;
  border-radius: var(--radius-sm);
}
.icon:hover {
  background: var(--bg-hover);
  color: var(--text);
}
</style>
