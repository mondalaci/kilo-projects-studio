/**
 * The `/name` head of a prompt.
 *
 * A prompt that starts with a slash and names a stored command is run as that
 * command rather than sent as text, and everything after the first separator is
 * the command's input. The server's own composer splits it the same way, so the
 * two agree on where the name ends and the arguments begin.
 */
export interface SlashHead {
  name: string
  arguments: string
}

export function parseSlashHead(text: string): SlashHead | null {
  if (!text.startsWith("/")) return null

  const end = text.slice(1).search(/[ \t\n]/)
  if (end === -1) return { name: text.slice(1), arguments: "" }

  const split = end + 1
  return { name: text.slice(1, split), arguments: text.slice(split + 1) }
}
