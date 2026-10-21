<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { Columns2, RefreshCw, Rows3 } from "lucide-vue-next"
import EditorHeader from "./EditorHeader.vue"
import Spinner from "./Spinner.vue"
import { useGit } from "@/stores/git"
import { toSplitRows, type DiffHunk, type DiffLine } from "@/utils/diff"
import { highlightHunks, languageForPath } from "@/utils/highlight"

const git = useGit()
const { openDiff, selection } = git

/** Split (side-by-side) is the default, matching an editor's diff tab. */
const view = ref<"split" | "unified">("split")
const bodyEl = ref<HTMLElement | null>(null)

const diff = computed(() => openDiff.value)
const parsed = computed(() => diff.value?.parsed ?? null)
const hunks = computed<DiffHunk[]>(() => parsed.value?.hunks ?? [])
const path = computed(() => diff.value?.request.path ?? "")

const scopeLabel = computed(() => {
  switch (diff.value?.request.scope) {
    case "staged":
      return "Staged"
    case "untracked":
      return "Untracked"
    default:
      return "Unstaged"
  }
})

const hasContent = computed(() => Boolean(parsed.value && parsed.value.hunks.length))
const emptyNote = computed(() => {
  if (parsed.value?.binary) return "Binary file — no textual diff."
  if (parsed.value?.modeOnly) return "No textual changes (file mode changed only)."
  return "This file has no changes in this group."
})

/** The old/new columns for the split view, per hunk. */
const splitHunks = computed(() => hunks.value.map((hunk) => ({ hunk, rows: toSplitRows(hunk.lines) })))

const highlighted = computed(() => highlightHunks(hunks.value, languageForPath(path.value)))

/**
 * The highlighted fragment for one cell, or null to render plain text. The side
 * matters: a deleted line only exists on the old side, an added one on the new.
 */
function lineHtml(line: DiffLine | null, side: "old" | "new"): string | null {
  const maps = highlighted.value
  if (!maps || !line || line.type === "note") return null
  const number = side === "old" ? line.oldNo : line.newNo
  if (number === null) return null
  return (side === "old" ? maps.old : maps.new).get(number) ?? null
}

const lineClass = (line: DiffLine | null) =>
  line ? `line-${line.type === "note" ? "note" : line.type}` : "line-empty"

function close() {
  git.closeDiff()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && openDiff.value) {
    event.stopPropagation()
    close()
  }
}

// Reset the scroll only when a different file is shown; the periodic re-read of
// the open diff (which is what keeps it live) must not move the viewport.
watch(
  () => `${openDiff.value?.request.path ?? ""}\u0000${openDiff.value?.request.scope ?? ""}`,
  () => {
    bodyEl.value?.scrollTo({ top: 0 })
  },
)

onMounted(() => window.addEventListener("keydown", onKeydown))
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown))
</script>

