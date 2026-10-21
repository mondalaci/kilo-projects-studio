import { computed, ref } from "vue"
import { desktopBridge } from "@/api/desktop"

/**
 * The workspace file index behind the incremental file search (Ctrl+P).
 *
 * The list is fetched lazily, the first time a search is opened for a project,
 * and cached per directory — walking a large tree on every project switch would
 * be wasted work when most switches never open a search.
 */

const directory = ref<string | null>(null)
const files = ref<string[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const truncated = ref(false)
/** Set once a directory has been read, so an empty result is not re-fetched. */
const loadedFor = ref<string | null>(null)

const bridge = desktopBridge()

export function useFiles() {
  const available = computed(() => Boolean(bridge?.files))
  const total = computed(() => files.value.length)

  /** Load the file list for `dir`, unless it is already cached. */
  async function ensure(dir: string | null | undefined, force = false) {
    const api = bridge?.files
    if (!api || !dir) return
    if (!force && loadedFor.value === dir && directory.value === dir) return

    directory.value = dir
    loading.value = true
    error.value = null
    try {
      const result = await api.list(dir)
      // A slow response for a project the user has left must not clobber the
      // list for the one they are on now.
      if (directory.value !== dir) return
      files.value = result.ok ? result.files : []
      truncated.value = Boolean(result.truncated)
      error.value = result.ok ? null : result.error ?? "Could not list files"
      loadedFor.value = dir
    } catch (err) {
      if (directory.value === dir) error.value = err instanceof Error ? err.message : String(err)
    } finally {
      if (directory.value === dir) loading.value = false
    }
  }

  /** Invalidate the cache so the next search re-reads the tree. */
  function invalidate() {
    loadedFor.value = null
  }

  function reset() {
    directory.value = null
    files.value = []
    loadedFor.value = null
    error.value = null
    truncated.value = false
    loading.value = false
  }

  return { available, files, total, loading, error, truncated, directory, ensure, invalidate, reset }
}
