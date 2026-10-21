import { computed, ref } from "vue"
import type { ServerClient } from "@/api/client"
import type { Project, SessionInfo } from "@/api/types"
import { useServer } from "./server"

/**
 * Per-project state for the sidebar.
 *
 * The sidebar lists every project the server knows about with a single
 * conversation each — the newest one — so this store keeps one "latest session"
 * per worktree. Session events feed `applyEvent` so the row keeps tracking the
 * newest conversation without a refetch.
 */

const latest = ref<Record<string, SessionInfo | null>>({})
const loading = ref(false)
const loaded = ref(false)
/** How many projects still need their newest conversation fetched. */
const pending = ref(0)

/** A project together with the conversation the sidebar shows for it. */
export interface ProjectEntry {
  directory: string
  name: string
  project: Project
  session: SessionInfo | null
}

/** The display name of a project: its registered name, else the folder name. */
export function projectName(project: Project): string {
  if (project.name) return project.name
  const path = project.worktree
  if (!path || path === "/") return "root"
  return path.split("/").filter(Boolean).pop() ?? path
}

function newestSession(list: SessionInfo[]): SessionInfo | null {
  const roots = list.filter((session) => !session.parentID)
  if (!roots.length) return null
  return roots.reduce((newest, session) => {
    const a = session.time?.updated ?? session.time?.created ?? 0
    const b = newest.time?.updated ?? newest.time?.created ?? 0
    return a > b ? session : newest
  })
}

/** Run `worker` over `items` with at most `limit` concurrent calls. */
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index])
    }
  })
  await Promise.all(runners)
  return results
}

export function useProjects() {
  const { projects, directory } = useServer()

  /** Projects sorted by name, each with its newest conversation. */
  const entries = computed<ProjectEntry[]>(() =>
    [...projects.value]
      .map((project) => ({
        directory: project.worktree,
        name: projectName(project),
        project,
        session: latest.value[project.worktree] ?? null,
      }))
      .sort((a, b) => {
        // Projects with a conversation come first (newest activity on top), so
        // the list opens on what was worked on most recently.
        const aTime = a.session?.time?.updated ?? a.session?.time?.created ?? 0
        const bTime = b.session?.time?.updated ?? b.session?.time?.created ?? 0
        if (aTime !== bTime) return bTime - aTime
        return a.name.localeCompare(b.name)
      }),
  )

  /** The entry whose conversation changed most recently, if any. */
  const mostRecent = computed<ProjectEntry | null>(() => {
    let best: ProjectEntry | null = null
    let bestTime = -1
    for (const entry of entries.value) {
      const time = entry.session?.time?.updated ?? entry.session?.time?.created ?? 0
      if (entry.session && time > bestTime) {
        best = entry
        bestTime = time
      }
    }
    return best
  })

  /** Conversation shown for a project, if one is known. */
  function latestFor(target: string | null | undefined): SessionInfo | null {
    if (!target) return null
    return latest.value[target] ?? null
  }

  /** Register a freshly created or updated conversation as a project's newest. */
  function setLatest(target: string | null | undefined, session: SessionInfo) {
    if (!target || session.parentID) return
    const current = latest.value[target]
    const next = session.time?.updated ?? session.time?.created ?? 0
    const existing = current?.time?.updated ?? current?.time?.created ?? 0
    if (!current || next >= existing) latest.value = { ...latest.value, [target]: session }
  }

  /**
   * Fetch the newest conversation of every project.
   *
   * One request per project, capped to a handful in flight, because the session
   * endpoint is scoped by `directory`.
   */
  async function load(client: ServerClient) {
    loading.value = true
    pending.value = projects.value.length
    try {
      const list = [...projects.value]
      const results = await mapLimit(list, 6, async (project) => {
        try {
          const sessions = await client.listSessions({ directory: project.worktree, query: { limit: 10 } })
          return [project.worktree, newestSession(sessions)] as const
        } catch {
          return [project.worktree, null] as const
        } finally {
          pending.value = Math.max(0, pending.value - 1)
        }
      })
      const next: Record<string, SessionInfo | null> = {}
      for (const [worktree, session] of results) next[worktree] = session
      latest.value = next
      loaded.value = true
    } finally {
      loading.value = false
      pending.value = 0
    }
  }

  /** Re-read one project's newest conversation (after a new chat, say). */
  async function refreshOne(client: ServerClient, target: string) {
    try {
      const sessions = await client.listSessions({ directory: target, query: { limit: 10 } })
      latest.value = { ...latest.value, [target]: newestSession(sessions) }
    } catch {
      /* leave the previous value in place */
    }
  }

  /** Keep a project row on its newest conversation as session events arrive. */
  function applyEvent(type: string, properties: Record<string, unknown> | undefined) {
    if (!properties) return
    if (type === "session.created" || type === "session.updated") {
      const info = properties.info as SessionInfo | undefined
      if (info?.directory && !info.parentID) setLatest(info.directory, info)
    }
  }

  function reset() {
    latest.value = {}
    loaded.value = false
    pending.value = 0
    loading.value = false
  }

  return {
    entries,
    mostRecent,
    latest,
    loading,
    loaded,
    pending,
    /** The project the conversation pane is currently scoped to. */
    current: computed(() => directory.value ?? null),
    projectName,
    latestFor,
    setLatest,
    load,
    refreshOne,
    applyEvent,
    reset,
  }
}
