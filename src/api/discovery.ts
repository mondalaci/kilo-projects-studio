import { ServerClient, ServerError, type Credentials } from "./client"
import type { ServerConfig } from "./types"

export type ServerProduct = "kilo" | "opencode" | "unknown"

export interface InstanceInfo {
  id: string
  origin: string
  product: ServerProduct
  version: string
  /** Default directory reported by `/path`, when reachable without auth. */
  directory?: string
  requiresAuth: boolean
}

export interface DiscoverOptions {
  /** Origins or host:port strings to probe in addition to the defaults. */
  candidates?: string[]
  credentialsFor?: (origin: string) => Credentials | undefined
  timeoutMs?: number
}

/**
 * Default ports to probe. The server prefers `4096` for its headless listener,
 * then falls back to a random free port, so we scan a small neighbourhood plus
 * a few common dev ports.
 */
export const DEFAULT_PORTS = [
  4096, 4097, 4098, 4099, 4100, 4101, 4102, 4103, 4104, 4105, 4110, 4120, 3000, 3456, 5000, 8000, 8080,
  // Uncommon high port used by the bundled PM2 server (ecosystem.config.cjs).
  27183,
]

const DEFAULT_HOSTS = ["localhost"]

/** Hosts that refer to the same loopback server and are shown as `localhost`. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"])

/**
 * Normalize a user-entered address into an origin such as `http://localhost:4096`.
 * Loopback aliases (`127.0.0.1`, `::1`, `0.0.0.0`) are canonicalized to
 * `localhost` so the same server is not listed more than once.
 */
export function normalizeOrigin(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  try {
    const url = new URL(withScheme)
    if (!url.port) url.port = "4096"
    if (LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) url.hostname = "localhost"
    if (url.pathname !== "/") url.pathname = "/"
    return url.origin
  } catch {
    return null
  }
}

function detectProduct(config: ServerConfig | undefined): ServerProduct {
  const schema = config?.$schema ?? ""
  if (/kilo/i.test(schema)) return "kilo"
  if (/opencode/i.test(schema)) return "opencode"
  return "unknown"
}

/**
 * Probe a single origin. Returns `null` if nothing that looks like a
 * kilo/opencode server answers. If the server answers with 401 the instance is
 * still reported so the caller can request credentials.
 */
export async function probeInstance(
  input: string,
  credentials?: Credentials,
  timeoutMs = 1200,
): Promise<InstanceInfo | null> {
  const origin = normalizeOrigin(input)
  if (!origin) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const client = new ServerClient(origin, credentials)
  try {
    let health: { healthy: boolean; version: string }
    try {
      health = await client.health(controller.signal)
    } catch (error) {
      if (error instanceof ServerError && error.unauthorized) {
        return {
          id: origin,
          origin,
          product: "unknown",
          version: "unknown",
          requiresAuth: true,
        }
      }
      return null
    }
    if (!health?.healthy) return null

    let config: ServerConfig | undefined
    let directory: string | undefined
    try {
      config = await client.config({ signal: controller.signal })
      directory = (await client.path({ signal: controller.signal })).worktree
    } catch {
      /* config/path are best-effort */
    }

    return {
      id: origin,
      origin,
      product: detectProduct(config),
      version: health.version || "unknown",
      directory,
      requiresAuth: false,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Probe many origins with bounded concurrency. */
export async function discoverInstances(opts: DiscoverOptions = {}): Promise<InstanceInfo[]> {
  const timeoutMs = opts.timeoutMs ?? 1200
  const candidates = new Set<string>()

  for (const port of DEFAULT_PORTS) for (const host of DEFAULT_HOSTS) {
    const origin = normalizeOrigin(`${host}:${port}`)
    if (origin) candidates.add(origin)
  }
  for (const candidate of opts.candidates ?? []) {
    const origin = normalizeOrigin(candidate)
    if (origin) candidates.add(origin)
  }

  const list = [...candidates]
  const results: InstanceInfo[] = []
  const seen = new Set<string>()
  const concurrency = 16

  let cursor = 0
  async function worker() {
    while (cursor < list.length) {
      const candidate = list[cursor++]
      const origin = normalizeOrigin(candidate)
      if (!origin) continue
      const info = await probeInstance(candidate, opts.credentialsFor?.(origin), timeoutMs)
      if (info && !seen.has(info.origin)) {
        seen.add(info.origin)
        results.push(info)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker))
  results.sort((a, b) => (a.product === b.product ? 0 : a.product === "kilo" ? -1 : 1))
  return results
}