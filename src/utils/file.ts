/** Helpers for the `file` parts the server echoes back for attachments. */

const TEXT_MIME =
  /^(text\/|application\/(json|ld\+json|xml|javascript|typescript|x-javascript|x-typescript|x-yaml|yaml|x-sh|toml|x-python|x-ruby|x-rust|x-go|x-java|x-c|x-c\+\+|sql|csv|graphql|x-httpd-php)|image\/svg)/i

export function isTextMime(mime?: string): boolean {
  return !!mime && TEXT_MIME.test(mime)
}

export interface ParsedDataUrl {
  mime: string
  base64: boolean
  data: string
}

export function parseDataUrl(url?: string): ParsedDataUrl | null {
  if (!url) return null
  const match = /^data:([^,]*),([\s\S]*)$/.exec(url)
  if (!match) return null
  const meta = match[1]
  const base64 = /;base64/i.test(meta)
  const mime = meta.replace(/;base64/i, "").split(";")[0] || "text/plain"
  return { mime, base64, data: match[2] }
}

export function isDataUrl(url?: string): boolean {
  return !!url && url.startsWith("data:")
}

function base64ToBytes(data: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(data)
    const bytes = new Uint8Array(new ArrayBuffer(binary.length))
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/** Decode a data URL into a Blob, or null when it is not a decodable data URL. */
export function dataUrlToBlob(url?: string): Blob | null {
  const parsed = parseDataUrl(url)
  if (!parsed) return null
  if (parsed.base64) {
    const bytes = base64ToBytes(parsed.data)
    return bytes ? new Blob([bytes], { type: parsed.mime }) : null
  }
  try {
    return new Blob([decodeURIComponent(parsed.data)], { type: parsed.mime })
  } catch {
    return null
  }
}

/** Decode a data URL as UTF-8 text, or null when it is not a decodable data URL. */
export function dataUrlText(url?: string): string | null {
  const parsed = parseDataUrl(url)
  if (!parsed) return null
  if (parsed.base64) {
    const bytes = base64ToBytes(parsed.data)
    if (!bytes) return null
    return new TextDecoder().decode(bytes)
  }
  try {
    return decodeURIComponent(parsed.data)
  } catch {
    return null
  }
}

/** Approximate decoded size in bytes of a data URL, without allocating the Blob. */
export function dataUrlByteLength(url?: string): number {
  const parsed = parseDataUrl(url)
  if (!parsed) return 0
  if (parsed.base64) {
    const padding = parsed.data.endsWith("==") ? 2 : parsed.data.endsWith("=") ? 1 : 0
    return Math.max(0, Math.floor((parsed.data.length * 3) / 4) - padding)
  }
  return new TextEncoder().encode(parsed.data).length
}

export function formatBytes(bytes: number): string {
  if (!bytes) return ""
  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
