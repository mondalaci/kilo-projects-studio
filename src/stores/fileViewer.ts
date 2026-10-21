import { ref } from "vue"
import { desktopBridge } from "@/api/desktop"

/**
 * Read-only file view, shown in the centre pane when a file is opened from the
 * file search (Ctrl+P) and it has no uncommitted changes to diff.
 */

export interface FileView {
  path: string
  loading: boolean
  error: string | null
  text: string
  binary: boolean
  size: number
  truncated: boolean
}

const view = ref<FileView | null>(null)
const bridge = desktopBridge()
/** The project the open file belongs to, so a reload needs no arguments. */
let openedFrom: string | null = null
/** Guards against a slow read landing after the user moved on. */
let seq = 0

export function useFileViewer() {
  async function open(dir: string | null | undefined, path: string) {
    const api = bridge?.files
    const current = ++seq
    view.value = { path, loading: true, error: null, text: "", binary: false, size: 0, truncated: false }
    if (!api || !dir) {
      view.value = { ...view.value, loading: false, error: "Reading files needs the desktop app" }
      return
    }
    openedFrom = dir
    try {
      const result = await api.read({ dir, path })
      if (current !== seq) return
      view.value = {
        path,
        loading: false,
        error: result.ok ? null : result.error ?? "Could not read the file",
        text: result.text ?? "",
        binary: Boolean(result.binary),
        size: result.size ?? 0,
        truncated: Boolean(result.truncated),
      }
    } catch (err) {
      if (current !== seq) return
      view.value = {
        path,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        text: "",
        binary: false,
        size: 0,
        truncated: false,
      }
    }
  }

  /** Re-read the open file. */
  async function reload() {
    if (view.value && openedFrom) await open(openedFrom, view.value.path)
  }

  function close() {
    seq++
    view.value = null
    openedFrom = null
  }

  return { view, open, reload, close }
}
