import { computed, ref } from "vue"
import type { PromptInput, ServerClient } from "@/api/client"
import type {
  AssistantBlock,
  AssistantMessage,
  AssistantTextBlock,
  AssistantToolBlock,
  FormDetail,
  ModelRef,
  PermissionReply,
  PermissionRequest,
  SessionMessage,
  StructuredError,
  TokenUsage,
  ToolContent,
  ToolState,
  UserMessage,
} from "@/api/types"

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
    if (kind === "text") content[at] = { type: "text", text: nextText }
    else content[at] = { type: "reasoning", text: nextText, time: (block as { time?: { created: number } }).time }
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

  async function open(client: ServerClient, sessionID: string, directory?: string) {
    currentSessionID.value = sessionID
    loading.value = true
    error.value = null
    messages.value = []
    streamIndex.clear()
    todos.value = []
    status.value = { type: "idle" }
    try {
      const [list, perms, formList] = await Promise.all([
        client.messages(sessionID, { directory, order: "asc" }),
        client.sessionPermissions(sessionID, { directory }).catch(() => [] as PermissionRequest[]),
        client.sessionForms(sessionID, { directory }).catch(() => [] as FormDetail[]),
      ])
      messages.value = list
      permissions.value = perms
      forms.value = formList
      // A trailing assistant message that never completed means the server is
      // still working on it.
      const last = list[list.length - 1]
      if (last?.type === "assistant" && !last.time?.completed) status.value = { type: "busy" }
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
      const [list, formList] = await Promise.all([
        client.messages(sessionID, { directory, order: "asc" }),
        client.sessionForms(sessionID, { directory }).catch(() => [] as FormDetail[]),
      ])
      if (currentSessionID.value !== sessionID) return
      messages.value = list
      streamIndex.clear()
      forms.value = formList
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
      // persisted attachments) replaces it on the reconcile at turn end.
      const optimistic: UserMessage = {
        id: `local-${Date.now()}`,
        type: "user",
        text: input.text,
        files: input.files?.map((file) => ({ mime: file.mime, name: file.filename })),
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

  async function abort(client: ServerClient, sessionID: string, directory?: string) {
    await client.interrupt(sessionID, { directory })
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

  function completeTurn(outcome: "succeeded" | "failed") {
    status.value = { type: "idle" }
    if (outcome === "failed") error.value = null
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
      case "session.idle":
        if (isCurrent) completeTurn(type === "session.execution.failed" ? "failed" : "succeeded")
        break
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
        if (messageID) updateAssistant(messageID, (message) => ({ ...message, error: err }))
        error.value = err?.message ?? "Step failed"
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
      case "form.created": {
        const form = data as unknown as FormDetail
        if (form?.id && !forms.value.some((item) => item.id === form.id)) forms.value = [...forms.value, form]
        break
      }
      case "form.replied": {
        const id = (data.formID as string) ?? (data.id as string)
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
