/**
 * Parsing for the `pronunciation` fenced code block that the assistant emits in
 * chat to request audio word samples.
 *
 * Accepts either a JSON array of entries:
 *
 *   ```pronunciation
 *   [{ "word": "thought", "ipa": "/θɔːt/", "hint": "th as in think" }]
 *   ```
 *
 * or a plain line list (`word | ipa | hint`), which is friendlier to type:
 *
 *   ```pronunciation
 *   thought | /θɔːt/ | th as in think
 *   thorough | /ˈθʌr.ə/
 *   ```
 */

export interface PronunciationEntry {
  /** Text sent to the speech model. */
  word: string
  /** Optional IPA transcription shown beside the word. */
  ipa?: string
  /** Optional usage hint shown below the word. */
  hint?: string
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (typeof value === "number") return String(value)
  return undefined
}

function toEntry(item: unknown): PronunciationEntry | null {
  if (typeof item === "string") {
    const word = item.trim()
    return word ? { word } : null
  }
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>
    const word = asString(record.word) ?? asString(record.text) ?? asString(record.term)
    if (!word) return null
    return {
      word,
      ipa: asString(record.ipa) ?? asString(record.phonetic),
      hint: asString(record.hint) ?? asString(record.note) ?? asString(record.meaning),
    }
  }
  return null
}

function parseLines(text: string): PronunciationEntry[] {
  const entries: PronunciationEntry[] = []
  for (const rawLine of text.split("\n")) {
    let line = rawLine.trim()
    if (!line) continue
    // Skip markdown headings, comments and table separators.
    if (line.startsWith("#") || line.startsWith("//")) continue
    // Trim stray JSON punctuation left over from a malformed array.
    line = line.replace(/^[[{]\s*/, "").replace(/\s*[\]}],?$/, "")
    if (!line || /^[-|\s:]+$/.test(line)) continue
    const parts = line.split("|").map((part) => part.trim())
    const word = parts[0]?.replace(/^["']|["']$/g, "").trim()
    if (!word) continue
    entries.push({
      word,
      ipa: parts[1]?.replace(/^["']|["']$/g, "") || undefined,
      hint: parts[2]?.replace(/^["']|["']$/g, "") || undefined,
    })
  }
  return entries
}

export function parsePronunciation(source: string): PronunciationEntry[] {
  const text = (source ?? "").trim()
  if (!text) return []

  const parsed = tryParseJson(text)
  if (Array.isArray(parsed)) return parsed.map(toEntry).filter((entry): entry is PronunciationEntry => entry !== null)
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>
    const list = record.words ?? record.entries ?? record.items
    if (Array.isArray(list)) return list.map(toEntry).filter((entry): entry is PronunciationEntry => entry !== null)
  }

  // Looks like JSON but did not parse: fall back to the line parser only for
  // freeform text, otherwise report no entries rather than scrape junk.
  if (text.startsWith("[") || text.startsWith("{")) return []
  return parseLines(text)
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