<template>
  <div v-if="diff" class="diff-view editor-code">
    <EditorHeader :path="path" @close="close">
      <template #path-extra>
        <span class="scope" :class="diff.request.scope">{{ scopeLabel }}</span>
      </template>
      <template #actions>
        <div v-if="parsed" class="stat" :title="`${parsed.additions} added, ${parsed.deletions} removed`">
          <span class="add">+{{ parsed.additions }}</span>
          <span class="del">−{{ parsed.deletions }}</span>
        </div>
        <button
          class="editor-icon"
          :title="view === 'split' ? 'Switch to unified view' : 'Switch to split view'"
          @click="view = view === 'split' ? 'unified' : 'split'"
        >
          <Rows3 v-if="view === 'split'" :size="15" />
          <Columns2 v-else :size="15" />
        </button>
        <button class="editor-icon" title="Reload diff" @click="git.reloadDiff()"><RefreshCw :size="15" /></button>
      </template>
    </EditorHeader>

    <div v-if="diff.loading" class="state"><Spinner :size="18" /></div>
    <div v-else-if="diff.error" class="state error">{{ diff.error }}</div>
    <div v-else-if="!hasContent" class="state">{{ emptyNote }}</div>

    <div v-else ref="bodyEl" class="diff-body">
      <p v-if="diff.truncated" class="truncated">Patch truncated — the diff is larger than the viewer shows.</p>

      <!-- Split (side-by-side) view -->
      <template v-if="view === 'split'">
        <section v-for="(group, index) in splitHunks" :key="`s${index}`" class="hunk">
          <div class="hunk-head">{{ group.hunk.header }}</div>
          <table class="grid split">
            <tbody>
              <tr v-for="(row, rowIndex) in group.rows" :key="rowIndex">
                <template v-if="row.kind === 'note'">
                  <td class="note" colspan="4">{{ row.text }}</td>
                </template>
                <template v-else>
                  <td class="num">{{ row.left?.oldNo ?? "" }}</td>
                  <td :class="lineClass(row.left)">
                    <span class="sign">{{ row.left?.type === "del" ? "−" : " " }}</span><span
                      v-if="lineHtml(row.left, 'old')"
                      class="code"
                      v-html="lineHtml(row.left, 'old')"
                    ></span><template v-else>{{ row.left?.text ?? "" }}</template>
                  </td>
                  <td class="num">{{ row.right?.newNo ?? "" }}</td>
                  <td :class="lineClass(row.right)">
                    <span class="sign">{{ row.right?.type === "add" ? "+" : " " }}</span><span
                      v-if="lineHtml(row.right, 'new')"
                      class="code"
                      v-html="lineHtml(row.right, 'new')"
                    ></span><template v-else>{{ row.right?.text ?? "" }}</template>
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
        </section>
      </template>

      <!-- Unified view -->
      <template v-else>
        <section v-for="(hunk, index) in hunks" :key="`u${index}`" class="hunk">
          <div class="hunk-head">{{ hunk.header }}</div>
          <table class="grid unified">
            <tbody>
              <tr v-for="(line, lineIndex) in hunk.lines" :key="lineIndex">
                <template v-if="line.type === 'note'">
                  <td class="note" colspan="3">{{ line.text }}</td>
                </template>
                <template v-else>
                  <td class="num">{{ line.oldNo ?? "" }}</td>
                  <td class="num">{{ line.newNo ?? "" }}</td>
                  <td :class="lineClass(line)">
                    <span class="sign">{{ line.type === "add" ? "+" : line.type === "del" ? "−" : " " }}</span><span
                      v-if="lineHtml(line, line.type === 'del' ? 'old' : 'new')"
                      class="code"
                      v-html="lineHtml(line, line.type === 'del' ? 'old' : 'new')"
                    ></span><template v-else>{{ line.text }}</template>
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
        </section>
      </template>
    </div>

    <footer v-if="selection" class="diff-foot">
      <span class="foot-path" :title="selection.path">{{ selection.path }}</span>
      <span v-if="selection.origPath" class="foot-rename">renamed from {{ selection.origPath }}</span>
    </footer>
  </div>
</template>

<style scoped>
.diff-view {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.scope {
  flex: none;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  color: var(--text-muted);
}
.scope.staged {
  color: #35c06a;
  border-color: color-mix(in srgb, #35c06a 45%, transparent);
}
.stat {
  flex: none;
  display: flex;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.stat .add {
  color: #35c06a;
}
.stat .del {
  color: #ef6b6b;
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
.diff-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 0 24px;
}
.truncated {
  margin: 0 14px 10px;
  font-size: 12px;
  color: var(--accent);
}
.hunk + .hunk {
  margin-top: 14px;
}
.hunk-head {
  position: sticky;
  top: 0;
  z-index: 1;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  background: color-mix(in srgb, var(--bg) 92%, var(--accent));
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  padding: 2px 12px;
}
table.grid {
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  min-width: 100%;
}
/* Auto table layout (the default) is deliberate: columns size to their widest
   line, so a long line widens the table and the body scrolls horizontally
   instead of clipping or wrapping the code out of alignment. */
table.grid td {
  padding: 0 8px 0 4px;
  white-space: pre;
  vertical-align: top;
  border: none;
}
td.num {
  width: 46px;
  padding-right: 8px;
  text-align: right;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
  user-select: none;
  background: var(--bg);
  border-right: 1px solid var(--border);
}
td.line-context {
  color: var(--text);
}
td.line-add {
  background: rgba(53, 192, 106, 0.14);
  color: var(--text);
}
td.line-del {
  background: rgba(239, 107, 107, 0.14);
  color: var(--text);
}
td.line-empty {
  background: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 6px,
    color-mix(in srgb, var(--border) 45%, transparent) 6px,
    color-mix(in srgb, var(--border) 45%, transparent) 7px
  );
}
td.line-note {
  color: var(--text-faint);
  font-style: italic;
}
.sign {
  display: inline-block;
  width: 1ch;
  color: var(--text-faint);
  user-select: none;
}
td.line-add .sign {
  color: #35c06a;
}
td.line-del .sign {
  color: #ef6b6b;
}
td.note {
  color: var(--text-faint);
  font-style: italic;
  padding-left: 12px;
}
.diff-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 14px;
  border-top: 1px solid var(--border);
  background: var(--bg-elevated);
  font-size: 11px;
  color: var(--text-faint);
}
.foot-path {
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.foot-rename {
  flex: none;
  color: var(--accent);
}
</style>
