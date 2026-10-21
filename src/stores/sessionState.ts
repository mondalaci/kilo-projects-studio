import { computed, ref } from "vue"
import type { ServerClient } from "@/api/client"
import type { GlobalEventEnvelope, PermissionRequest, QuestionRequest, ServerEvent, SyncEnvelope } from "@/api/types"
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
 * One global event stream carries the events of all projects, tagged with their
 * directory, so a single subscription keeps the sidebar dots and the tray rollup
 * current. The stream only reports changes, so a bounded poll supplies the
 * baseline (a session that was already busy before we connected) and repairs
 * anything the stream misses.
 */

const UNREAD_KEY = "kilo-projects-studio.unread-sessions"

/** How often the baseline sweep runs, and how many projects it touches. */
const SWEEP_MS = 1500
const SWEEP_BATCH = 3
/** The global permission and question lists are re-read every Nth sweep. */
const LISTS_EVERY = 4

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
/** Removes the focus/visibility listeners when tracking stops. */
let detachAttention: (() => void) | null = null
let sweepCursor = 0
let sweepCount = 0
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

/** Unwrap a sync envelope, and strip the `.1` suffix the fork appends. */
function normalize(event: ServerEvent): { type: string; properties?: Record<string, unknown> } | null {
  if ((event as { type?: string }).type === "sync") {
    const sync = (event as SyncEnvelope).syncEvent
    if (!sync) return null
    return { type: sync.type.replace(/\.1$/, ""), properties: sync.data }
  }
  const base = event as { type?: string; properties?: Record<string, unknown> }
  if (!base?.type) return null
  return { type: base.type.replace(/\.1$/, ""), properties: base.properties }
}

