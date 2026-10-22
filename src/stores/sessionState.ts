import { computed, ref } from "vue"
import type { ServerClient } from "@/api/client"
import type { FormInfo, PermissionRequest, ServerEvent } from "@/api/types"
import { useProjects } from "./projects"
import { useServer } from "./server"
import { useSessions } from "./sessions"
import {
  conversationState,
  countsAsUnread,
  rollupProjects,
  rollupTray,
  stateLabel,
  type ConversationState,
  type ProjectRollup,
} from "@/utils/sessionState"

/**
 * Live state for every conversation in every project.
 *
 * The v2 global event stream carries the events of all projects, tagged with
 * their location, so a single subscription keeps the sidebar dots and the tray
 * rollup current. The stream only reports changes, so a bounded poll re-reads
 * the global permission/form lists to repair anything missed while offline.
 */

const UNREAD_KEY = "kilo-projects-studio.unread-sessions"

/** How often the baseline sweep re-reads the global pending lists. */
const SWEEP_MS = 2000

interface SessionSignals {
  status?: string
  /** Pending request that needs the user, with a short reason. */
  blockedReason?: string
}

const signals = ref<Record<string, SessionSignals>>({})
const unread = ref<Set<string>>(loadUnread())
const globalLive = ref(false)

/** Request id → session id, so a reply can clear the right conversation. */
const requestSession = new Map<string, string>()

let sweepTimer: ReturnType<typeof setInterval> | null = null
let detachAttention: (() => void) | null = null
let controller: AbortController | null = null
let activeClient: ServerClient | null = null

function loadUnread(): Set<string> {
  try {
    const raw = localStorage.getItem(UNREAD_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : [])
  } catch {
    return new Set()
  }
}

function persistUnread() {
  try {
    localStorage.setItem(UNREAD_KEY, JSON.stringify([...unread.value]))
  } catch {
    /* storage unavailable */
  }
}

