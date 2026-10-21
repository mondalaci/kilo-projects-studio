<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "reka-ui"
import { Folder, GitBranch, MessageSquare, MoreHorizontal, Pencil, Trash2 } from "lucide-vue-next"
import FilterBar from "./FilterBar.vue"
import Spinner from "./Spinner.vue"
import { useApp } from "@/stores/app"
import { filterTarget, stopFilter } from "@/stores/filter"
import type { ProjectEntry } from "@/stores/projects"
import { useSessionState } from "@/stores/sessionState"
import { openRequests } from "@/stores/shortcuts"
import { relativeTime } from "@/utils/format"
import { fuzzyMatch } from "@/utils/fuzzy"

const app = useApp()
const { entries, loading, pending, current } = app.projects
const { openProject, removeSession, renameSession } = app
const { stateFor, reasonFor } = useSessionState()

/** The project whose conversation title is being edited inline. */
const editing = ref<string | null>(null)
const editTitle = ref("")
const editInput = ref<HTMLInputElement | null>(null)

/** Incremental filter over the projects (Ctrl+R). */
const query = ref("")
/** Index into the filtered list that Enter opens. */
const cursor = ref(0)

const filtering = computed(() => filterTarget.value === "projects")

/** Projects matching the query: by name first, then by directory. */
const filtered = computed<ProjectEntry[]>(() => {
  const raw = query.value.trim()
  if (!raw) return entries.value

  const hits: Array<{ entry: ProjectEntry; score: number }> = []
  for (const entry of entries.value) {
    const byName = fuzzyMatch(raw, entry.name)
    if (byName) {
      hits.push({ entry, score: byName.score })
      continue
    }
    const byPath = fuzzyMatch(raw, entry.directory)
    if (byPath) hits.push({ entry, score: byPath.score - 40 })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.map((hit) => hit.entry)
})

// A new query re-opens the cursor on the best match.
watch(query, () => {
  cursor.value = 0
})

function moveCursor(delta: number) {
  cursor.value = Math.min(filtered.value.length - 1, Math.max(0, cursor.value + delta))
}

function openCursor() {
  const entry = filtered.value[cursor.value]
  if (entry) void openProject(entry.directory)
  closeFilter()
}

function closeFilter() {
  query.value = ""
  stopFilter()
}

function isActive(entry: ProjectEntry) {
  return entry.directory === current.value
}

/** Whether a project's newest conversation is still being fetched. */
function isPending(entry: ProjectEntry) {
  return !entry.session && loading.value && pending.value > 0
}

function conversationTitle(entry: ProjectEntry) {
  return entry.session ? entry.session.title || "Untitled" : "No conversation yet"
}

function conversationTime(entry: ProjectEntry) {
  return relativeTime(entry.session?.time?.updated ?? entry.session?.time?.created)
}

function isGitProject(entry: ProjectEntry) {
  return entry.project.vcs === "git"
}

/** The state dot for a project's conversation. */
function conversationState(entry: ProjectEntry) {
  return stateFor(entry.session?.id)
}

function conversationStateTitle(entry: ProjectEntry) {
  return entry.session ? reasonFor(entry.session.id) : "no conversation"
}

/* ------------------------------- inline rename ------------------------------ */

function setRenameInput(el: Element | { $el?: Element } | null) {
  if (!el) {
    editInput.value = null
    return
  }
  const node = (el as { $el?: Element }).$el ?? (el as Element)
  editInput.value = node instanceof HTMLInputElement ? node : null
}

async function startRename(entry: ProjectEntry) {
  if (!entry.session) return
  editing.value = entry.directory
  editTitle.value = entry.session.title || ""
  await nextTick()
  editInput.value?.focus()
  editInput.value?.select()
}

async function commitRename() {
  const directory = editing.value
  const entry = entries.value.find((item) => item.directory === directory)
  const session = entry?.session
  editing.value = null
  const title = editTitle.value.trim()
  if (!session || !title || title === session.title) return
  // Rename against the conversation's own project, so a row that is not the
  // active project can be renamed without switching the whole app over to it.
  await renameSession(session.id, title, entry.directory)
}

function cancelRename() {
  editing.value = null
}

/* ------------------------------- list keyboard nav ------------------------------- */

function scrollNavIntoView() {
  const items = navEl.value?.querySelectorAll<HTMLElement>(".project")
  items?.[navIndex.value]?.scrollIntoView({ block: "nearest" })
}

const navEl = ref<HTMLElement | null>(null)
/** Index of the arrow-key cursor in the list, or -1 when inactive. */
const navIndex = ref(-1)

// Alt+P / Alt+S drop the cursor onto the active project.
watch(
  () => [openRequests.project, openRequests.sessions],
  () => {
    if (!entries.value.length) return
    const index = entries.value.findIndex((entry) => isActive(entry))
    navIndex.value = index >= 0 ? index : 0
    void nextTick(() => {
      navEl.value?.focus()
      scrollNavIntoView()
    })
  },
)

function endNav() {
  navIndex.value = -1
}

function move(delta: number) {
  navIndex.value = Math.min(entries.value.length - 1, Math.max(0, navIndex.value + delta))
  void nextTick(scrollNavIntoView)
}

function onKeydown(event: KeyboardEvent) {
  if (navIndex.value < 0) return
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault()
      move(1)
      break
    case "ArrowUp":
      event.preventDefault()
      move(-1)
      break
    case "Home":
      event.preventDefault()
      navIndex.value = 0
      void nextTick(scrollNavIntoView)
      break
    case "End":
      event.preventDefault()
      navIndex.value = entries.value.length - 1
      void nextTick(scrollNavIntoView)
      break
    case "Enter": {
      event.preventDefault()
      const entry = entries.value[navIndex.value]
      if (entry) void openProject(entry.directory)
      endNav()
      break
    }
    case "Escape":
      event.preventDefault()
      endNav()
      break
    default:
      break
  }
}
</script>

