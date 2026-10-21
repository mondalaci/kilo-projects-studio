/**
 * Types for the Kilo Code / opencode v1 server HTTP API.
 *
 * Derived from the server's OpenAPI schema (`kilo 1.0.0`). The fork keeps the
 * opencode v1 instance API (`/session`, `/message`, `/event`, `/config`,
 * `/agent`, `/provider`) and layers extra `/kilo/*` and `/kilocode/*` routes on
 * top, so these types intentionally model the shared subset.
 */

export type SessionID = string
export type MessageID = string
export type PartID = string

export interface TimeRange {
  start?: number
  end?: number
  created?: number
  updated?: number
  completed?: number
  compacting?: number
  archived?: number
}

export interface Tokens {
  total?: number
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export interface ModelRef {
  providerID: string
  modelID: string
  variant?: string
}

export interface SessionInfo {
  id: SessionID
  slug?: string
  projectID?: string
  workspaceID?: string
  directory?: string
  path?: string
  parentID?: string
  title: string
  version?: string
  agent?: string
  model?: { id: string; providerID: string; variant?: string }
  cost?: number
  tokens?: Tokens
  time: TimeRange
  summary?: { additions: number; deletions: number; files: number }
  share?: { url: string }
  revert?: { messageID: string }
  [key: string]: unknown
}

export interface UserMessage {
  id: MessageID
  sessionID: SessionID
  role: "user"
  time: { created: number }
  agent: string
  model: ModelRef
  system?: string
  format?: unknown
  summary?: { title?: string; body?: string; diffs?: unknown[] }
  editorContext?: unknown
}

export interface MessageError {
  name?: string
  data?: { message?: string; [k: string]: unknown }
  [k: string]: unknown
}

export interface AssistantMessage {
  id: MessageID
  sessionID: SessionID
  role: "assistant"
  time: { created: number; completed?: number }
  parentID: MessageID
  modelID: string
  providerID: string
  mode?: string
  agent: string
  path?: { cwd: string; root: string }
  summary?: boolean
  cost: number
  tokens: Tokens
  variant?: string
  finish?: string
  error?: MessageError
}

export type MessageInfo = UserMessage | AssistantMessage

export interface TextPart {
  id: PartID
  sessionID: SessionID
  messageID: MessageID
  type: "text"
  text: string
  synthetic?: boolean
  ignored?: boolean
  time?: TimeRange
  metadata?: Record<string, unknown>
}

export interface ReasoningPart {
  id: PartID
  sessionID: SessionID
  messageID: MessageID
  type: "reasoning"
  text: string
  time?: TimeRange
  metadata?: Record<string, unknown>
}

export interface FilePart {
  id: PartID
  sessionID: SessionID
  messageID: MessageID
  type: "file"
  mime: string
  filename?: string
  url: string
  source?: unknown
}

export interface ToolStatePending {
  status: "pending"
  input: Record<string, unknown>
  raw: string
}
export interface ToolStateRunning {
  status: "running"
  input: Record<string, unknown>
  title?: string
  metadata?: Record<string, unknown>
  time: TimeRange
}
export interface ToolStateCompleted {
  status: "completed"
  input: Record<string, unknown>
  output: string
  title: string
  metadata: Record<string, unknown>
  time: TimeRange
  attachments?: FilePart[]
}
export interface ToolStateError {
  status: "error"
  input: Record<string, unknown>
  error: string
  metadata?: Record<string, unknown>
  time: TimeRange
}
export type ToolState = ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError

export interface ToolPart {
  id: PartID
  sessionID: SessionID
  messageID: MessageID
  type: "tool"
  callID: string
  tool: string
  state: ToolState
  metadata?: Record<string, unknown>
}

export interface ScaffoldPart {
  id: PartID
  sessionID: SessionID
  messageID: MessageID
  type: string
  [k: string]: unknown
}

export type Part =
  | TextPart
  | ReasoningPart
  | FilePart
  | ToolPart
  | (ScaffoldPart & { type: "step-start" | "step-finish" | "snapshot" | "patch" | "agent" | "retry" | "compaction" | "subtask" })

export interface MessageWithParts {
  info: MessageInfo
  parts: Part[]
}

export interface Agent {
  name: string
  displayName?: string
  description?: string
  source?: string
  mode: "primary" | "subagent" | "all"
  native?: boolean
  hidden?: boolean
  deprecated?: boolean
  color?: string
  model?: { modelID: string; providerID: string }
  variant?: string
  permission?: PermissionRule[]
  [k: string]: unknown
}

export interface PermissionRule {
  permission: string
  pattern: string
  action: "allow" | "ask" | "deny"
}

export interface ModelCapabilities {
  temperature: boolean
  reasoning: boolean
  attachment: boolean
  toolcall: boolean
  input: Record<string, boolean>
  output: Record<string, boolean>
  interleaved?: boolean | { field: string }
}

export interface ModelCost {
  /** USD per 1M input tokens. */
  input: number
  /** USD per 1M output tokens. */
  output: number
  cache?: { read: number; write: number }
  tiers?: Array<{ input: number; output: number; cache?: { read: number; write: number }; tier: { type: string; size: number } }>
  experimentalOver200K?: { input: number; output: number; cache?: { read: number; write: number } }
}

export interface Model {
  id: string
  providerID: string
  name: string
  family?: string
  status?: "alpha" | "beta" | "deprecated" | "active"
  capabilities: ModelCapabilities
  cost?: ModelCost
  limit?: { context: number; output: number; input?: number }
  options?: Record<string, unknown>
  variants?: Record<string, unknown>
  isFree?: boolean
  release_date?: string
  [k: string]: unknown
}

export interface Provider {
  id: string
  name: string
  source: string
  env?: string[]
  key?: string
  options?: Record<string, unknown>
  models: Record<string, Model>
  [k: string]: unknown
}

export interface ProviderList {
  all: Provider[]
  default: Record<string, string>
  connected: string[]
  failed: string[]
}

export interface ServerConfig {
  $schema?: string
  model?: string
  small_model?: string
  default_agent?: string
  agent?: Record<string, unknown>
  mode?: Record<string, unknown>
  username?: string
  [k: string]: unknown
}

export interface Todo {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled" | string
  priority?: string
}

export type SessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number }
  | { type: "offline"; requestID: string; message: string }

