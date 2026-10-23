<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue"
import { Archive, ArchiveRestore, Folder, Trash2, X } from "lucide-vue-next"
import Spinner from "./Spinner.vue"
import type { SessionInfo } from "@/api/types"
import { useApp } from "@/stores/app"
import { relativeTime } from "@/utils/format"

const app = useApp()
const { archived, groups, loading, error } = app.archive

const query = ref("")
const inputEl = ref<HTMLInputElement | null>(null)
const restoring = ref<Set<string>>(new Set())
const deleting = ref<Set<string>>(new Set())
const confirming = ref<string | null>(null)
const actionError = ref<string | null>(null)

const filteredGroups = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return groups.value
  return groups.value
    .map((group) => ({
      ...group,
      sessions: group.sessions.filter((session) => {
        const title = (session.title || "Untitled").toLowerCase()
        return title.includes(needle) || group.directory.toLowerCase().includes(needle)
      }),
    }))
    .filter((group) => group.sessions.length > 0)
})

const total = computed(() => filteredGroups.value.reduce((sum, group) => sum + group.sessions.length, 0))
const all = computed(() => archived.value.length)

function projectName(directory: string) {
  const entry = app.projects.entries.value.find((item) => item.directory === directory)
  if (entry) return entry.name
  const leaf = directory.split("/").filter(Boolean).pop()
  return leaf || directory || "unknown project"
}

function archivedLabel(session: SessionInfo) {
  const stamp = session.time?.archived ?? session.time?.updated
  return stamp ? `archived ${relativeTime(stamp)}` : "archived"
}

function isRestoring(sessionID: string) {
  return restoring.value.has(sessionID)
}

function isDeleting(sessionID: string) {
  return deleting.value.has(sessionID)
}

function isConfirming(sessionID: string) {
  return confirming.value === sessionID
}

function isActive(sessionID: string) {
  return app.sessions.currentID.value === sessionID
}

function view(session: SessionInfo) {
  if (isConfirming(session.id)) return
  void app.viewArchivedSession(session)
}

async function restore(session: SessionInfo) {
  if (isRestoring(session.id)) return
  actionError.value = null
  restoring.value = new Set(restoring.value).add(session.id)
  try {
    await app.restoreSession(session.id, session.location?.directory)
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    const next = new Set(restoring.value)
    next.delete(session.id)
    restoring.value = next
  }
}

function askDelete(sessionID: string) {
  actionError.value = null
  confirming.value = sessionID
}

function cancelDelete() {
  confirming.value = null
}

async function remove(session: SessionInfo) {
  if (isDeleting(session.id)) return
  actionError.value = null
  deleting.value = new Set(deleting.value).add(session.id)
  try {
    await app.deleteSession(session.id, session.location?.directory)
    confirming.value = null
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    const next = new Set(deleting.value)
    next.delete(session.id)
    deleting.value = next
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return
  event.preventDefault()
  if (confirming.value) {
    cancelDelete()
    return
  }
  app.closeArchive()
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown)
  void nextTick(() => inputEl.value?.focus())
})

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown))
</script>