export function useSessionState() {
  const server = useServer()
  const sessions = useSessions()
  const projects = useProjects()

  /** Whether the window is hidden or simply not the focused window. */
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

  /** Fold one project-tagged event from the global stream into the state. */
  function applyEvent(envelope: GlobalEventEnvelope) {
    if (!envelope?.payload) return
    const normalized = normalize(envelope.payload)
    if (!normalized) return
    const { type, properties } = normalized
    if (!properties) return

    const sessionID = properties.sessionID as string | undefined

    switch (type) {
      case "session.status": {
        const status = (properties.status as { type?: string } | undefined)?.type
        if (sessionID && status) patch(sessionID, { status })
        break
      }
      case "session.idle": {
        if (!sessionID) break
        patch(sessionID, { status: "idle" })
        // A turn that finished while the user was not looking is unacknowledged.
        if (
          countsAsUnread({ isCurrent: sessions.currentID.value === sessionID, focused: !unfocused() }) &&
          !unread.value.has(sessionID)
        ) {
          unread.value = new Set(unread.value).add(sessionID)
          persistUnread()
        }
        break
      }
      case "message.part.updated": {
        const part = properties.part as
          | { sessionID?: string; type?: string; state?: { status?: string } }
          | undefined
        const target = part?.sessionID ?? sessionID
        // A tool that is pending or running is proof the turn is in flight, which
        // is exactly when the status endpoint has not been asked yet. Completion
        // deliberately leaves the status alone: more work usually follows, and
        // settling it here would flicker the dot grey between steps.
        if (target && part?.type === "tool") {
          const status = part.state?.status
          if (status === "running" || status === "pending") patch(target, { status: "busy" })
        }
        break
      }
      case "permission.asked":
      case "permission.v2.asked": {
        const request = properties as unknown as PermissionRequest
        if (request?.id && request.sessionID) {
          requestSession.set(request.id, request.sessionID)
          setBlocked(request.sessionID, `permission: ${request.permission}`)
        }
        break
      }
      case "permission.replied":
      case "permission.v2.replied": {
        const requestID = properties.requestID as string | undefined
        const target = (requestID && requestSession.get(requestID)) || sessionID
        if (requestID) requestSession.delete(requestID)
        if (target) setBlocked(target, undefined)
        break
      }
      case "question.asked":
      case "question.v2.asked": {
        const request = properties as unknown as QuestionRequest
        if (request?.id && request.sessionID) {
          requestSession.set(request.id, request.sessionID)
          setBlocked(request.sessionID, "question")
        }
        break
      }
      case "question.replied":
      case "question.v2.replied":
      case "question.rejected":
      case "question.v2.rejected": {
        const requestID = (properties.requestID as string | undefined) ?? (properties.id as string | undefined)
        const target = (requestID && requestSession.get(requestID)) || sessionID
        if (requestID) requestSession.delete(requestID)
        if (target) setBlocked(target, undefined)
        break
      }
      default:
        break
    }

    // The same events also keep every project's newest conversation current,
    // not just the active project's (which has its own per-directory stream).
    if (type === "session.created" || type === "session.updated") {
      const info = properties.info as { directory?: string } | undefined
      if (info?.directory && info.directory !== server.directory.value) projects.applyEvent(type, properties)
    }
  }

  /** Baseline: statuses for one project, and the global pending lists. */
  async function sweep() {
    const client = activeClient
    if (!client) return

    const directories = server.projects.value.map((project) => project.worktree)
    if (directories.length) {
      // The project on screen is refreshed every tick: the status endpoint is the
      // only source of "busy" (the event stream does not carry session.status),
      // so waiting for its turn in a rotation would leave the dot grey for
      // seconds while a command runs.
      const active = server.directory.value
      const batch: string[] = active && directories.includes(active) ? [active] : []
      for (let guard = 0; batch.length < SWEEP_BATCH && guard < directories.length; guard++) {
        const directory = directories[sweepCursor++ % directories.length]
        if (!batch.includes(directory)) batch.push(directory)
      }
      await Promise.all(
        batch.map(async (directory) => {
          try {
            const statuses = await client.sessionStatus({ directory })
            const next = { ...signals.value }
            for (const [sessionID, status] of Object.entries(statuses ?? {})) {
              next[sessionID] = { ...next[sessionID], status: (status as { type?: string })?.type }
            }
            signals.value = next
          } catch {
            /* leave the previous values in place */
          }
        }),
      )
    }

    if (sweepCount++ % LISTS_EVERY !== 0) return
    try {
      // Both endpoints are global when called without a directory: every pending
      // request across every session, which is exactly the "needs a human" set.
      const [permissions, questions] = await Promise.all([
        client.listPermissions().catch(() => [] as PermissionRequest[]),
        client.listQuestions().catch(() => [] as QuestionRequest[]),
      ])
      const blocked = new Map<string, string>()
      for (const request of permissions) {
        if (!request?.id || !request.sessionID) continue
        requestSession.set(request.id, request.sessionID)
        blocked.set(request.sessionID, `permission: ${request.permission}`)
      }
      for (const request of questions) {
        if (!request?.id || !request.sessionID) continue
        requestSession.set(request.id, request.sessionID)
        blocked.set(request.sessionID, "question")
      }
      // Replace the blocked reasons wholesale: the lists are the source of truth,
      // so replies that happened while we were disconnected clear too.
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
          await client.subscribeGlobal(
            (envelope) => applyEvent(envelope),
            {
              signal,
              onOpen: () => {
                globalLive.value = true
                // Re-read everything once, in case events were missed offline.
                sweepCursor = 0
                sweepCount = 0
                void sweep()
              },
            },
          )
        } catch {
          /* dropped: retry below */
        }
        globalLive.value = false
        if (signal.aborted) break
        await new Promise((resolve) => setTimeout(resolve, 1500))
      }
    })()
  }

  /**
   * Coming back to the window is what acknowledges the conversation on screen:
   * a turn that finished while the user was elsewhere leaves the mark, and simply
   * looking at it again should clear it. Only the conversation that is actually
   * open is acknowledged — another project's unread result stays unread.
   */
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

  /** Start tracking: baseline sweep plus the global stream. */
  function start(client: ServerClient) {
    stop()
    activeClient = client
    watchWindow()
    void follow(client)
    // Establish the baseline immediately rather than a batch at a time.
    void (async () => {
      const directories = server.projects.value.map((project) => project.worktree)
      await Promise.all(
        directories.map((directory) =>
          client
            .sessionStatus({ directory })
            .then((statuses) => {
              const next = { ...signals.value }
              for (const [sessionID, status] of Object.entries(statuses ?? {})) {
                next[sessionID] = { ...next[sessionID], status: (status as { type?: string })?.type }
              }
              signals.value = next
            })
            .catch(() => undefined),
        ),
      )
      await sweep()
    })()
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
    sweepCursor = 0
    sweepCount = 0
  }

  /** The dot state for one conversation. */
  function stateFor(sessionID: string | null | undefined): ConversationState {
    if (!sessionID) return "idle"
    const signal = signals.value[sessionID]
    return conversationState({
      blocked: Boolean(signal?.blockedReason),
      status: signal?.status,
      unread: unread.value.has(sessionID),
    })
  }

  /** A short human reason, for tooltips and the tray menu. */
  function reasonFor(sessionID: string | null | undefined): string {
    if (!sessionID) return "idle"
    const signal = signals.value[sessionID]
    if (signal?.blockedReason) return signal.blockedReason
    return stateLabel(
      conversationState({ status: signal?.status, unread: unread.value.has(sessionID) }),
      { status: signal?.status },
    )
  }

  /** Clear the unread marker once the user opens a conversation. */
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
