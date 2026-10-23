import { computed, ref } from "vue"
import type { ServerClient } from "@/api/client"
import type { SessionInfo } from "@/api/types"

/** Whether the dedicated archived-conversations page is open. */
export const archiveOpen = ref(false)

const archived = ref<SessionInfo[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

export interface ArchiveGroup {
  directory: string
  sessions: SessionInfo[]
  latest: number
}

/** When a conversation was archived; `updated` is a fallback for stale rows. */
function archivedAt(session: SessionInfo): number {
  return session.time?.archived ?? session.time?.updated ?? session.time?.created ?? 0
}

export function useArchive() {
  /** Archived conversations grouped by project, newest archive first. */
  const groups = computed<ArchiveGroup[]>(() => {
    const byDirectory = new Map<string, SessionInfo[]>()
    for (const session of archived.value) {
      if (session.parentID) continue
      const directory = session.location?.directory ?? ""
      const list = byDirectory.get(directory)
      if (list) list.push(session)
      else byDirectory.set(directory, [session])
    }
    return [...byDirectory.entries()]
      .map(([directory, sessions]) => ({
        directory,
        sessions: sessions.sort((a, b) => archivedAt(b) - archivedAt(a)),
        latest: sessions.reduce((max, session) => Math.max(max, archivedAt(session)), 0),
      }))
      .sort((a, b) => b.latest - a.latest)
  })

  async function load(client: ServerClient) {
    loading.value = true
    error.value = null
    try {
      const all = new Map<string, SessionInfo>()
      let cursor: string | undefined
      // Archived conversations are usually few; the page cap is a guard, not a
      // limit. The cursor carries its own direction, so only the first page has
      // no cursor.
      for (let page = 0; page < 25; page++) {
        const res = await client.listSessions({ archived: true, limit: 200, cursor })
        for (const session of res.data) {
          if (!session.parentID) all.set(session.id, session)
        }
        const next = res.cursor?.next
        if (!next) break
        cursor = next
      }
      archived.value = [...all.values()]
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      archived.value = []
    } finally {
      loading.value = false
    }
  }

  function remove(sessionID: string) {
    archived.value = archived.value.filter((session) => session.id !== sessionID)
  }

  function reset() {
    archiveOpen.value = false
    archived.value = []
    loading.value = false
    error.value = null
  }

  return { open: archiveOpen, archived, groups, loading, error, load, remove, reset }
}
