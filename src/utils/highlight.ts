import hljs from "highlight.js/lib/common"
import type { DiffHunk } from "./diff"

/**
 * Syntax highlighting for the diff and file views.
 *
 * Highlighting happens over a whole side of a hunk, not line by line: a block
 * comment or a template string spans lines, and highlighting each line in
 * isolation would colour it as plain code. The highlighted HTML is then split
 * back into lines — with the tags that straddle a line break closed and reopened,
 * so every line is a self-contained fragment that can be rendered on its own.
 */

/** Beyond this, highlighting costs more than it is worth. */
const MAX_LINES = 3000

/**
 * Extensions we can name outright. highlight.js has a filename resolver, but it
 * only knows a few names, and the app needs to cover its own stack.
 */
const EXTENSIONS: Record<string, string> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cfg: "ini",
  clj: "clojure",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cxx: "cpp",
  diff: "diff",
  dockerfile: "dockerfile",
  env: "bash",
  ex: "elixir",
  exs: "elixir",
  go: "go",
  graphql: "graphql",
  h: "c",
  hpp: "cpp",
  hs: "haskell",
  htm: "xml",
  html: "xml",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  json5: "json",
  jsonc: "json",
  jsx: "javascript",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  lua: "lua",
  md: "markdown",
  mjs: "javascript",
  mm: "objectivec",
  patch: "diff",
  php: "php",
  pl: "perl",
  plist: "xml",
  proto: "protobuf",
  ps1: "powershell",
  py: "python",
  pyi: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  sass: "scss",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svelte: "xml",
  swift: "swift",
  toml: "ini",
  ts: "typescript",
  tsv: "plaintext",
  tsx: "typescript",
  txt: "plaintext",
  vue: "xml",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
}

/** Languages without an extension worth recognising. */
const FILENAMES: Record<string, string> = {
  dockerfile: "dockerfile",
  gemfile: "ruby",
  makefile: "makefile",
  procfile: "bash",
  ".bashrc": "bash",
  ".env": "bash",
  ".gitignore": "bash",
  ".npmrc": "ini",
  ".zshrc": "bash",
}

/** The highlight.js language for a repository-relative path, if we know one. */
export function languageForPath(path: string): string | null {
  const lower = path.toLowerCase()
  const name = lower.split("/").pop() ?? lower
  const byName = FILENAMES[name]
  if (byName) return byName

  const dot = name.lastIndexOf(".")
  if (dot === -1) return null
  const extension = name.slice(dot + 1)
  const language = EXTENSIONS[extension]
  if (!language || language === "plaintext") return null
  return hljs.getLanguage(language) ? language : null
}

/**
 * Split highlighted HTML into one fragment per source line.
 *
 * The tags highlight.js opens can span line breaks, so each fragment gets the
 * open tags re-emitted after the break and the corresponding closers before it,
 * which is what makes the fragments independently renderable.
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = []
  const open: string[] = []
  let current = ""

  const close = () => open.map(() => "</span>").join("")
  const reopen = () => open.join("")

  for (let index = 0; index < html.length; ) {
    const char = html[index]

    if (char === "\n") {
      lines.push(current + close())
      current = reopen()
      index++
      continue
    }

    if (char === "<") {
      const end = html.indexOf(">", index)
      if (end === -1) {
        current += html.slice(index)
        break
      }
      const tag = html.slice(index, end + 1)
      if (tag.startsWith("<span")) open.push(tag)
      else if (tag.startsWith("</span")) open.pop()
      current += tag
      index = end + 1
      continue
    }

    current += char
    index++
  }

  lines.push(current + close())
  return lines
}

/**
 * One highlighted HTML fragment per line of `code`, or null when the language is
 * unknown or the text is too large to bother with.
 */
export function highlightLines(code: string, language: string | null): string[] | null {
  if (!language) return null
  const lineCount = code.length ? code.split("\n").length : 0
  if (lineCount > MAX_LINES) return null
  try {
    const result = hljs.highlight(code, { language, ignoreIllegals: true })
    return splitHighlightedLines(result.value)
  } catch {
    return null
  }
}

/** Highlighted HTML per source line, for each side of a diff. */
export interface HighlightedSides {
  /** Keyed by absolute line number in the old file. */
  old: Map<number, string>
  /** Keyed by absolute line number in the new file. */
  new: Map<number, string>
}

/**
 * Highlight every hunk, returning one fragment per source line of each side.
 *
 * Each side is highlighted whole (so multi-line constructs keep their colour) and
 * then split back into lines. Walking the hunk's own line numbers is what keeps
 * the fragments attached to the right rows: a deletion only exists on the old
 * side and an addition only on the new one, so the two sides advance
 * independently.
 */
export function highlightHunks(hunks: DiffHunk[], language: string | null): HighlightedSides | null {
  if (!language || !hunks.length) return null

  const oldLines = new Map<number, string>()
  const newLines = new Map<number, string>()

  for (const hunk of hunks) {
    const oldFragments = highlightLines(
      hunk.lines
        .filter((line) => line.type === "context" || line.type === "del")
        .map((line) => line.text)
        .join("\n"),
      language,
    )
    const newFragments = highlightLines(
      hunk.lines
        .filter((line) => line.type === "context" || line.type === "add")
        .map((line) => line.text)
        .join("\n"),
      language,
    )
    if (!oldFragments || !newFragments) return null

    let oldIndex = 0
    let newIndex = 0
    for (const line of hunk.lines) {
      if (line.type === "context") {
        if (line.oldNo !== null) oldLines.set(line.oldNo, oldFragments[oldIndex] ?? "")
        if (line.newNo !== null) newLines.set(line.newNo, newFragments[newIndex] ?? "")
        oldIndex++
        newIndex++
      } else if (line.type === "del") {
        if (line.oldNo !== null) oldLines.set(line.oldNo, oldFragments[oldIndex] ?? "")
        oldIndex++
      } else if (line.type === "add") {
        if (line.newNo !== null) newLines.set(line.newNo, newFragments[newIndex] ?? "")
        newIndex++
      }
    }
  }

  return { old: oldLines, new: newLines }
}
