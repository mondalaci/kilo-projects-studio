import type {
  AgentInfo,
  CommandInfo,
  DataEnvelope,
  FormDetail,
  FormInfo,
  ListEnvelope,
  LocationInfo,
  ModelInfo,
  ModelRef,
  PermissionRequest,
  PermissionReply,
  ProjectInfo,
  ProviderInfo,
  ServerConfig,
  ServerEvent,
  ServerInfo,
  SessionID,
  SessionInfo,
  SessionMessage,
  SkillInfo,
} from "./types"

export interface Credentials {
  username: string
  password: string
}

export class ServerError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: string,
  ) {
    super(`HTTP ${status} ${statusText}${body ? `: ${body.slice(0, 300)}` : ""}`)
    this.name = "ServerError"
  }

  get unauthorized() {
    return this.status === 401
  }
}

export interface RequestOptions {
  method?: string
  /** Instance directory (project) to scope the request to (`/api` `directory`). */
  directory?: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>
  /** Override the default request deadline in ms; `0` disables it. */
  timeoutMs?: number
}

/**
 * A request that never settles keeps its socket open forever, and a handful of
 * those exhaust the browser's per-origin connection pool. Giving each request a
 * deadline keeps a stalled response from wedging the whole origin.
 */
const DEFAULT_TIMEOUT_MS = 30_000

function withDeadline(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  const timer =
    timeoutMs > 0
      ? setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs} ms`)), timeoutMs)
      : undefined
  const forward = () => controller.abort(signal?.reason)
  if (signal) {
    if (signal.aborted) forward()
    else signal.addEventListener("abort", forward, { once: true })
  }
  return {
    signal: controller.signal,
    cleanup() {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener("abort", forward)
    },
  }
}

export interface PromptInput {
  text?: string
  files?: Array<{ uri: string; name?: string }>
  agents?: Array<{ name: string }>
  skills?: Array<{ id: string; name: string }>
  metadata?: Record<string, unknown>
  messageID?: string
}

/**
 * Thin client over the opencode **v2** HTTP API (`/api/*`).
 *
 * Auth is HTTP Basic; the server always requires it. Instance-scoped endpoints
 * accept a `directory` query parameter that selects the project instance, which
 * is how one server multiplexes many projects.
 */
export class ServerClient {
  readonly origin: string
  private authHeader?: string

  constructor(origin: string, credentials?: Credentials) {
    this.origin = origin.replace(/\/+$/, "")
    if (credentials?.password) {
      const token = btoa(`${credentials.username || "opencode"}:${credentials.password}`)
      this.authHeader = `Basic ${token}`
    }
  }

