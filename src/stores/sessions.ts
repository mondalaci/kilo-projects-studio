import { computed, ref } from "vue"
import type { ServerClient } from "@/api/client"
import type { ModelRef, SessionInfo } from "@/api/types"

const DEFAULT_LIMIT = 50

const sessions = ref<SessionInfo[]>([])
const currentID = ref<string | null>(null)
const loading = ref(false)

function upsert(session: SessionInfo) {
  const index = sessions.value.findIndex((item) => item.id === session.id)
  if (index === -1) {
    sessions.value = [session, ...sessions.value]
  } else {
    const next = sessions.value.slice()
    next[index] = { ...next[index], ...session }
    sessions.value = next
  }
}

export function useSessions() {
  const current = computed(() => sessions.value.find((item) => item.id === currentID.value) ?? null)

  const sorted = computed(() =>
    [...sessions.value].sort((a, b) => (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0)),
  )

  async function load(client: ServerClient, directory?: string, limit = DEFAULT_LIMIT) {
    loading.value = true
    try {
      // The sidebar only needs the newest page. The full list lives behind the
      // search page, which filters server-side so it never renders thousands of
      // rows at once.
      const list = await client.listSessions({ directory, query: { limit } })
      sessions.value = list.filter((session) => !session.parentID)
    } finally {
      loading.value = false
    }
  }

  /** Query conversations without mutating the sidebar (used by the search page). */
  async function query(
    client: ServerClient,
    opts: { directory?: string; search?: string; limit?: number } = {},
  ) {
    const list = await client.listSessions({
      directory: opts.directory,
      query: { limit: opts.limit ?? DEFAULT_LIMIT, search: opts.search },
    })
    return list.filter((session) => !session.parentID)
  }

  async function create(
    client: ServerClient,
    body: { title?: string; agent?: string; model?: ModelRef },
    directory?: string,
  ) {
    const session = await client.createSession(body, { directory })
    upsert(session)
    currentID.value = session.id
    return session
  }

  async function remove(client: ServerClient, sessionID: string, directory?: string) {
    await client.deleteSession(sessionID, { directory })
    sessions.value = sessions.value.filter((item) => item.id !== sessionID)
    if (currentID.value === sessionID) currentID.value = null
  }

  async function rename(client: ServerClient, sessionID: string, title: string, directory?: string) {
    const session = await client.updateSession(sessionID, { title }, { directory })
    upsert(session)
    return session
  }

  function applyEvent(type: string, properties: Record<string, unknown> | undefined) {
    if (!properties) return
    if (type === "session.created" || type === "session.updated") {
      const info = properties.info as SessionInfo | undefined
      if (info && !info.parentID) upsert(info)
    } else if (type === "session.deleted") {
      const id = (properties.sessionID as string) ?? (properties.info as SessionInfo | undefined)?.id
      if (id) {
        sessions.value = sessions.value.filter((item) => item.id !== id)
        if (currentID.value === id) currentID.value = null
      }
    }
  }

  function reset() {
    sessions.value = []
    currentID.value = null
  }

  return { sessions, sorted, current, currentID, loading, load, query, create, remove, rename, applyEvent, reset, upsert }
}