import { computed, ref } from "vue"
import type { GitDiffRequest, GitFileEntry, GitRepoInfo, GitScope } from "@/api/desktop"
import { desktopBridge } from "@/api/desktop"
import { parseDiff, type ParsedDiff } from "@/utils/diff"

/** How often the working tree is re-scanned while the app is in the foreground. */
const POLL_MS = 2500

export type GitGroup = "staged" | "changes"

/** A file as it appears in one of the two panel groups. */
export interface GitRow {
  path: string
  origPath?: string
  group: GitGroup
  /** Single-letter status shown in the row: M, A, D, R, U, … */
  status: string
  scope: GitScope
}

export interface OpenDiff {
  request: GitDiffRequest
  loading: boolean
  error: string | null
  patch: string
  parsed: ParsedDiff
  binary: boolean
  truncated: boolean
}

const EMPTY_DIFF: ParsedDiff = { meta: [], hunks: [], additions: 0, deletions: 0, binary: false, modeOnly: false }

const directory = ref<string | null>(null)
const repo = ref<GitRepoInfo>({ isRepo: false })
const files = ref<GitFileEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const lastUpdated = ref<number | null>(null)
const selection = ref<GitRow | null>(null)
const openDiff = ref<OpenDiff | null>(null)

const bridge = desktopBridge()
const available = ref(Boolean(bridge?.git))

let pollTimer: ReturnType<typeof setInterval> | null = null
/** Guards against an older status response overwriting a newer one. */
let statusSeq = 0
let diffSeq = 0

function rowFor(entry: GitFileEntry, group: GitGroup): GitRow | null {
  if (group === "staged") {
    if (!entry.staged) return null
    return { path: entry.path, origPath: entry.origPath, group, status: entry.index, scope: "staged" }
  }
  if (!entry.unstaged) return null
  return {
    path: entry.path,
    origPath: entry.origPath,
    group,
    status: entry.untracked ? "U" : entry.worktree,
    scope: entry.untracked ? "untracked" : "worktree",
  }
}

const byPath = (a: GitRow, b: GitRow) => a.path.localeCompare(b.path)

/** Files staged for the next commit. */
const stagedRows = computed<GitRow[]>(() =>
  files.value
    .filter((entry) => entry.staged)
    .map((entry) => rowFor(entry, "staged"))
    .filter((row): row is GitRow => row !== null)
    .sort(byPath),
)

/** Files with worktree changes, including untracked files. */
const changeRows = computed<GitRow[]>(() =>
  files.value
    .filter((entry) => entry.unstaged)
    .map((entry) => rowFor(entry, "changes"))
    .filter((row): row is GitRow => row !== null)
    .sort(byPath),
)

const total = computed(() => stagedRows.value.length + changeRows.value.length)

/** True while the app has a usable git bridge and a repository to report on. */
const active = computed(() => available.value && repo.value.isRepo)