<template>
  <div class="archive-page" role="region" aria-label="Archived conversations">
    <header class="archive-head">
      <span class="archive-title"><Archive :size="15" /> Archived conversations</span>
      <button class="close" title="Close archive (Esc)" @click="app.closeArchive()"><X :size="16" /></button>
    </header>

    <div class="archive-filter">
      <input
        ref="inputEl"
        v-model="query"
        class="filter-input"
        type="search"
        placeholder="Filter archived conversations…"
        spellcheck="false"
        autocomplete="off"
      />
      <button v-if="query" class="clear" title="Clear filter" @click="query = ''"><X :size="14" /></button>
    </div>

    <div class="archive-body">
      <p v-if="loading" class="note"><Spinner :size="11" /> Loading archived conversations…</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <template v-else>
        <p v-if="actionError" class="error">{{ actionError }}</p>

        <section v-for="group in filteredGroups" :key="group.directory" class="group">
          <div class="group-head" :title="group.directory">
            <Folder :size="12" class="folder" />
            <span class="group-name">{{ projectName(group.directory) }}</span>
            <span class="group-count">{{ group.sessions.length }}</span>
          </div>
          <div
            v-for="session in group.sessions"
            :key="session.id"
            class="row"
            :class="{ confirming: isConfirming(session.id), active: isActive(session.id) }"
            role="button"
            tabindex="0"
            @click="view(session)"
            @keydown.enter.prevent="view(session)"
          >
            <template v-if="isConfirming(session.id)">
              <span class="confirm-text">Delete permanently?</span>
              <button class="confirm-cancel" @click.stop="cancelDelete()">Cancel</button>
              <button
                class="confirm-delete"
                :disabled="isDeleting(session.id)"
                :title="isDeleting(session.id) ? 'Deleting…' : 'Delete permanently'"
                @click.stop="remove(session)"
              >
                <Spinner v-if="isDeleting(session.id)" :size="12" />
                <template v-else>Delete</template>
              </button>
            </template>
            <template v-else>
              <span class="title" :title="session.title || 'Untitled'">{{ session.title || "Untitled" }}</span>
              <span class="time">{{ archivedLabel(session) }}</span>
              <button
                class="restore"
                :title="isRestoring(session.id) ? 'Restoring…' : 'Restore conversation'"
                :disabled="isRestoring(session.id)"
                @click.stop="restore(session)"
              >
                <Spinner v-if="isRestoring(session.id)" :size="12" />
                <ArchiveRestore v-else :size="14" />
              </button>
              <button class="delete" title="Delete conversation" @click.stop="askDelete(session.id)">
                <Trash2 :size="14" />
              </button>
            </template>
          </div>
        </section>

        <p v-if="!filteredGroups.length" class="empty">
          {{ query.trim() ? `Nothing matches “${query.trim()}”.` : "No archived conversations." }}
        </p>
      </template>
    </div>

    <footer v-if="!loading && !error" class="archive-foot">
      <span>{{ total }} archived conversation{{ total === 1 ? "" : "s" }}</span>
      <span v-if="query.trim() && total !== all" class="foot-filtered">of {{ all }}</span>
    </footer>
  </div>
</template>

<style scoped>
.archive-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.archive-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 10px 6px;
}
.archive-title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.close,
.clear,
.restore,
.delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
}
.close {
  flex: none;
  padding: 4px;
}
.close:hover,
.clear:hover,
.restore:hover:not(:disabled),
.delete:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}
.restore:hover:not(:disabled) {
  color: var(--accent);
}
.delete:hover:not(:disabled) {
  color: var(--git-deleted);
}
.restore:disabled,
.delete:disabled {
  opacity: 0.6;
}
.clear {
  flex: none;
  padding: 2px;
}
.archive-filter {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  margin: 0 10px 8px;
  padding: 0 8px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
}
.archive-filter:focus-within {
  border-color: var(--accent);
}
.filter-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 13px;
}
.filter-input::-webkit-search-cancel-button {
  display: none;
}
.archive-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px 10px;
}
.group {
  margin-top: 8px;
}
.group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.folder {
  flex: none;
}
.group-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.group-count {
  flex: none;
  font-variant-numeric: tabular-nums;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.row:hover {
  background: var(--bg-hover);
}
.row:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}
.row.active {
  background: var(--bg-active);
}
.row.active .title {
  color: var(--text);
}
.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--text-muted);
}
.time {
  flex: none;
  font-size: 10.5px;
  color: var(--text-faint);
  white-space: nowrap;
}
.restore,
.delete {
  flex: none;
  padding: 3px;
}
.row.confirming {
  background: var(--bg-hover);
}
.confirm-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--git-deleted);
}
.confirm-cancel,
.confirm-delete {
  flex: none;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 11.5px;
  padding: 3px 8px;
}
.confirm-cancel {
  background: transparent;
  color: var(--text-muted);
}
.confirm-cancel:hover {
  background: var(--bg-active);
  color: var(--text);
}
.confirm-delete {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--git-deleted);
  color: #fff;
}
.confirm-delete:hover:not(:disabled) {
  filter: brightness(1.1);
}
.confirm-delete:disabled {
  opacity: 0.7;
}
.note,
.empty,
.error {
  padding: 10px 8px;
  font-size: 11.5px;
  color: var(--text-faint);
}
.error {
  color: var(--git-deleted);
}
.archive-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-faint);
}
.foot-filtered {
  color: var(--text-muted);
}
</style>