export interface PermissionRequest {
  id: string
  sessionID: SessionID
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always?: string[]
  tool?: { messageID: string; callID: string }
}

export interface QuestionOption {
  label: string
  description: string
  mode?: string
}

export interface QuestionInfo {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  default?: string
  custom?: boolean
}

export interface QuestionRequest {
  id: string
  sessionID: SessionID
  questions: QuestionInfo[]
  blocking?: boolean
}

export interface Command {
  name: string
  description?: string
  agent?: string
  model?: string
  source?: string
  template: string
  hints?: string[]
}

export interface PathInfo {
  home: string
  state: string
  config: string
  worktree: string
  directory: string
}

export interface Project {
  id: string
  worktree: string
  name?: string
  vcs?: { type?: string; branch?: string } | unknown
  icon?: unknown
  time?: unknown
  sandboxes?: string[]
}

export interface ModelState {
  /** Per-agent chosen model. */
  model: Record<string, ModelRef>
  recent: ModelRef[]
  favorite: ModelRef[]
  variant: Record<string, string>
}

export interface ToolListItem {
  id: string
  description: string
  parameters?: unknown
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

export interface BaseEvent {
  id?: string
  type: string
  properties?: Record<string, unknown>
}

export interface SyncEnvelope {
  type: "sync"
  syncEvent: {
    id: string
    type: string
    seq: number
    aggregateID?: string
    data: Record<string, unknown>
  }
}

export type ServerEvent = BaseEvent | SyncEnvelope

/**
 * One frame of the global (`/global/event`) stream: an event from any project,
 * tagged with the directory it came from.
 */
export interface GlobalEventEnvelope {
  directory?: string
  project?: string
  payload?: ServerEvent
}

export interface GlobalHealth {
  healthy: true
  version: string
}