export function useSessionState() {
  const server = useServer()
  const sessions = useSessions()
  const projects = useProjects()

  function unfocused() {
    if (typeof document === "undefined") return false
    return document.hidden || !document.hasFocus()
  }

  function patch(sessionID: string, next: Partial<SessionSignals>) {
    const current = signals.value[sessionID] ?? {}
    signals.value = { ...signals.value, [sessionID]: { ...current, ...next } }
  }

  function setBlocked(sessionID: string, reason: string | undefined) {
    patch(sessionID, { blockedReason: reason })
  }

  function markUnreadIfUnwatched(sessionID: string) {
    if (
      countsAsUnread({ isCurrent: sessions.currentID.value === sessionID, focused: !unfocused() }) &&
      !unread.value.has(sessionID)
    ) {
      unread.value = new Set(unread.value).add(sessionID)
      persistUnread()
    }
  }

  /** Fold one event from the global stream into the state. */
  function applyEvent(event: ServerEvent) {
    const type = event.type
    const data = event.data
    if (!data) return
    const sessionID = data.sessionID as string | undefined

    switch (type) {
      case "session.execution.started":
      case "session.step.started":
        if (sessionID) patch(sessionID, { status: "busy" })
        break
      case "session.status": {
        const status = (data.status as { type?: string } | undefined)?.type
        if (sessionID && status) patch(sessionID, { status })
        break
      }
      case "session.idle":
      case "session.execution.succeeded":
      case "session.execution.failed": {
        if (!sessionID) break
        patch(sessionID, { status: "idle" })
        markUnreadIfUnwatched(sessionID)
        break
      }
      case "session.tool.called":
      case "session.tool.input.started":
        if (sessionID) patch(sessionID, { status: "busy" })
        break
      case "permission.asked": {
        const request = data as unknown as PermissionRequest
        if (request?.id && request.sessionID) {
          requestSession.set(request.id, request.sessionID)
          setBlocked(request.sessionID, `permission: ${request.action}`)
        }
        break
      }
      case "permission.replied":
      case "permission.rejected": {
        const requestID = data.requestID as string | undefined
        const target = (requestID && requestSession.get(requestID)) || sessionID
        if (requestID) requestSession.delete(requestID)
        if (target) setBlocked(target, undefined)
        break
      }
      case "form.created": {
        const form = data as unknown as FormInfo
        if (form?.id && form.sessionID) {
          requestSession.set(form.id, form.sessionID)
          setBlocked(form.sessionID, "question")
        }
        break
      }
      case "form.replied": {
        const requestID = (data.formID as string | undefined) ?? (data.id as string | undefined)
        const target = (requestID && requestSession.get(requestID)) || sessionID
        if (requestID) requestSession.delete(requestID)
        if (target) setBlocked(target, undefined)
        break
      }
      default:
        break
    }

    // The same events also keep every project's newest conversation current.
    if (type === "session.created" || type === "session.updated") {
      const directory = (data.location as { directory?: string } | undefined)?.directory
      if (directory && directory !== server.directory.value) projects.applyEvent(type, data)
    }
  }

  /** Baseline: re-read the global pending permission and form lists. */
  async function sweep() {
    const client = activeClient
    if (!client) return
    try {
      const [permissions, forms] = await Promise.all([
        client.listPermissions().catch(() => [] as PermissionRequest[]),
        client.listForms().catch(() => [] as FormInfo[]),
      ])
      const blocked = new Map<string, string>()
      for (const request of permissions) {
        if (!request?.id || !request.sessionID) continue
        requestSession.set(request.id, request.sessionID)
        blocked.set(request.sessionID, `permission: ${request.action}`)
      }
      for (const form of forms) {
        if (!form?.id || !form.sessionID) continue
        requestSession.set(form.id, form.sessionID)
        blocked.set(form.sessionID, "question")
      }
      const next = { ...signals.value }
      for (const [sessionID, signal] of Object.entries(next)) {
        if (signal.blockedReason && !blocked.has(sessionID)) next[sessionID] = { ...signal, blockedReason: undefined }
      }
      for (const [sessionID, reason] of blocked) next[sessionID] = { ...next[sessionID], blockedReason: reason }
      signals.value = next
    } catch {
      /* the sweep will try again */
    }
  }

  /** Subscribe to the global stream, reconnecting until stopped. */
  async function follow(client: ServerClient) {
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal

    void (async () => {
      while (!signal.aborted) {
        try {
          await client.subscribe((event) => applyEvent(event), {
            signal,
            onOpen: () => {
              globalLive.value = true
              void sweep()
            },
          })
        } catch {
          /* dropped: retry below */
        }
        globalLive.value = false
        if (signal.aborted) break
        await new Promise((resolve) => setTimeout(resolve, 1500))
      }
    })()
  }

  function watchWindow() {
    const acknowledge = () => markSeen(sessions.currentID.value)
    const onVisibility = () => {
      if (!document.hidden) acknowledge()
    }
    window.addEventListener("focus", acknowledge)
    document.addEventListener("visibilitychange", onVisibility)
    detachAttention = () => {
      window.removeEventListener("focus", acknowledge)
      document.removeEventListener("visibilitychange", onVisibility)
      detachAttention = null
    }
  }

  function start(client: ServerClient) {
    stop()
    activeClient = client
    watchWindow()
    void follow(client)
    void sweep()
    sweepTimer = setInterval(() => void sweep(), SWEEP_MS)
  }

  function stop() {
    controller?.abort()
    controller = null
    activeClient = null
    detachAttention?.()
    globalLive.value = false
    if (sweepTimer) clearInterval(sweepTimer)
    sweepTimer = null
  }

  function reset() {
    stop()
    signals.value = {}
    requestSession.clear()
    unread.value = new Set()
    persistUnread()
  }

  function stateFor(sessionID: string | null | undefined): ConversationState {
    if (!sessionID) return "idle"
    const signal = signals.value[sessionID]
    return conversationState({
      blocked: Boolean(signal?.blockedReason),
      status: signal?.status,
      unread: unread.value.has(sessionID),
    })
  }

  function reasonFor(sessionID: string | null | undefined): string {
    if (!sessionID) return "idle"
    const signal = signals.value[sessionID]
    if (signal?.blockedReason) return signal.blockedReason
    return stateLabel(
      conversationState({ status: signal?.status, unread: unread.value.has(sessionID) }),
      { status: signal?.status },
    )
  }

  function markSeen(sessionID: string | null | undefined) {
    if (!sessionID || !unread.value.has(sessionID)) return
    const next = new Set(unread.value)
    next.delete(sessionID)
    unread.value = next
    persistUnread()
  }

  /** One rollup entry per project, for the sidebar and the tray. */
  const projectRollup = computed<ProjectRollup[]>(() =>
    rollupProjects(
      projects.entries.value.map((entry) => ({
        id: entry.directory,
        name: entry.name,
        conversations: entry.session
          ? [
              {
                id: entry.session.id,
                title: entry.session.title || "Untitled",
                state: stateFor(entry.session.id),
                reason: reasonFor(entry.session.id),
              },
            ]
          : [],
      })),
    ),
  )

  const trayRollup = computed(() => rollupTray(projectRollup.value))

  return {
    signals,
    unread,
    globalLive,
    projectRollup,
    trayRollup,
    stateFor,
    reasonFor,
    markSeen,
    start,
    stop,
    reset,
  }
}
