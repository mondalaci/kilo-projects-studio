import { computed, ref } from "vue"
import type { PromptInput, ServerClient } from "@/api/client"
import type {
  AssistantBlock,
  AssistantMessage,
  AssistantReasoningBlock,
  AssistantTextBlock,
  AssistantToolBlock,
  FormDetail,
  ModelRef,
  PermissionReply,
  PermissionRequest,
  SessionInfo,
  SessionMessage,
  StructuredError,
  TokenUsage,
  ToolContent,
  ToolState,
  UserMessage,
} from "@/api/types"
import { parseDataUrl } from "@/utils/file"

export type ChatStatus = { type: "idle" } | { type: "busy" } | { type: "retry"; attempt: number; message: string }

export interface SendInput {
  text: string
  files?: Array<{ mime: string; url: string; filename?: string }>
  model?: ModelRef | null
  agent?: string
}

const messages = ref<SessionMessage[]>([])
const status = ref<ChatStatus>({ type: "idle" })
const loading = ref(false)
const sending = ref(false)
const error = ref<string | null>(null)
const permissions = ref<PermissionRequest[]>([])
const forms = ref<FormDetail[]>([])
const todos = ref<Array<{ content: string; status: string; priority: string }>>([])
const currentSessionID = ref<string | null>(null)

/** Bumped when the view should force a re-pin and scroll to the bottom. */
const scrollToBottomRequest = ref(0)

function requestScrollToBottom() {
  scrollToBottomRequest.value++
}

/** Where a streamed text/reasoning ordinal landed in an assistant message's content. */
const streamIndex = new Map<string, { text: Map<number, number>; reasoning: Map<number, number> }>()

function indexFor(messageID: string) {
  let index = streamIndex.get(messageID)
  if (!index) {
    index = { text: new Map(), reasoning: new Map() }
    streamIndex.set(messageID, index)
  }
  return index
}

function sortMessages() {
  messages.value = [...messages.value].sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
}

function findMessage(id: string) {
  return messages.value.find((item) => item.id === id)
}

function replaceMessage(id: string, update: (message: SessionMessage) => SessionMessage) {
  const index = messages.value.findIndex((item) => item.id === id)
  if (index === -1) return undefined
  const next = messages.value.slice()
  next[index] = update(next[index])
  messages.value = next
  return next[index]
}

/** Ensure an assistant message exists for a step's `assistantMessageID`. */
function ensureAssistant(id: string, base: Partial<AssistantMessage> = {}): AssistantMessage {
  const existing = findMessage(id)
  if (existing && existing.type === "assistant") {
    if (base.agent || base.model) {
      replaceMessage(id, (message) => ({ ...(message as AssistantMessage), ...base }))
    }
    return findMessage(id) as AssistantMessage
  }
  if (existing) return existing as unknown as AssistantMessage
  const created: AssistantMessage = {
    id,
    type: "assistant",
    agent: base.agent ?? "",
    model: base.model ?? { id: "", providerID: "" },
    content: [],
    time: { created: base.time?.created ?? Date.now() },
    ...base,
  }
  messages.value = [...messages.value, created]
  sortMessages()
  return created
}

function updateAssistant(id: string, update: (message: AssistantMessage) => AssistantMessage) {
  const current = ensureAssistant(id)
  replaceMessage(id, () => update(current))
}

/** Append (or extend) an assistant text/reasoning block by its ordinal. */
function streamBlock(id: string, kind: "text" | "reasoning", ordinal: number, delta: string, replace = false, text?: string) {
  const index = indexFor(id)
  const map = kind === "text" ? index.text : index.reasoning
  updateAssistant(id, (message) => {
    const content = message.content.slice()
    let at = map.get(ordinal)
    if (at === undefined || content[at]?.type !== kind) {
      at = content.length
      map.set(ordinal, at)
      content.push(kind === "text" ? { type: "text", text: "" } : { type: "reasoning", text: "" })
    }
    const block = content[at]
    const nextText = replace ? (text ?? delta) : block.type === kind ? (block as { text: string }).text + delta : delta
    if (kind === "text") {
      content[at] = { type: "text", text: nextText }
    } else {
      // `replace` is the "…ended" event, so it also stamps `completed` — that
      // timestamp is what stops the block's right-gutter spinner. Without it
      // every reasoning block in a turn kept spinning until the turn-end
      // reconcile replaced the streamed copy.
      const time = (block as AssistantReasoningBlock).time
      content[at] = {
        type: "reasoning",
        text: nextText,
        time: {
          created: time?.created ?? Date.now(),
          completed: time?.completed ?? (replace ? Date.now() : undefined),
        },
      }
    }
    return { ...message, content }
  })
}

