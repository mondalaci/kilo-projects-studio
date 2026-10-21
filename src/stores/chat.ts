import { computed, ref } from "vue"
import type { ServerClient } from "@/api/client"
import type {
  MessageInfo,
  MessageWithParts,
  ModelRef,
  Part,
  PermissionRequest,
  QuestionRequest,
  SessionStatus,
  Todo,
} from "@/api/types"

interface PromptInput {
  parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string; filename?: string }>
  model?: ModelRef | null
  agent?: string
  variant?: string
  tools?: Record<string, boolean>
}

const messages = ref<MessageWithParts[]>([])
const status = ref<SessionStatus>({ type: "idle" })
const loading = ref(false)
const sending = ref(false)
const error = ref<string | null>(null)
const permissions = ref<PermissionRequest[]>([])
const questions = ref<QuestionRequest[]>([])
const todos = ref<Todo[]>([])
const currentSessionID = ref<string | null>(null)

/** Bumped when the view should force a re-pin and scroll to the bottom. */
const scrollToBottomRequest = ref(0)

/** Ask the conversation to show its end, e.g. when the diff view closes. */
function requestScrollToBottom() {
  scrollToBottomRequest.value++
}

/** Parts that arrived before their parent message (rare, but handled). */
const orphanParts = new Map<string, Part[]>()

function sortMessages() {
  messages.value = [...messages.value].sort(
    (a, b) => (a.info.time?.created ?? 0) - (b.info.time?.created ?? 0),
  )
}

function findMessage(messageID: string) {
  return messages.value.find((item) => item.info.id === messageID)
}

function upsertInfo(info: MessageInfo) {
  const existing = findMessage(info.id)
  if (existing) {
    existing.info = { ...existing.info, ...info } as MessageInfo
    return existing
  }
  const entry: MessageWithParts = { info, parts: [] }
  const orphans = orphanParts.get(info.id)
  if (orphans) {
    entry.parts = orphans
    orphanParts.delete(info.id)
  }
  messages.value = [...messages.value, entry]
  sortMessages()
  return entry
}

function upsertPart(part: Part) {
  const entry = findMessage(part.messageID)
  if (!entry) {
    const list = orphanParts.get(part.messageID) ?? []
    const index = list.findIndex((item) => item.id === part.id)
    if (index === -1) list.push(part)
    else list[index] = { ...list[index], ...part }
    orphanParts.set(part.messageID, list)
    return
  }
  const index = entry.parts.findIndex((item) => item.id === part.id)
  if (index === -1) entry.parts = [...entry.parts, part]
  else entry.parts = entry.parts.map((item, i) => (i === index ? { ...item, ...part } : item))
}

/**
 * Append an incremental streamed chunk (`message.part.delta`) to a part's text
 * or reasoning field, creating the part if it does not exist yet.
 */
function appendDelta(messageID: string, partID: string, sessionID: string, field: string, delta: string) {
  const entry = findMessage(messageID)
  if (!entry) {
    const list = orphanParts.get(messageID) ?? []
    const index = list.findIndex((item) => item.id === partID)
    if (index === -1) {
      list.push({ id: partID, sessionID, messageID, type: field === "reasoning" ? "reasoning" : "text", [field]: delta } as unknown as Part)
    } else {
      const current = list[index] as Record<string, unknown>
      list[index] = { ...current, [field]: String(current[field] ?? "") + delta } as unknown as Part
    }
    orphanParts.set(messageID, list)
    return
  }
  const index = entry.parts.findIndex((item) => item.id === partID)
  if (index === -1) {
    entry.parts = [
      ...entry.parts,
      { id: partID, sessionID, messageID, type: field === "reasoning" ? "reasoning" : "text", [field]: delta } as unknown as Part,
    ]
  } else {
    const current = entry.parts[index] as unknown as Record<string, unknown>
    const next = { ...current, [field]: String(current[field] ?? "") + delta } as unknown as Part
    entry.parts = entry.parts.map((item, i) => (i === index ? next : item))
  }
}