<template>
  <div class="projects-wrap">
    <FilterBar
      v-if="filtering"
      target="projects"
      placeholder="Filter projects…"
      :shown="filtered.length"
      :total="entries.length"
      @update:query="query = $event"
      @move="moveCursor"
      @open="openCursor"
      @close="closeFilter"
    />

    <nav ref="navEl" class="projects" tabindex="-1" @keydown="onKeydown" @blur="endNav">
      <div
        v-for="(entry, index) in filtered"
        :key="entry.directory"
        class="project"
        :class="{
          active: isActive(entry),
          'kb-active': index === navIndex,
          'cursor-active': filtering && index === cursor,
        }"
        :title="entry.directory"
      >
        <button class="project-hit" @click="openProject(entry.directory)">
          <span class="line">
            <Folder :size="13" class="folder" />
            <span class="name">{{ entry.name }}</span>
            <GitBranch v-if="isGitProject(entry)" :size="12" class="git" />
            <Spinner v-if="isPending(entry)" :size="11" />
            <span v-else class="time">{{ conversationTime(entry) }}</span>
          </span>
          <span class="line conversation">
            <span
              class="state-dot"
              :class="conversationState(entry)"
              :title="conversationStateTitle(entry)"
            ></span>
            <input
              v-if="editing === entry.directory"
              :ref="setRenameInput"
              v-model="editTitle"
              class="rename"
              @click.stop
              @keydown.enter.prevent="commitRename"
              @keydown.esc.prevent="cancelRename"
              @blur="commitRename"
            />
            <span v-else class="chat-title">{{ conversationTitle(entry) }}</span>
          </span>
        </button>

        <DropdownMenuRoot v-if="entry.session && editing !== entry.directory">
          <DropdownMenuTrigger as-child>
            <span class="project-menu" title="Conversation actions" @click.stop><MoreHorizontal :size="14" /></span>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent class="kilo-menu" :side-offset="4" align="start">
              <DropdownMenuItem class="kilo-menu-item" @select="startRename(entry)">
                <Pencil :size="14" /> Rename conversation
              </DropdownMenuItem>
              <DropdownMenuSeparator class="kilo-menu-sep" />
              <DropdownMenuItem
                class="kilo-menu-item danger"
                @select="entry.session && removeSession(entry.session.id, entry.directory)"
              >
                <Trash2 :size="14" /> Delete conversation
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
      </div>

      <p v-if="!filtered.length && !loading" class="empty">
        {{ query ? `Nothing matches “${query}”.` : "No projects." }}
      </p>
    </nav>
  </div>
</template>

<style scoped>
.projects-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.projects {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  outline: none;
}
.project {
  position: relative;
  border-radius: var(--radius-sm);
}
.project:hover {
  background: var(--bg-hover);
}
.project.active {
  background: var(--bg-active);
}
.project.kb-active {
  box-shadow: inset 0 0 0 2px var(--accent);
}
.project.cursor-active {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
}
.project-hit {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 9px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  text-align: left;
  width: 100%;
  min-width: 0;
}
.line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.folder {
  flex: none;
  color: var(--text-muted);
}
.project.active .folder {
  color: var(--accent);
}
.name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.git {
  flex: none;
  color: var(--text-faint);
}
.time {
  flex: none;
  font-size: 10.5px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.conversation {
  padding-left: 19px;
}
/* Conversation state: the traffic light that the tray badge rolls up. */
.state-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #9b9b9b;
}
.state-dot.blocked {
  background: #e5484d;
}
.state-dot.working {
  background: #f5a623;
}
.state-dot.done {
  background: #35c06a;
}
.state-dot.idle {
  background: #9b9b9b;
}
.state-dot.working {
  animation: kilo-pulse 1.4s ease-in-out infinite;
}
@keyframes kilo-pulse {
  50% {
    opacity: 0.35;
  }
}
.chat-title {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project.active .chat-title {
  color: var(--text);
}
.rename {
  flex: 1;
  min-width: 0;
  background: var(--bg-input);
  border: 1px solid var(--accent);
  border-radius: 5px;
  padding: 1px 5px;
  font-size: 11.5px;
  color: var(--text);
  outline: none;
}
/* The actions button sits over the timestamp and shows on hover. */
.project-menu {
  position: absolute;
  top: 5px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  color: var(--text-muted);
  background: var(--bg-active);
  opacity: 0;
}
.project:hover .project-menu {
  opacity: 1;
}
.project-menu:hover {
  color: var(--text);
}
.empty {
  text-align: center;
  padding: 22px 6px;
  font-size: 12.5px;
  color: var(--text-faint);
}
</style>
