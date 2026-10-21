<script setup lang="ts">
import { computed, ref } from "vue"
import { MessageSquarePlus, Search } from "lucide-vue-next"
import ProjectsPanel from "./ProjectsPanel.vue"
import SidebarSearch from "./SidebarSearch.vue"
import { useApp } from "@/stores/app"
import { shortcutsVisible } from "@/stores/shortcuts"
import { openSearch, searchOpen } from "@/stores/search"

const app = useApp()
const { newChat } = app

/** How many projects the list holds; shown next to the header label. */
const projectCount = computed(() => app.projects.entries.value.length)

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
