import type { Credentials } from "@/api/client"
import type { InstanceInfo } from "@/api/discovery"
import { useChat } from "./chat"
import { useConnection } from "./connection"
import { draft, requestComposerFocus } from "./draft"
import { useFileViewer } from "./fileViewer"
import { useFiles } from "./files"
import { useSessionState } from "./sessionState"
import { useLive } from "./live"
import { useProjects } from "./projects"
import { loadRuntimeConfig } from "./runtimeConfig"
import { useServer } from "./server"
import { useSessions } from "./sessions"
import { useTools } from "./tools"
import {
  clearPromptParams,
  readAgentParam,
  readAutoSubmitParam,
  readQueryParam,
  readSessionParam,
  writeSessionParam,
} from "@/utils/url"

export function useApp() {
  const connection = useConnection()
  const server = useServer()
  const sessions = useSessions()
  const projects = useProjects()
  const chat = useChat()
  const live = useLive()
  const tools = useTools()
  const files = useFiles()
  const fileViewer = useFileViewer()
  const sessionState = useSessionState()

  /** Load the conversation list and event stream for the current project. */
  async function loadScoped(client: NonNullable<typeof connection.client.value>) {
    await sessions.load(client, server.directory.value)
    await live.start(client, server.directory.value)
  }

  async function connect(info: InstanceInfo, credentials?: Credentials) {
    live.stop()
    chat.reset()
    sessions.reset()
    projects.reset()
    server.reset()
    files.reset()
    fileViewer.close()
    sessionState.reset()

    server.applySavedPrefs(info.origin)

    const ok = await connection.connect(info, credentials)
    const client = connection.client.value
    if (!ok || !client) return false

    try {
      const origin = connection.connected.value?.origin ?? info.origin
      await server.load(client, origin, server.savedDirectory(origin))

      // One conversation per project: fetch each project's newest conversation
      // so the sidebar can open on the most recent one by default.
      await projects.load(client)

      const target = projects.mostRecent.value?.directory ?? null
      if (target && target !== server.directory.value) await switchProject(target)
      else await loadScoped(client)

      // One global stream plus a bounded sweep keeps every project's conversation
      // state (and the tray rollup) current, not just the active project's.
      sessionState.start(client)

      await openInitialSession()
      await applyRuntimeDefaults()
      await applyLinkParams()
      return true
    } catch (error) {
      live.stop()
      chat.reset()
      sessions.reset()
      projects.reset()
      server.reset()
      connection.disconnect()
      connection.connectError.value = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  function disconnect() {
    live.stop()
    chat.reset()
    sessions.reset()
    projects.reset()
    server.reset()
    files.reset()
    fileViewer.close()
    sessionState.reset()
    connection.disconnect()
  }

  async function selectSession(sessionID: string) {
    const client = connection.client.value
    if (!client) return
    sessions.currentID.value = sessionID
    sessionState.markSeen(sessionID)
    writeSessionParam(sessionID, readSessionParam() === sessionID)
    // Refresh the session info so `current` carries fields the list omits
    // (notably `share`), which the header share/unshare toggle depends on.
    const info = await client.getSession(sessionID, { directory: server.directory.value }).catch(() => null)
    if (info) {
      sessions.upsert(info)
      projects.setLatest(info.directory ?? server.directory.value, info)
    }
    await chat.open(client, sessionID, server.directory.value)
  }

  /** Open a session by id, switching project first if it lives elsewhere. */
  async function openSessionByID(sessionID: string) {
    const client = connection.client.value
    if (!client) return false
    const info = await client.getSession(sessionID).catch(() => null)
    if (!info) return false
    const directory = info.directory
    if (directory && directory !== server.directory.value) await switchProject(directory)
    await selectSession(sessionID)
    return true
  }

  /**
   * The conversation shown when a project is opened: the session id in the URL
   * when it resolves, otherwise the project's newest conversation.
   */
  async function openInitialSession() {
    const id = readSessionParam()
    if (id && (await openSessionByID(id))) return
    const session = projects.latestFor(server.directory.value)
    if (session) await selectSession(session.id)
  }

  /**
   * Apply the runtime config's `defaultAgent` (from `kilo-projects-studio.json`) once
   * the agent list is known. It overrides the last-used saved agent, but a
   * `?agent=` GET param applied afterwards still takes precedence.
   */
  async function applyRuntimeDefaults() {
    const { defaultAgent } = await loadRuntimeConfig()
    if (defaultAgent && server.modes.value.some((mode) => mode.name === defaultAgent)) {
      server.selectedAgent.value = defaultAgent
    }
  }

  /**
   * Apply one-time link params (`?agent=`, `?query=`, `?submit=`) after a
   * connection is established. The agent is only applied when it exists, and the
   * query is prefilled into the composer; with `submit` it is sent right away
   * (creating a new chat if none is open) and the params are cleared so a reload
   * does not resend it.
   */
  async function applyLinkParams() {
    const agent = readAgentParam()
    if (agent && server.modes.value.some((mode) => mode.name === agent)) {
      server.selectedAgent.value = agent
    }

    const query = readQueryParam()
    if (query !== null) draft.value = query

    if (!readAutoSubmitParam()) return
    const text = draft.value.trim()
    clearPromptParams()
    if (!text) return
    await sendMessage(text)
    draft.value = ""
  }

  /** Switch the active project (directory) and reload everything scoped to it. */
  async function switchProject(directory: string) {
    const client = connection.client.value
    if (!client) return
    if (server.directory.value === directory) return
    live.stop()
    chat.reset()
    sessions.reset()
    fileViewer.close()
    server.setDirectory(directory)
    await server.load(client, connection.connected.value?.origin ?? "", directory)
    await loadScoped(client)
  }

  /**
   * Open a project from the sidebar: it becomes the active project and its own
   * conversation is shown. A project with no conversation yet gets one, so the
   * "one conversation per project" rule always holds.
   */
  async function openProject(directory: string) {
    const client = connection.client.value
    if (!client) return
    if (server.directory.value !== directory) await switchProject(directory)
    const session = projects.latestFor(directory)
    if (session) {
      await selectSession(session.id)
    } else {
      // A project with no conversation yet gets its first one.
      await newChat()
    }
    // Picking a project is the start of typing in it, so the composer takes the
    // keyboard rather than leaving it wherever it was.
    requestComposerFocus()
  }

  async function newChat() {
    const client = connection.client.value
    if (!client) return null
    const session = await sessions.create(
      client,
      { agent: server.selectedAgent.value, model: server.selectedModel.value ?? undefined },
      server.directory.value,
    )
    projects.setLatest(server.directory.value, session)
    await selectSession(session.id)
    requestComposerFocus()
    return session
  }

  type FilePartInput = { type: "file"; mime: string; url: string; filename?: string }

  async function sendMessage(text: string, files: FilePartInput[] = []) {
    const client = connection.client.value
    if (!client) return
    const content = text.trim()
    if (!content && files.length === 0) return
    let sessionID = sessions.currentID.value
    if (!sessionID) {
      const session = await newChat()
      if (!session) return
      sessionID = session.id
    }
    const parts = [...files, ...(content ? [{ type: "text" as const, text: content }] : [])]
    await chat.send(
      client,
      sessionID,
      {
        parts,
        model: server.selectedModel.value,
        agent: server.selectedAgent.value,
        tools: tools.payload(),
      },
      server.directory.value,
    )
  }

  async function abort() {
    const client = connection.client.value
    const sessionID = sessions.currentID.value
    if (!client || !sessionID) return
    await chat.abort(client, sessionID, server.directory.value)
  }

  async function removeSession(sessionID: string, directory?: string) {
    const client = connection.client.value
    if (!client) return
    const target = directory ?? server.directory.value
    await sessions.remove(client, sessionID, target)
    projects.forgetChat(sessionID)
    if (target === server.directory.value && !sessions.currentID.value && sessions.sorted.value[0]) {
      await selectSession(sessions.sorted.value[0].id)
    }
    // The deleted chat may have been the row the sidebar showed for this
    // project, so re-read which conversation is now the newest.
    if (target) await projects.refreshOne(client, target)
  }

  /**
   * Rename a conversation. `directory` lets a project row that is not the
   * active project be renamed without switching the whole app over to it.
   */
  async function renameSession(sessionID: string, title: string, directory?: string) {
    const client = connection.client.value
    if (!client) return
    const target = directory ?? server.directory.value
    const info = await client.updateSession(sessionID, { title }, { directory: target })
    if (!info) return
    if (target === server.directory.value) sessions.upsert(info)
    projects.setLatest(info.directory ?? target, info)
  }

  /** Create/return the server-side public share link for a session. */
  async function shareSession(sessionID: string): Promise<string | null> {
    const client = connection.client.value
    if (!client) return null
    try {
      const info = await client.shareSession(sessionID, { directory: server.directory.value })
      if (info) sessions.upsert(info)
      return info?.share?.url ?? null
    } catch {
      return null
    }
  }

  /** Revoke a session's public share link. */
  async function unshareSession(sessionID: string): Promise<boolean> {
    const client = connection.client.value
    if (!client) return false
    try {
      const info = await client.unshareSession(sessionID, { directory: server.directory.value })
      // The response omits `share`; clear it explicitly so the toggle flips back.
      if (info) sessions.upsert({ ...info, share: undefined })
      else {
        const existing = sessions.sessions.value.find((item) => item.id === sessionID)
        if (existing) sessions.upsert({ ...existing, share: undefined })
      }
      return true
    } catch {
      return false
    }
  }

  async function replyPermission(requestID: string, reply: "once" | "always" | "reject") {
    const client = connection.client.value
    if (!client) return
    await chat.replyPermission(client, requestID, reply, server.directory.value)
  }

  async function replyQuestion(requestID: string, answers: string[][]) {
    const client = connection.client.value
    if (!client) return
    await chat.replyQuestion(client, requestID, answers, server.directory.value)
  }

  async function rejectQuestion(requestID: string) {
    const client = connection.client.value
    if (!client) return
    await chat.rejectQuestion(client, requestID, server.directory.value)
  }

  return {
    connection,
    server,
    sessions,
    projects,
    sessionState,
    chat,
    live,
    connect,
    disconnect,
    selectSession,
    switchProject,
    openProject,
    openSessionByID,
    openInitialSession,
    newChat,
    sendMessage,
    abort,
    removeSession,
    renameSession,
    shareSession,
    unshareSession,
    replyPermission,
    replyQuestion,
    rejectQuestion,
  }
}

export type AppStore = ReturnType<typeof useApp>