function upsertTool(
  id: string,
  toolID: string,
  patch: { name?: string; state?: ToolState; inputText?: string; executed?: boolean },
) {
  updateAssistant(id, (message) => {
    const content = message.content.slice()
    let at = content.findIndex((block) => block.type === "tool" && block.id === toolID)
    if (at === -1) {
      at = content.length
      content.push({
        type: "tool",
        id: toolID,
        name: patch.name ?? "",
        state: { status: "streaming", input: patch.inputText ?? "" },
        time: { created: Date.now() },
      })
    }
    const block = content[at] as AssistantToolBlock
    const next: AssistantToolBlock = {
      ...block,
      name: patch.name ?? block.name,
      executed: patch.executed ?? block.executed,
      state: patch.state ?? block.state,
    }
    content[at] = next
    return { ...message, content }
  })
}

function joinText(content: ToolContent[] | undefined): string {
  return (content ?? [])
    .filter((item): item is { type: "text"; text: string } => item.type === "text")
    .map((item) => item.text)
    .join("")
}

export function useChat() {
  const isBusy = computed(() => status.value.type === "busy" || status.value.type === "retry")

  const pendingPermissions = computed(() =>
    permissions.value.filter((request) => request.sessionID === currentSessionID.value),
  )
  const pendingForms = computed(() => forms.value.filter((form) => form.sessionID === currentSessionID.value))
  /** The turn is parked on a question or a permission prompt, not streaming. */
  const awaitingUser = computed(
    () => pendingPermissions.value.length > 0 || pendingForms.value.length > 0,
  )

  async function open(client: ServerClient, sessionID: string, directory?: string) {
    currentSessionID.value = sessionID
    loading.value = true
    error.value = null
    messages.value = []
    streamIndex.clear()
    todos.value = []
    status.value = { type: "idle" }
    try {
      const [list, perms, formList, session] = await Promise.all([
        client.recentMessages(sessionID, { directory }),
        client.sessionPermissions(sessionID, { directory }).catch(() => [] as PermissionRequest[]),
        client.sessionForms(sessionID, { directory }).catch(() => [] as FormDetail[]),
        client.getSession(sessionID, { directory }).catch(() => null),
      ])
      messages.value = list
      permissions.value = perms
      forms.value = formList
      // A trailing assistant message that never completed means the server is
      // still working on it — but only while the session itself is unsettled.
      // An interrupted run leaves exactly that shape behind, and reading it as
      // "busy" spins the view on a conversation the server has already idled.
      const newest = list[list.length - 1]
      if (isSettled(session, newest)) {
        settleUnfinishedTools(session?.outcome ?? "succeeded")
      } else if (newest?.type === "assistant" && !newest.time?.completed) {
        status.value = { type: "busy" }
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  /** Re-read the conversation from the server (used to reconcile after a turn). */
  async function reconcile(client: ServerClient, directory?: string) {
    const sessionID = currentSessionID.value
    if (!sessionID) return
    try {
      const [list, formList, session] = await Promise.all([
        client.recentMessages(sessionID, { directory }),
        client.sessionForms(sessionID, { directory }).catch(() => [] as FormDetail[]),
        client.getSession(sessionID, { directory }).catch(() => null),
      ])
      if (currentSessionID.value !== sessionID) return
      messages.value = list
      streamIndex.clear()
      forms.value = formList
      // The stream reports changes only, so a turn whose terminal event was lost
      // — a gap in the SSE connection, a dropped frame — would stay "running"
      // forever. The session record is authoritative, so end the turn here.
      if (isSettled(session, list[list.length - 1])) completeTurn(session?.outcome ?? "succeeded")
    } catch {
      /* leave the streamed state in place */
    }
  }

  async function send(client: ServerClient, sessionID: string, input: SendInput, directory?: string) {
    sending.value = true
    error.value = null
    scrollToBottomRequest.value++
    try {
      // v2 sets the model/agent on the session, then sends a plain prompt.
      if (input.model) await client.setModel(sessionID, input.model, { directory })
      if (input.agent) await client.setAgent(sessionID, input.agent, { directory })
      const body: PromptInput = {
        text: input.text,
        files: input.files?.map((file) => ({ uri: file.url, name: file.filename })),
      }
      await client.prompt(sessionID, body, { directory })
      // Show the message immediately; the server's copy (with its real id and
      // persisted attachments) replaces it on the reconcile at turn end. The
      // inline bytes have to travel with it: an image whose `data` is missing has
      // nothing to render, so it would show as a bare file name — exactly the
      // attachment the composer had just been previewing — until the reconcile.
      const optimistic: UserMessage = {
        id: `local-${Date.now()}`,
        type: "user",
        text: input.text,
        files: input.files?.map((file) => ({
          mime: file.mime,
          name: file.filename,
          data: parseDataUrl(file.url)?.data,
          source: { type: "inline" },
        })),
        time: { created: Date.now() },
      }
      messages.value = [...messages.value, optimistic]
      status.value = { type: "busy" }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      sending.value = false
    }
  }

  /**
   * Stop the turn. A run parked on a question or a permission prompt is idle as
   * far as the server is concerned, so interrupting would cancel nothing: the
   * asks themselves are what hold it. Withdraw them first — the tool call then
   * returns, and the agent resumes — and interrupt only what still runs after.
   */
  async function abort(client: ServerClient, sessionID: string, directory?: string) {
    const asks = forms.value.filter((form) => form.sessionID === sessionID)
    const requests = permissions.value.filter((request) => request.sessionID === sessionID)
    await Promise.allSettled([
      ...asks.map((form) => client.cancelForm(sessionID, form.id, { directory })),
      ...requests.map((request) =>
        client.replyPermission(sessionID, request.id, "reject", { directory }),
      ),
    ])
    // Clear locally too, in case the matching events arrive late or not at all.
    forms.value = forms.value.filter((form) => form.sessionID !== sessionID)
    permissions.value = permissions.value.filter((request) => request.sessionID !== sessionID)
    try {
      await client.interrupt(sessionID, { directory })
    } catch {
      /* Nothing running to interrupt; the withdrawn asks are the stop. */
    }
    status.value = { type: "idle" }
  }

  async function replyPermission(
    client: ServerClient,
    sessionID: string,
    requestID: string,
    reply: PermissionReply,
    directory?: string,
  ) {
    await client.replyPermission(sessionID, requestID, reply, { directory })
    permissions.value = permissions.value.filter((item) => item.id !== requestID)
  }

  async function replyForm(
    client: ServerClient,
    sessionID: string,
    formID: string,
    answer: Record<string, unknown>,
    directory?: string,
  ) {
    await client.replyForm(sessionID, formID, answer, { directory })
    forms.value = forms.value.filter((item) => item.id !== formID)
  }

  /** Has the server finished with this session? */
  /**
   * Whether the turn that produced `newest` has already ended.
   *
   * `outcome` and `time.idle` are sticky: they describe the last turn that
   * ended, not the one that may be running now, so neither can be read as
   * "settled" on its own — every session that ever finished a turn would look
   * settled forever. The idle stamp only means something next to the message it
   * followed: idle at or after the newest message means nothing is in flight,
   * while a newer message means a turn has started since.
   */
  function isSettled(session: SessionInfo | null, newest: SessionMessage | undefined): boolean {
    const idle = session?.time?.idle
    if (idle === undefined) return false
    return idle >= (newest?.time?.created ?? 0)
  }

  /**
   * Stop anything the finished turn left looking in flight.
   *
   * A tool block only leaves `streaming`/`running` when its own success or
   * failure event lands, and an assistant message is only marked completed by
   * `session.step.ended`. A turn that is interrupted — or whose events were lost
   * in a gap in the event stream — delivers neither, so the card spins and the
   * message streams forever although the server has moved on. Only the final
   * assistant message can still be in flight.
   */
  function settleUnfinishedTools(outcome: "succeeded" | "failed" | "interrupted") {
    let at = messages.value.length - 1
    while (at >= 0 && messages.value[at].type !== "assistant") at--
    if (at < 0) return
    const message = messages.value[at] as AssistantMessage

    const unfinished: StructuredError = {
      type: outcome,
      message:
        outcome === "interrupted"
          ? "The turn was interrupted before this tool reported a result."
          : "The turn ended before this tool reported a result.",
    }
    const content = message.content.map((block): AssistantBlock => {
      if (block.type !== "tool") return block
      if (block.state.status !== "streaming" && block.state.status !== "running") return block
      const input = block.state.status === "running" ? block.state.input : {}
      return {
        ...block,
        state: { status: "error", input, error: unfinished },
        time: { ...block.time, completed: block.time.completed ?? Date.now() },
      }
    })
    const time = message.time
    messages.value = messages.value.map((item, index) =>
      index === at
        ? { ...message, content, time: time ? { ...time, completed: time.completed ?? Date.now() } : time }
        : item,
    )
  }

  function completeTurn(outcome: "succeeded" | "failed" | "interrupted") {
    status.value = { type: "idle" }
    if (outcome === "failed") error.value = null
    settleUnfinishedTools(outcome)
  }

  function applyEvent(type: string, data: Record<string, unknown> | undefined) {
    if (!data) return
    const sessionID = data.sessionID as string | undefined
    const isCurrent = !sessionID || sessionID === currentSessionID.value

    switch (type) {
      case "session.execution.started":
        if (isCurrent) status.value = { type: "busy" }
        break
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted":
      case "session.idle": {
        if (!isCurrent) break
        // The idle event carries how the turn ended, and "interrupted" is the
        // one that used to leave the view spinning. Interrupting produces
        // `session.execution.interrupted` — a terminal event of its own — so it
        // has to end the turn here too: without it the last message keeps its
        // streaming caret blinking after the step is already over.
        const outcome =
          type === "session.idle"
            ? ((data.outcome as "succeeded" | "failed" | "interrupted" | undefined) ?? "succeeded")
            : type === "session.execution.failed"
              ? "failed"
              : type === "session.execution.interrupted"
                ? "interrupted"
                : "succeeded"
        completeTurn(outcome)
        break
      }
      case "session.step.started": {
        if (!isCurrent) return
        const messageID = data.assistantMessageID as string | undefined
        if (messageID) {
          ensureAssistant(messageID, {
            agent: (data.agent as string) ?? "",
            model: data.model as ModelRef | undefined,
            time: { created: (data.started as number) ?? Date.now() },
          })
        }
        break
      }
      case "session.step.failed": {
        if (!isCurrent) return
        const messageID = data.assistantMessageID as string | undefined
        const err = data.error as StructuredError | undefined
        // The failure belongs to the step it happened in, so it is shown on that
        // message. Mirroring it into the banner as well printed the same text
        // twice, one line above the other, every time a step was interrupted.
        if (messageID) updateAssistant(messageID, (message) => ({ ...message, error: err }))
        else error.value = err?.message ?? "Step failed"
        break
      }
      case "session.step.ended": {
        if (!isCurrent) return
        const messageID = data.assistantMessageID as string | undefined
        if (messageID) {
          updateAssistant(messageID, (message) => ({
            ...message,
            finish: data.finish as string | undefined,
            rawFinish: data.rawFinish as string | undefined,
            cost: (data.cost as number) ?? message.cost,
            tokens: (data.tokens as TokenUsage) ?? message.tokens,
            time: { ...message.time, completed: Date.now() },
          }))
        }
        break
      }
      case "session.text.started": {
        if (!isCurrent) return
        const messageID = data.assistantMessageID as string
        if (messageID) streamBlock(messageID, "text", (data.ordinal as number) ?? 0, "")
        break
      }
      case "session.text.delta": {
        if (!isCurrent) return
        const messageID = data.assistantMessageID as string
        const delta = data.delta as string | undefined
        if (messageID && delta) streamBlock(messageID, "text", (data.ordinal as number) ?? 0, delta)
        break
      }
      case "session.text.ended": {
        if (!isCurrent) return
        const messageID = data.assistantMessageID as string
        if (messageID) streamBlock(messageID, "text", (data.ordinal as number) ?? 0, data.text as string ?? "", true)
        break
      }
      case "session.reasoning.started": {
        if (!isCurrent) return
        const messageID = data.assistantMessageID as string
        if (messageID) streamBlock(messageID, "reasoning", (data.ordinal as number) ?? 0, "")
        break
      }
      case "session.reasoning.delta": {
        if (!isCurrent) return
        const messageID = data.assistantMessageID as string
        const delta = data.delta as string | undefined
        if (messageID && delta) streamBlock(messageID, "reasoning", (data.ordinal as number) ?? 0, delta)
        break
      }
      case "session.reasoning.ended": {
        if (!isCurrent) return
        const messageID = data.assistantMessageID as string
        if (messageID) streamBlock(messageID, "reasoning", (data.ordinal as number) ?? 0, data.text as string ?? "", true)
        break
      }
      case "session.tool.input.started": {
        if (!isCurrent) return
        const messageID = data.assistantMessageID as string
        if (messageID) upsertTool(messageID, data.id as string, { name: data.name as string, state: { status: "streaming", input: "" } })
        break
      }
      case "session.tool.input.delta": {
        if (!isCurrent) return
        const messageID = data.assistantMessageID as string
        const delta = data.delta as string | undefined
        if (messageID && delta) {
          const toolID = data.id as string
          updateAssistant(messageID, (message) => {
            const content = message.content.slice()
            const at = content.findIndex((block) => block.type === "tool" && block.id === toolID)
            if (at === -1) return message
            const block = content[at] as AssistantToolBlock
            const input = block.state.status === "streaming" ? block.state.input + delta : ""
            content[at] = { ...block, state: { status: "streaming", input } }
            return { ...message, content }
          })
        }
        break
      }
      case "session.tool.input.ended": {
        if (!isCurrent) return
        const messageID = data.assistantMessageID as string
        if (messageID) upsertTool(messageID, data.id as string, { inputText: data.text as string })
        break
      }
      case "session.tool.called": {
        if (!isCurrent) return
        const messageID = data.assistantMessageID as string
        if (messageID) {
          upsertTool(messageID, data.id as string, {
            state: { status: "running", input: (data.input as Record<string, unknown>) ?? {} },
            executed: data.executed as boolean | undefined,
          })
        }
        break
      }
      case "session.tool.progress": {
        if (!isCurrent) return
        const messageID = data.assistantMessageID as string
        const toolID = data.id as string
        if (messageID && toolID) {
          updateAssistant(messageID, (message) => {
            const content = message.content.slice()
            const at = content.findIndex((block) => block.type === "tool" && block.id === toolID)
            if (at === -1) return message
            const block = content[at] as AssistantToolBlock
            if (block.state.status === "running") {
              content[at] = { ...block, state: { ...block.state, metadata: data.metadata as Record<string, unknown> } }
            }
            return { ...message, content }
          })
        }
        break
      }
      case "session.tool.success": {
        if (!isCurrent) return
        const messageID = data.assistantMessageID as string
        if (messageID) {
          upsertTool(messageID, data.id as string, {
            state: {
              status: "completed",
              input: (data.input as Record<string, unknown>) ?? {},
              content: (data.content as ToolContent[]) ?? [],
              metadata: data.metadata as Record<string, unknown>,
            },
            executed: data.executed as boolean | undefined,
          })
        }
        break
      }
      case "session.tool.failed": {
        if (!isCurrent) return
        const messageID = data.assistantMessageID as string
        if (messageID) {
          upsertTool(messageID, data.id as string, {
            state: {
              status: "error",
              input: (data.input as Record<string, unknown>) ?? {},
              error: (data.error as StructuredError) ?? { type: "error", message: "Tool failed" },
              content: (data.content as ToolContent[]) ?? [],
              metadata: data.metadata as Record<string, unknown>,
            },
          })
        }
        break
      }
      case "permission.asked": {
        const request = data as unknown as PermissionRequest
        if (request?.id && !permissions.value.some((item) => item.id === request.id)) {
          permissions.value = [...permissions.value, request]
        }
        break
      }
      case "permission.replied":
      case "permission.rejected": {
        const id = data.requestID as string
        if (id) permissions.value = permissions.value.filter((item) => item.id !== id)
        break
      }
      // `form.created` wraps the form in `data.form`; the settled events carry
      // the id at the top level. Getting this wrong means a question never
      // reaches the dock and the agent waits forever for an answer.
      case "form.created": {
        const form = (data.form ?? data) as unknown as FormDetail
        if (form?.id && !forms.value.some((item) => item.id === form.id)) forms.value = [...forms.value, form]
        break
      }
      case "form.replied":
      case "form.cancelled": {
        const id = (data.id as string) ?? (data.formID as string)
        if (id) forms.value = forms.value.filter((item) => item.id !== id)
        break
      }
      default:
        break
    }
  }

  function reset() {
    currentSessionID.value = null
    messages.value = []
    streamIndex.clear()
    status.value = { type: "idle" }
    error.value = null
    permissions.value = []
    forms.value = []
    todos.value = []
  }

  return {
    messages,
    status,
    isBusy,
    awaitingUser,
    loading,
    sending,
    error,
    todos,
    pendingPermissions,
    pendingForms,
    currentSessionID,
    scrollToBottomRequest,
    requestScrollToBottom,
    open,
    reconcile,
    send,
    abort,
    replyPermission,
    replyForm,
    applyEvent,
    reset,
  }
}

export type { AssistantBlock, AssistantTextBlock, AssistantToolBlock }
export { joinText }
