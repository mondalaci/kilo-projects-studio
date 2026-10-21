<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { FileDiff, RefreshCw } from "lucide-vue-next"
import EditorHeader from "./EditorHeader.vue"
import Spinner from "./Spinner.vue"
import { useFileViewer } from "@/stores/fileViewer"
import { useGit, type GitRow } from "@/stores/git"
import { highlightLines, languageForPath } from "@/utils/highlight"

/**
 * Read-only file view.
 *
 * Opened from the file search (Ctrl+P) for files that have nothing to diff. It
 * is a glance, not an editor: long files are cut off rather than paged in, and
 * the line count is capped so a big file cannot lock up the renderer.
 */
const viewer = useFileViewer()
const git = useGit()
const view = viewer.view

/** Lines past this are not rendered; the DOM cost dwarfs their usefulness. */
const MAX_RENDERED_LINES = 4000

const text = computed(() => view.value?.text ?? "")
const allLines = computed(() => (text.value ? text.value.split("\n") : []))
const shownLines = computed(() => allLines.value.slice(0, MAX_RENDERED_LINES))

/**
 * Highlighted HTML per line, or null when the language is unknown or the file is
 * too large — in which case the lines render as plain text.
 */
const highlighted = computed<string[] | null>(() => {
  if (view.value?.binary || !text.value) return null
  const language = languageForPath(view.value?.path ?? "")
  if (!language) return null
  const lines = highlightLines(shownLines.value.join("\n"), language)
  return lines && lines.length === shownLines.value.length ? lines : null
})

/** The fragment for one line, or null to render it as text. */
function lineHtml(index: number): string | null {
  return highlighted.value?.[index] ?? null
}
const hiddenLines = computed(() => Math.max(0, allLines.value.length - shownLines.value.length))

/** The change row for this file, if it has uncommitted changes. */
const changed = computed<GitRow | null>(() => {
  const path = view.value?.path
  if (!path) return null
  return (
    git.changeRows.value.find((row) => row.path === path) ??
    git.stagedRows.value.find((row) => row.path === path) ??
    null
  )
})

function close() {
  viewer.close()
}

/** Hand the file over to the diff viewer when there is something to compare. */
async function showDiff() {
  const row = changed.value
  if (!row) return
  close()
  await git.open(row)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && view.value) {
    event.stopPropagation()
    close()
  }
}

// A new file starts at the top.
watch(
  () => view.value?.path,
  () => {
    document.querySelector(".file-view .body")?.scrollTo({ top: 0 })
  },
)

onMounted(() => window.addEventListener("keydown", onKeydown))
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown))
</script>

<template>
  <div v-if="view" class="file-view editor-code">
    <EditorHeader :path="view.path" @close="close">
      <template #path-extra>
        <span v-if="view.binary" class="tag">binary</span>
        <span v-else class="tag">{{ allLines.length.toLocaleString() }} lines</span>
      </template>
      <template #actions>
        <button v-if="changed" class="editor-icon" title="Show uncommitted changes" @click="showDiff">
          <FileDiff :size="15" />
        </button>
        <button class="editor-icon" title="Reload file" @click="viewer.reload()"><RefreshCw :size="15" /></button>
      </template>
    </EditorHeader>

    <div v-if="view.loading" class="state"><Spinner :size="18" /></div>
    <div v-else-if="view.error" class="state error">{{ view.error }}</div>
    <div v-else-if="view.binary" class="state">Binary file — nothing to show.</div>

    <div v-else class="body">
      <p v-if="view.truncated" class="notice">Showing the beginning of this file.</p>
      <table class="grid">
        <tbody>
          <tr v-for="(line, index) in shownLines" :key="index">
            <td class="num">{{ index + 1 }}</td>
            <td class="code">
              <span v-if="lineHtml(index)" v-html="lineHtml(index)"></span><template v-else>{{ line }}</template>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="hiddenLines" class="notice">
        {{ hiddenLines.toLocaleString() }} more lines are not shown.
      </p>
    </div>
  </div>
</template>

<style scoped>
.file-view {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.tag {
  flex: none;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  color: var(--text-muted);
}
.state {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--text-muted);
  font-size: 13px;
  padding: 24px;
}
.state.error {
  color: var(--danger);
}
.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 0 24px;
}
.notice {
  margin: 0 14px 10px;
  font-size: 12px;
  color: var(--text-muted);
}
table.grid {
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  min-width: 100%;
}
table.grid td {
  padding: 0 8px 0 4px;
  white-space: pre;
  vertical-align: top;
  border: none;
}
td.num {
  width: 52px;
  padding-right: 10px;
  text-align: right;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
  user-select: none;
  background: var(--bg);
  border-right: 1px solid var(--border);
}
td.code {
  color: var(--text);
}
</style>