export function useChat() {
  const isBusy = computed(() => status.value.type === "busy" || status.value.type === "retry")

  const pendingPermissions = computed(() =>
    permissions.value.filter((request) => request.sessionID === currentSessionID.value),
  )
  const pendingQuestions = computed(() =>
    questions.value.filter((request) => request.sessionID === currentSessionID.value),
  )

  async function open(client: ServerClient, sessionID: string, directory?: string) {
    currentSessionID.value = sessionID
    loading.value = true
    error.value = null
    messages.value = []
    orphanParts.clear()
    todos.value = []
    status.value = { type: "idle" }
    try {
      const [list, todoList, perms, questi] = await Promise.all([
        client.messages(sessionID, { directory }),
        client.todos(sessionID, { directory }).catch(() => [] as Todo[]),
        client.listPermissions({ directory }).catch(() => [] as PermissionRequest[]),
        client.listQuestions({ directory }).catch(() => [] as QuestionRequest[]),
      ])
      messages.value = list
      todos.value = todoList
      permissions.value = perms
      questions.value = questi
      // Any assistant message without a completion timestamp means the server
      // is still working on it.
      const streaming = list.some(
        (item) => item.info.role === "assistant" && !(item.info as { time?: { completed?: number } }).time?.completed,
      )
      if (streaming) status.value = { type: "busy" }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function send(client: ServerClient, sessionID: string, input: PromptInput, directory?: string) {
    sending.value = true
    error.value = null
    scrollToBottomRequest.value++
    try {
      await client.prompt(
        sessionID,
        {
          parts: input.parts,
          model: input.model
            ? { providerID: input.model.providerID, modelID: input.model.modelID }
            : undefined,
          agent: input.agent,
          variant: input.variant ?? input.model?.variant,
          tools: input.tools,
        },
        { directory },
      )
      status.value = { type: "busy" }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      sending.value = false
    }
  }

  async function abort(client: ServerClient, sessionID: string, directory?: string) {
    await client.abort(sessionID, { directory })
    status.value = { type: "idle" }
  }

  async function replyPermission(
    client: ServerClient,
    requestID: string,
    reply: "once" | "always" | "reject",
    directory?: string,
  ) {
    await client.replyPermission(requestID, reply, { directory })
    permissions.value = permissions.value.filter((item) => item.id !== requestID)
  }

  async function replyQuestion(client: ServerClient, requestID: string, answers: string[][], directory?: string) {
    await client.replyQuestion(requestID, answers, { directory })
    questions.value = questions.value.filter((item) => item.id !== requestID)
  }

  async function rejectQuestion(client: ServerClient, requestID: string, directory?: string) {
    await client.rejectQuestion(requestID, { directory })
    questions.value = questions.value.filter((item) => item.id !== requestID)
  }

  function applyEvent(type: string, properties: Record<string, unknown> | undefined) {
    if (!properties) return
    const sessionID = properties.sessionID as string | undefined
    const isCurrent = !sessionID || sessionID === currentSessionID.value

    switch (type) {
      case "message.updated": {
        if (!isCurrent) return
        const info = properties.info as MessageInfo | undefined
        if (info) upsertInfo(info)
        break
      }
      case "message.removed": {
        if (!isCurrent) return
        const id = (properties.messageID as string) ?? (properties.info as MessageInfo | undefined)?.id
        if (id) messages.value = messages.value.filter((item) => item.info.id !== id)
        break
      }
      case "message.part.updated": {
        if (!isCurrent) return
        const part = properties.part as Part | undefined
        if (part) upsertPart(part)
        break
      }
      case "message.part.delta": {
        if (!isCurrent) return
        const messageID = properties.messageID as string
        const partID = properties.partID as string
        const field = (properties.field as string) || "text"
        const delta = properties.delta as string | undefined
        if (messageID && partID && delta != null) {
          appendDelta(messageID, partID, properties.sessionID as string, field, delta)
        }
        break
      }
      case "message.part.removed": {
        if (!isCurrent) return
        const messageID = properties.messageID as string
        const partID = properties.partID as string
        const entry = findMessage(messageID)
        if (entry) entry.parts = entry.parts.filter((item) => item.id !== partID)
        break
      }
      case "session.status": {
        if (!isCurrent) return
        const next = properties.status as SessionStatus | undefined
        if (next) status.value = next
        break
      }
      case "session.idle": {
        if (!isCurrent) return
        status.value = { type: "idle" }
        break
      }
      case "session.error": {
        if (!isCurrent) return
        const err = properties.error as { data?: { message?: string } } | undefined
        error.value = err?.data?.message ?? "Session error"
        break
      }
      case "todo.updated": {
        if (!isCurrent) return
        if (Array.isArray(properties.todos)) todos.value = properties.todos as Todo[]
        break
      }
      case "permission.asked":
      case "permission.v2.asked": {
        const request = properties as unknown as PermissionRequest
        if (request?.id && !permissions.value.some((item) => item.id === request.id)) {
          permissions.value = [...permissions.value, request]
        }
        break
      }
      case "permission.replied":
      case "permission.v2.replied": {
        const id = properties.requestID as string
        permissions.value = permissions.value.filter((item) => item.id !== id)
        break
      }
      case "question.asked":
      case "question.v2.asked": {
        const request = properties as unknown as QuestionRequest
        if (request?.id && !questions.value.some((item) => item.id === request.id)) {
          questions.value = [...questions.value, request]
        }
        break
      }
      case "question.replied":
      case "question.v2.replied":
      case "question.rejected":
      case "question.v2.rejected": {
        const id = (properties.requestID as string) ?? (properties.id as string)
        questions.value = questions.value.filter((item) => item.id !== id)
        break
      }
      default:
        break
    }
  }

  function reset() {
    currentSessionID.value = null
    messages.value = []
    orphanParts.clear()
    status.value = { type: "idle" }
    error.value = null
    permissions.value = []
    questions.value = []
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
    pendingQuestions,
    currentSessionID,
    scrollToBottomRequest,
    requestScrollToBottom,
    open,
    send,
    abort,
    replyPermission,
    replyQuestion,
    rejectQuestion,
    applyEvent,
    reset,
  }
}