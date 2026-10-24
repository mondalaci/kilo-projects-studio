<script setup lang="ts">
import { computed, ref } from "vue"
import { Archive, MessageSquarePlus, Search } from "lucide-vue-next"
import ShortcutBadge from "./ShortcutBadge.vue"
import iconUrl from "../../build/icon.png"
import ProjectsPanel from "./ProjectsPanel.vue"
import SidebarSearch from "./SidebarSearch.vue"
import ArchivePanel from "./ArchivePanel.vue"
import { archiveOpen } from "@/stores/archive"
import { useApp } from "@/stores/app"
import { openSearch, searchOpen } from "@/stores/search"

const app = useApp()
const { newChat, openArchive } = app

/** How many projects the list holds; shown next to the header label. */
const projectCount = computed(() => app.projects.entries.value.length)

</script>

<template>
  <aside class="sidebar">
    <SidebarSearch v-if="searchOpen" />
    <ArchivePanel v-else-if="archiveOpen" />
    <template v-else>
      <header class="head drag-region">
        <img class="logo" :src="iconUrl" alt="" />
        <span class="brand">Projects<ShortcutBadge placement="below" modifier="ctrl" key-label="R" /></span>
        <span class="brand-count" :title="`${projectCount} projects`">{{ projectCount }}</span>
        <button class="icon" title="Search conversations (Alt+F)" @click="openSearch()">
          <Search :size="16" />
          <ShortcutBadge placement="inside" modifier="alt" key-label="F" />
        </button>
        <button class="icon" title="Archived conversations" @click="openArchive()">
          <Archive :size="16" />
        </button>
        <button class="icon" title="New chat (Alt+N)" @click="newChat()">
          <MessageSquarePlus :size="17" />
          <ShortcutBadge placement="inside" modifier="alt" key-label="N" />
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
  /* A containing block for the key badges on the header's buttons, and a layer
     above the list below so a badge hanging past the header stays visible. */
  position: relative;
  z-index: 1;
  /* Matches the conversation header height so the top strip is one band. */
  flex: none;
  height: var(--header-height);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
}
.logo {
  /* The app icon itself — the same file the window and the tray use — so the
     header carries no second drawing of the logo to keep in step. */
  flex: none;
  width: 26px;
  height: 26px;
  display: block;
}
.brand {
  position: relative;
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
  /* A containing block for its key badge, or the badge anchors to the header and
     lands on top of its neighbour's. */
  position: relative;
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
