/**
 * Slash commands in the composer, as the TUI implements them.
 *
 * A prompt that begins with `/` is a command: the name runs to the first
 * whitespace, everything after it is the argument string. While the caret still
 * sits inside that leading token the composer shows a filterable list — this
 * app's own commands plus the ones the server registers — and Enter picks from
 * the list instead of sending.
 *
 * Only a name the *server* knows is sent to `POST /session/{id}/command`.
 * Everything else, this app's own commands included, goes out as an ordinary
 * prompt. That split is deliberate and it is the TUI's own: a mistyped
 * `/models` is answered by the model rather than swallowed by a command nobody
 * has ever heard of.
 */

export interface ParsedSlash {
  /** The text between `/` and the first whitespace, verbatim. */
  name: string
  /** Everything after that whitespace, verbatim. */
  arguments: string
  /** Offset just past the name, where the arguments begin. */
  end: number
}

/** The whitespace that ends a command name, matching the server's own split. */
const NAME_END = /[ \t\n]/

/**
 * Read a leading `/name args` command out of a prompt.
 *
 * Returns `undefined` for anything that does not start with `/`, including a
 * bare slash mark on its own line further down.
 */
export function parseSlash(text: string): ParsedSlash | undefined {
  if (!text.startsWith("/")) return undefined
  const found = text.slice(1).search(NAME_END)
  if (found === -1) return { name: text.slice(1), arguments: "", end: text.length }
  const end = found + 1
  return { name: text.slice(1, end), arguments: text.slice(end + 1), end }
}

/**
 * The text the command menu should filter on, or `undefined` when no menu
 * belongs on screen.
 *
 * `beforeCaret` is the composer text up to the caret. The menu follows a
 * leading `/` token only, and a single whitespace is enough to end it — which
 * is why `/rename my conversation` is an argument, not a filter.
 */
export function slashQuery(beforeCaret: string): string | undefined {
  if (!beforeCaret.startsWith("/")) return undefined
  if (NAME_END.test(beforeCaret)) return undefined
  return beforeCaret.slice(1)
}

export interface SlashCommand {
  /** The `/name` as it is written into the prompt. */
  display: string
  /** The line beside the name: the server's description, or this app's own. */
  description?: string
  /**
   * Write `/<name> ` into the prompt and leave the rest to be typed, rather
   * than acting straight away. A server command is always inserted; a command
   * of this app's own sets it when it takes arguments.
   */
  insert?: boolean
  /** What a command of this app's own does; `input` is its argument text. */
  run?: (input: string) => void | Promise<void>
  /** Other names that answer to this command, as the TUI's aliases do. */
  aliases?: string[]
}

/** Rows the menu shows at once. The TUI caps its own list at ten. */
export const SLASH_MENU_ROWS = 10

/**
 * Flatten aliases into rows of their own.
 *
 * The TUI lists every alias as a separate entry — `/sessions`, `/resume` and
 * `/continue` are three rows for one command — and filtering, ordering and
 * picking all work on the flattened list, so an alias is discoverable the same
 * way the command name is.
 */
export function expandSlashCommands(commands: SlashCommand[]): SlashCommand[] {
  const rows: SlashCommand[] = []
  for (const command of commands) {
    const { aliases = [], ...rest } = command
    rows.push(command)
    for (const alias of aliases) rows.push({ ...rest, display: `/${alias}` })
  }
  return rows
}

/**
 * Score one row against a query, or `null` when it does not match at all.
 *
 * The name is what was typed, so it decides the order and a name that starts
 * with the query wins outright; the description and the aliases only rescue a
 * row the name alone cannot place.
 */
export function slashMatch(query: string, command: SlashCommand): number | null {
  const wanted = query.trim().toLowerCase()
  if (!wanted) return 0
  const name = command.display.toLowerCase()
  const onName = match(wanted, name)
  if (onName !== null) return onName + (name.startsWith(wanted) ? 100 : 0)
  const elsewhere = [command.description ?? "", ...(command.aliases ?? []).map((alias) => `/${alias}`)]
  let best: number | null = null
  for (const haystack of elsewhere) {
    const score = match(wanted, haystack.toLowerCase())
    if (score === null) continue
    best = best === null ? score : Math.max(best, score)
  }
  return best
}

/**
 * Score a query as an ordered subsequence of `target`: every character has to
 * appear, in order, but not necessarily together. Consecutive characters and a
 * match early in the target are worth more, so `/sess` puts `/sessions` above
 * anything that merely happens to contain those letters.
 */
function match(query: string, target: string): number | null {
  let at = 0
  let score = 0
  let run = 0
  let previous = -2
  for (const character of query) {
    const found = target.indexOf(character, at)
    if (found === -1) return null
    run = found === previous + 1 ? run + 1 : 0
    score += 2 + run * 2
    previous = found
    at = found + 1
  }
  return score - Math.min(target.length, 40)
}

/**
 * The rows a query leaves, best first and capped at what the menu can show.
 *
 * An empty query is not a filter: every row matches, and the alphabetical order
 * the caller handed in is kept.
 */
export function rankSlashCommands(query: string, commands: SlashCommand[]): SlashCommand[] {
  const scored: Array<{ command: SlashCommand; score: number }> = []
  for (const command of commands) {
    const score = slashMatch(query, command)
    if (score === null) continue
    scored.push({ command, score })
  }
  scored.sort((a, b) => b.score - a.score || a.command.display.localeCompare(b.command.display))
  return scored.slice(0, SLASH_MENU_ROWS).map((entry) => entry.command)
}
