import { ref } from "vue"
import type { ServerClient } from "@/api/client"
import type { McpServer } from "@/api/types"

/**
 * MCP servers, as the TUI's `/mcps` dialog presents them.
 *
 * A remote server that wants a login does not fail, it reports `needs_auth` —
 * and connecting it again can only fail, so its row offers to sign in instead.
 * That sign-in is an integration the server registered for itself: the attempt
 * carries an authorize URL, the server listens on its own loopback port for the
 * provider's callback, and this only has to open the URL and wait.
 */

const servers = ref<McpServer[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const open = ref(false)
/** Names with a connect or disconnect in flight, so their row can say so. */
const pending = ref<string[]>([])

export interface McpSignIn {
  server: string
  /** The integration and attempt the server is waiting on. */
  integrationID: string
  attemptID: string
  url: string
  instructions: string
  /** `auto` finishes on the server's callback; `code` waits for a pasted code. */
  mode: "auto" | "code"
  status: "waiting" | "complete" | "failed"
  /** Why a failed attempt failed. */
  message?: string
}

const signIn = ref<McpSignIn | null>(null)

/** How often a waiting sign-in asks whether the callback has landed. */
const POLL_MS = 1500

let timer: ReturnType<typeof setTimeout> | undefined

/**
 * The line beside a server's name, worded as the TUI words it.
 *
 * A connect that is still in flight and a server the server itself calls
 * `pending` read the same, because to the user they are the same thing.
 */
export function statusLabel(server: McpServer, loading: boolean): string {
  if (loading || server.status.status === "pending") return "Connecting …"
  switch (server.status.status) {
    case "connected":
      return "Connected ✓"
    case "failed":
      return "Failed !"
    case "needs_auth":
      return "Sign in required →"
    default:
      return "Disabled ○"
  }
}

export type McpTone = "success" | "error" | "warning" | "muted"

export function statusTone(server: McpServer, loading: boolean): McpTone {
  if (loading || server.status.status === "pending") return "muted"
  switch (server.status.status) {
    case "connected":
      return "success"
    case "failed":
      return "error"
    case "needs_auth":
      return "warning"
    default:
      return "muted"
  }
}

/**
 * What the action on a server does, in the TUI's own words.
 *
 * `retry` is the honest label for a failed connect — the action is the same
 * call — and a server waiting on a login says so rather than offering to
 * connect again.
 */
export function actionLabel(server: McpServer | undefined, loading: boolean): string {
  if (!server) return "connect"
  if (loading || server.status.status === "pending") return "connecting"
  switch (server.status.status) {
    case "connected":
      return "disconnect"
    case "failed":
      return "retry"
    case "needs_auth":
      return "sign in"
    default:
      return "connect"
  }
}

/** The detail behind a row that says "Failed" or "Sign in required". */
export function errorText(server: McpServer | undefined): string | undefined {
  if (!server) return undefined
  const status = server.status
  if (status.status === "failed" || status.status === "needs_auth") return status.error
  return undefined
}

export function useMcp() {
  function stopPolling() {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  /** The servers again, sorted by name as the TUI lists them. */
  async function load(client: ServerClient, directory?: string | null) {
    loading.value = true
    try {
      const list = await client.mcpServers({ directory: directory ?? undefined })
      servers.value = [...list].sort((a, b) => a.name.localeCompare(b.name))
      error.value = null
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  function show(client: ServerClient, directory?: string | null) {
    open.value = true
    signIn.value = null
    void load(client, directory)
  }

  function hide() {
    stopPolling()
    open.value = false
    signIn.value = null
  }

  /**
   * Sign a server in.
   *
   * The authorize URL is opened in a new tab and the server's own callback
   * finishes the flow, so the only thing left to do here is watch for it. A
   * `code`-mode provider has no callback to catch, so the attempt waits for the
   * code instead.
   */
  async function startSignIn(client: ServerClient, server: McpServer, directory?: string | null) {
    const integrationID = server.integrationID
    if (!integrationID) {
      error.value = `${server.name} does not say how to sign in`
      return
    }
    stopPolling()
    error.value = null
    signIn.value = {
      server: server.name,
      integrationID,
      attemptID: "",
      url: "",
      instructions: "Starting the sign-in…",
      mode: "auto",
      status: "waiting",
    }
    try {
      const integration = await client.integration(integrationID, { directory: directory ?? undefined })
      const method = integration?.methods.find((item) => item.type === "oauth")
      if (!method || method.type !== "oauth") throw new Error(`${server.name} has no OAuth method`)
      const attempt = await client.oauthConnect(integrationID, method.id, { directory: directory ?? undefined })
      if (!attempt) throw new Error("The server did not start a sign-in attempt")
      signIn.value = {
        server: server.name,
        integrationID,
        attemptID: attempt.attemptID,
        url: attempt.url,
        instructions: attempt.instructions,
        mode: attempt.mode,
        status: "waiting",
      }
      window.open(attempt.url, "_blank", "noopener,noreferrer")
      if (attempt.mode === "auto") poll(client, integrationID, attempt.attemptID, directory)
    } catch (err) {
      signIn.value = {
        server: server.name,
        integrationID,
        attemptID: "",
        url: "",
        instructions: "",
        mode: "auto",
        status: "failed",
        message: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /** Ask the server whether the callback has arrived, until it has. */
  function poll(client: ServerClient, integrationID: string, attemptID: string, directory?: string | null) {
    stopPolling()
    timer = setTimeout(async () => {
      try {
        const status = await client.oauthStatus(integrationID, attemptID)
        if (!status || status.status === "pending") {
          poll(client, integrationID, attemptID, directory)
          return
        }
        if (status.status === "failed") {
          signIn.value = signIn.value && { ...signIn.value, status: "failed", message: status.message }
          return
        }
        if (status.status === "expired") {
          signIn.value = signIn.value && { ...signIn.value, status: "failed", message: "The sign-in expired" }
          return
        }
        signIn.value = signIn.value && { ...signIn.value, status: "complete" }
        await load(client, directory)
      } catch (err) {
        signIn.value =
          signIn.value && { ...signIn.value, status: "failed", message: err instanceof Error ? err.message : String(err) }
      }
    }, POLL_MS)
  }

  /** Hand back the code a `code`-mode provider is waiting on. */
  async function submitCode(client: ServerClient, server: McpServer, code: string, directory?: string | null) {
    const integrationID = server.integrationID
    const current = signIn.value
    if (!integrationID || !current || !current.attemptID) return
    try {
      await client.oauthComplete(integrationID, current.attemptID, code)
      signIn.value = { ...current, status: "complete" }
      await load(client, directory)
    } catch (err) {
      signIn.value = { ...current, status: "failed", message: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * Give up on a sign-in.
   *
   * Closing the dialog leaves the attempt alone — the user may have stepped away
   * to approve it in the browser — so ending one is always this explicit step.
   */
  async function cancelSignIn(client: ServerClient) {
    const current = signIn.value
    stopPolling()
    signIn.value = null
    if (current?.attemptID) await client.oauthCancel(current.integrationID, current.attemptID).catch(() => undefined)
  }

  /** Close the dialog's view of a sign-in and stop asking about it. */
  function dismissSignIn() {
    stopPolling()
    signIn.value = null
  }

  /**
   * The action on a row: open, close, or sign in.
   *
   * A server already waiting on a login is never connected again — the call can
   * only fail — so the sign-in takes its place.
   */
  async function toggle(client: ServerClient, server: McpServer, directory?: string | null) {
    if (pending.value.includes(server.name) || server.status.status === "pending") return
    if (server.status.status === "needs_auth" && server.integrationID) {
      await startSignIn(client, server, directory)
      return
    }
    pending.value = [...pending.value, server.name]
    try {
      if (server.status.status === "connected") await client.mcpDisconnect(server.name, { directory: directory ?? undefined })
      else await client.mcpConnect(server.name, { directory: directory ?? undefined })
      await load(client, directory)
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      pending.value = pending.value.filter((name) => name !== server.name)
    }
  }

  return {
    servers,
    loading,
    error,
    open,
    pending,
    signIn,
    load,
    show,
    hide,
    toggle,
    startSignIn,
    submitCode,
    cancelSignIn,
    dismissSignIn,
  }
}
