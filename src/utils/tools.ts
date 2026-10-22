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
 * Effective state of a tool for an agent, using the same precedence as the v2
 * server: the last matching rule wins; a `deny` on `*` disables the tool, an
 * `ask` gate is "ask", anything else is enabled.
 */
export function toolState(toolId: string, permissions: PermissionRule[] | undefined): ToolState {
  const rules = permissions ?? []
  const rule = [...rules].reverse().find((item) => match(toolId, item.resource))
  if (!rule) return "ask"
  if (rule.effect === "deny" && rule.resource === "*") return "disabled"
  if (rule.effect === "ask") return "ask"
  return "enabled"
}
