import type { PermissionRule } from "@/api/types"

export type ToolState = "enabled" | "ask" | "disabled"

/** Glob match mirroring the server's Wildcard.match (only `*`/`?` wildcards). */
function match(value: string, pattern: string): boolean {
  if (pattern === "*" || pattern === value) return true
  if (!pattern.includes("*") && !pattern.includes("?")) return false
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")
  try {
    return new RegExp(`^${escaped}$`).test(value)
  } catch {
    return false
  }
}

/**
 * Effective state of a tool for an agent, using the same precedence as the
 * server: the last matching rule wins; a `*` deny disables the tool, an `ask`
 * gate is "ask", anything else is enabled.
 */
export function toolState(toolId: string, permission: PermissionRule[] | undefined): ToolState {
  const rules = permission ?? []
  const rule = [...rules].reverse().find((item) => match(toolId, item.permission))
  if (!rule) return "ask"
  if (rule.action === "deny" && rule.pattern === "*") return "disabled"
  if (rule.action === "ask") return "ask"
  return "enabled"
}