  private url(path: string, opts?: RequestOptions): string {
    const url = new URL(this.origin + path)
    if (opts?.directory) url.searchParams.set("directory", opts.directory)
    for (const [key, value] of Object.entries(opts?.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  private headers(extra?: Record<string, string>, body?: unknown): HeadersInit {
    const headers: Record<string, string> = { Accept: "application/json", ...extra }
    if (this.authHeader) headers.Authorization = this.authHeader
    if (body !== undefined) headers["Content-Type"] = "application/json"
    return headers
  }

  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const { signal, cleanup } = withDeadline(opts.signal, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    try {
      const res = await fetch(this.url(path, opts), {
        method: opts.method ?? "GET",
        headers: this.headers(opts.headers, opts.body),
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal,
      })
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new ServerError(res.status, res.statusText, body)
      }
      if (res.status === 204) return undefined as T
      const text = await res.text()
      if (!text) return undefined as T
      return JSON.parse(text) as T
    } finally {
      cleanup()
    }
  }

  /* ------------------------------ health/config ----------------------------- */

  /** Server build info; doubles as the reachability/auth probe. */
  info(signal?: AbortSignal) {
    return this.request<ServerInfo>("/api/info", { signal })
  }

  location(opts: RequestOptions = {}) {
    return this.request<LocationInfo>("/api/location", opts)
  }

  async config(opts: RequestOptions = {}): Promise<ServerConfig> {
    // `/api/config` returns an array of config documents; flatten to the first
    // document's info, which is the merged user config.
    const docs = await this.request<Array<{ type?: string; path?: string; info?: ServerConfig }>>("/api/config", opts)
    return (Array.isArray(docs) ? docs.find((doc) => doc?.info)?.info : undefined) ?? {}
  }

  async projects(opts: RequestOptions = {}): Promise<ProjectInfo[]> {
    return this.request<ProjectInfo[]>("/api/project", opts)
  }

  async agents(opts: RequestOptions = {}): Promise<AgentInfo[]> {
    const res = await this.request<DataEnvelope<AgentInfo[]>>("/api/agent", opts)
    return res?.data ?? []
  }

  async providers(opts: RequestOptions = {}): Promise<ProviderInfo[]> {
    const res = await this.request<DataEnvelope<ProviderInfo[]>>("/api/provider", opts)
    return res?.data ?? []
  }

  async models(opts: RequestOptions = {}): Promise<ModelInfo[]> {
    const res = await this.request<DataEnvelope<ModelInfo[]>>("/api/model", opts)
    return res?.data ?? []
  }

  async commands(opts: RequestOptions = {}): Promise<CommandInfo[]> {
    const res = await this.request<DataEnvelope<CommandInfo[]>>("/api/command", opts)
    return res?.data ?? []
  }

  async skills(opts: RequestOptions = {}): Promise<SkillInfo[]> {
    const res = await this.request<DataEnvelope<SkillInfo[]>>("/api/skill", opts)
    return res?.data ?? []
  }

  /* -------------------------------- sessions -------------------------------- */

  async listSessions(
    opts: RequestOptions & { limit?: number; search?: string; cursor?: string } = {},
  ): Promise<ListEnvelope<SessionInfo>> {
    const { limit, search, cursor, ...rest } = opts
    return this.request<ListEnvelope<SessionInfo>>("/api/session", {
      ...rest,
      query: { limit, search, cursor, ...rest.query },
    })
  }

  async getSession(sessionID: string, opts: RequestOptions = {}): Promise<SessionInfo | null> {
    const res = await this.request<DataEnvelope<SessionInfo>>(`/api/session/${sessionID}`, opts)
    return res?.data ?? null
  }

  async createSession(
    body: { title?: string; agent?: string; model?: ModelRef; parentID?: string; location?: { directory: string } } = {},
    opts: RequestOptions = {},
  ): Promise<SessionInfo | null> {
    const res = await this.request<DataEnvelope<SessionInfo>>("/api/session", {
      ...opts,
      method: "POST",
      body,
    })
    return res?.data ?? null
  }

  async updateSession(sessionID: string, body: { title?: string }, opts: RequestOptions = {}): Promise<SessionInfo | null> {
    const res = await this.request<DataEnvelope<SessionInfo>>(`/api/session/${sessionID}`, {
      ...opts,
      method: "PATCH",
      body,
    })
    return res?.data ?? null
  }

  deleteSession(sessionID: string, opts: RequestOptions = {}) {
    return this.request<void>(`/api/session/${sessionID}`, { ...opts, method: "DELETE" })
  }

  async messages(
    sessionID: string,
    opts: RequestOptions & { limit?: number; order?: "asc" | "desc" } = {},
  ): Promise<SessionMessage[]> {
    const { limit, order, ...rest } = opts
    const res = await this.request<ListEnvelope<SessionMessage>>(`/api/session/${sessionID}/message`, {
      ...rest,
      query: { limit, order: order ?? "asc", ...rest.query },
    })
    return res?.data ?? []
  }

  /** The conversation as the model sees it (system + user + assistant turns). */
  async context(sessionID: string, opts: RequestOptions = {}): Promise<SessionMessage[]> {
    const res = await this.request<DataEnvelope<SessionMessage[]>>(`/api/session/${sessionID}/context`, opts)
    return res?.data ?? []
  }

  prompt(sessionID: string, input: PromptInput, opts: RequestOptions = {}) {
    return this.request<DataEnvelope<unknown>>(`/api/session/${sessionID}/prompt`, {
      ...opts,
      method: "POST",
      body: input,
    })
  }

  command(
    sessionID: string,
    body: { command: string; arguments?: string; agent?: string; model?: string },
    opts: RequestOptions = {},
  ) {
    return this.request<DataEnvelope<unknown>>(`/api/session/${sessionID}/command`, {
      ...opts,
      method: "POST",
      body,
    })
  }

  interrupt(sessionID: string, opts: RequestOptions = {}) {
    return this.request<unknown>(`/api/session/${sessionID}/interrupt`, { ...opts, method: "POST" })
  }

  setModel(sessionID: string, model: ModelRef, opts: RequestOptions = {}) {
    return this.request<unknown>(`/api/session/${sessionID}/model`, { ...opts, method: "POST", body: { model } })
  }

  setAgent(sessionID: string, agent: string, opts: RequestOptions = {}) {
    return this.request<unknown>(`/api/session/${sessionID}/agent`, { ...opts, method: "POST", body: { agent } })
  }

  /* ------------------------- permissions and forms -------------------------- */

  async listPermissions(opts: RequestOptions = {}): Promise<PermissionRequest[]> {
    const res = await this.request<DataEnvelope<PermissionRequest[]>>("/api/permission/request", opts)
    return res?.data ?? []
  }

  async sessionPermissions(sessionID: string, opts: RequestOptions = {}): Promise<PermissionRequest[]> {
    const res = await this.request<DataEnvelope<PermissionRequest[]>>(`/api/session/${sessionID}/permission`, opts)
    return res?.data ?? []
  }

  replyPermission(sessionID: string, requestID: string, reply: PermissionReply, opts: RequestOptions = {}) {
    return this.request<unknown>(`/api/session/${sessionID}/permission/${requestID}/reply`, {
      ...opts,
      method: "POST",
      body: { reply },
    })
  }

  async listForms(opts: RequestOptions = {}): Promise<FormInfo[]> {
    const res = await this.request<DataEnvelope<FormInfo[]>>("/api/form", opts)
    return res?.data ?? []
  }

  async sessionForms(sessionID: string, opts: RequestOptions = {}): Promise<FormDetail[]> {
    const res = await this.request<DataEnvelope<FormDetail[]>>(`/api/session/${sessionID}/form`, opts)
    return res?.data ?? []
  }

  replyForm(sessionID: string, formID: string, answer: Record<string, unknown>, opts: RequestOptions = {}) {
    return this.request<unknown>(`/api/session/${sessionID}/form/${formID}/reply`, {
      ...opts,
      method: "POST",
      body: { answer },
    })
  }

  /* --------------------------------- streams -------------------------------- */

  /**
   * Read the global server-sent event stream (`GET /api/event`).
   *
   * Uses `fetch` rather than `EventSource` so Basic auth headers can be sent.
   * Each `data:` line carries the JSON event (`{ id, type, data, ... }`); the
   * server also emits bare `: heartbeat` comments. Resolves when the stream ends.
   */
  subscribe(onEvent: (event: ServerEvent) => void, opts: { signal?: AbortSignal; onOpen?: () => void } = {}): Promise<void> {
    return this.stream("/api/event", {}, onEvent, opts)
  }

  private async stream(
    path: string,
    query: Record<string, string | undefined>,
    onData: (data: ServerEvent) => void,
    opts: { signal?: AbortSignal; onOpen?: () => void } = {},
  ): Promise<void> {
    const res = await fetch(this.url(path, { query }), {
      headers: this.headers({ Accept: "text/event-stream" }),
      signal: opts.signal,
    })
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "")
      throw new ServerError(res.status, res.statusText, body)
    }
    opts.onOpen?.()
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index: number
      while ((index = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        // A frame may span several `data:` lines; join them, ignoring the
        // `event:`/`id:`/`: comment` lines the server also sends.
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n")
        if (!data) continue
        try {
          const event = JSON.parse(data) as ServerEvent
          if (event?.type) onData(event)
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  }
}

export type { SessionID }