export function useGit() {
  /**
   * Read the working-tree status for a directory.
   *
   * `silent` is used by the background poll: it keeps the header spinner for
   * user-initiated refreshes instead of flashing it every few seconds.
   */
  async function refresh(dir?: string | null, opts: { silent?: boolean } = {}) {
    const target = dir ?? directory.value
    if (!target) return
    directory.value = target
    const git = bridge?.git
    if (!git) {
      available.value = false
      repo.value = { isRepo: false, reason: "no directory" }
      files.value = []
      return
    }

    const seq = ++statusSeq
    if (!opts.silent) loading.value = true
    try {
      const result = await git.status(target)
      if (seq !== statusSeq) return
      repo.value = {
        isRepo: Boolean(result.isRepo),
        reason: result.reason,
        root: result.root,
        name: result.name,
        branch: result.branch,
        head: result.head,
      }
      files.value = Array.isArray(result.files) ? result.files : []
      error.value = result.error ?? null
      lastUpdated.value = Date.now()
      reconcileSelection()
    } catch (err) {
      if (seq === statusSeq) error.value = err instanceof Error ? err.message : String(err)
    } finally {
      if (!opts.silent && seq === statusSeq) loading.value = false
    }
  }

  /**
   * Keep the open diff honest as the working tree changes:
   * - same group: re-read the patch so the view stays live;
   * - the file moved group (staged here, changed there): follow it, which is
   *   what an editor does when you stage the file you are looking at;
   * - the change is gone: close the diff rather than show stale text.
   */
  function reconcileSelection() {
    const selected = selection.value
    if (!selected) return
    const staged = stagedRows.value.find((row) => row.path === selected.path)
    const changed = changeRows.value.find((row) => row.path === selected.path)
    const same = selected.group === "staged" ? staged : changed
    if (same) {
      void loadDiff(selected, { silent: true })
      return
    }
    const moved = selected.group === "staged" ? changed : staged
    if (moved) {
      void open(moved)
      return
    }
    closeDiff()
  }

  /** Switch the panel to another repository and refresh immediately. */
  async function setDirectory(dir: string | null) {
    if (directory.value === dir) return
    closeDiff()
    selection.value = null
    files.value = []
    repo.value = { isRepo: false }
    directory.value = dir
    if (dir) await refresh(dir)
  }

  async function loadDiff(row: GitRow, opts: { silent?: boolean } = {}) {
    const target = directory.value
    const git = bridge?.git
    if (!target || !git) return

    const request: GitDiffRequest = { dir: target, path: row.path, scope: row.scope }
    const seq = ++diffSeq
    // A silent re-read (the periodic refresh of an already-open diff) must not
    // flip the view into its loading state, or the diff would blank out on every
    // poll; the new patch simply replaces the old one when it arrives.
    if (!opts.silent) {
      openDiff.value = {
        request,
        loading: true,
        error: null,
        patch: "",
        parsed: EMPTY_DIFF,
        binary: false,
        truncated: false,
      }
    }

    try {
      const result = await git.diff(request)
      if (seq !== diffSeq) return
      const patch = result.patch ?? ""
      openDiff.value = {
        request,
        loading: false,
        error: result.ok ? null : result.error ?? "Could not read the diff",
        patch,
        parsed: result.ok ? parseDiff(patch) : EMPTY_DIFF,
        binary: Boolean(result.binary),
        truncated: Boolean(result.truncated),
      }
    } catch (err) {
      if (seq !== diffSeq) return
      openDiff.value = {
        request,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        patch: "",
        parsed: EMPTY_DIFF,
        binary: false,
        truncated: false,
      }
    }
  }

  /** Open the diff for a row, reusing the view when the same row is clicked. */
  async function open(row: GitRow) {
    const same = selection.value?.path === row.path && selection.value?.scope === row.scope
    selection.value = row
    if (same && openDiff.value && !openDiff.value.loading) return
    await loadDiff(row)
  }

  function closeDiff() {
    selection.value = null
    openDiff.value = null
    diffSeq++
  }

  /** Re-read the open patch (used by the viewer's refresh action). */
  async function reloadDiff() {
    const selected = selection.value
    if (selected) await loadDiff(selected)
  }

  async function stage(row: GitRow) {
    const target = directory.value
    if (!target || !bridge?.git) return
    const result = await bridge.git.stage({ dir: target, path: row.path })
    if (!result.ok) error.value = result.error ?? "git add failed"
    await refresh(target)
  }

  async function unstage(row: GitRow) {
    const target = directory.value
    if (!target || !bridge?.git) return
    const result = await bridge.git.unstage({ dir: target, path: row.path })
    if (!result.ok) error.value = result.error ?? "git reset failed"
    await refresh(target)
  }

  function startPolling(dir: string) {
    stopPolling()
    pollTimer = setInterval(() => {
      // No point scanning while the window is hidden; the next visible tick
      // picks up whatever changed in the meantime.
      if (document.hidden) return
      void refresh(dir, { silent: true })
    }, POLL_MS)
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
  }

  function reset() {
    stopPolling()
    directory.value = null
    repo.value = { isRepo: false }
    files.value = []
    error.value = null
    lastUpdated.value = null
    closeDiff()
  }

  return {
    available,
    active,
    directory,
    repo,
    files,
    stagedRows,
    changeRows,
    total,
    loading,
    error,
    lastUpdated,
    selection,
    openDiff,
    refresh,
    setDirectory,
    open,
    closeDiff,
    reloadDiff,
    stage,
    unstage,
    startPolling,
    stopPolling,
    reset,
  }
}
