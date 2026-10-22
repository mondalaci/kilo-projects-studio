import type { AssistantToolBlock } from "@/api/types"

export interface ComposeVariant {
  label?: string
  subject?: string
  body: string
}

export interface ComposedMessage {
  kind: string
  summaryTitle?: string
  variants: ComposeVariant[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text))
  } catch {
    return null
  }
}

function normalize(value: unknown): ComposedMessage | null {
  const obj = asRecord(value)
  if (!obj || !Array.isArray(obj.variants)) return null
  const variants = obj.variants
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => ({
      label: typeof item.label === "string" ? item.label : undefined,
      subject: typeof item.subject === "string" ? item.subject : undefined,
      body: typeof item.body === "string" ? item.body : "",
    }))
    .filter((item) => item.body.trim())
  if (!variants.length) return null
  return {
    kind: typeof obj.kind === "string" ? obj.kind : "message",
    summaryTitle: typeof obj.summary_title === "string" ? obj.summary_title : undefined,
    variants,
  }
}

/** The combined text of a tool block's completed output. */
export function toolOutputText(block: AssistantToolBlock): string {
  if (block.state.status === "completed" || block.state.status === "error") {
    return (block.state.content ?? [])
      .filter((item): item is { type: "text"; text: string } => item.type === "text")
      .map((item) => item.text)
      .join("")
  }
  return ""
}

/**
 * Extract the composed message(s) from a `message_compose_v1` tool block.
 *
 * The tool input carries the subject/label and the output carries the finalized
 * body, so the two are merged variant by variant. Returns null when the block is
 * not a composed message, letting the caller fall back to the generic tool view.
 */
export function composedMessage(block: AssistantToolBlock): ComposedMessage | null {
  if (!block.name.startsWith("message_compose")) return null
  const input = block.state.status === "streaming" ? null : normalize(block.state.input)
  const output = block.state.status === "completed" ? normalize(parseJson(toolOutputText(block))) : null
  const source = input ?? output
  if (!source) return null
  const variants = source.variants.map((variant, index) => ({
    ...variant,
    body: output?.variants[index]?.body || variant.body,
  }))
  return { ...source, variants }
}
