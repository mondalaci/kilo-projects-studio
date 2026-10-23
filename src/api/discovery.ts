import { ServerClient, ServerError, type Credentials } from "./client"

export type ServerProduct = "opencode" | "unknown"

export interface InstanceInfo {
  id: string
  origin: string
  product: ServerProduct
  version: string
  /** Default directory reported by `/api/location`, when reachable. */
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
 * Default ports to probe. The opencode **v2** server (`opencode serve
 * --service`) listens on `4097` by default, so that is probed first and is the
 * implicit port for a bare `host:port` address.
 */
export const DEFAULT_PORTS = [
  4097, 4096, 4098, 4099, 4100, 4101, 4102, 4103, 4104, 4105, 4110, 4120, 3000, 3456, 5000, 8000, 8080,
]

/** The port a bare address or `host:port` with no port defaults to. */
export const DEFAULT_PORT = 4097

const DEFAULT_HOSTS = ["127.0.0.1", "localhost"]

/** Hosts that refer to the same loopback server and are shown as `localhost`. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"])

/**
 * Normalize a user-entered address into an origin such as
 * `http://127.0.0.1:4097`. Loopback aliases (`localhost`, `::1`, `0.0.0.0`) are
 * canonicalized to `127.0.0.1` so the same server is not listed twice.
 */
export function normalizeOrigin(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  try {
    const url = new URL(withScheme)
    if (!url.port) url.port = String(DEFAULT_PORT)
    if (LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) url.hostname = "127.0.0.1"
    if (url.pathname !== "/") url.pathname = "/"
    return url.origin
  } catch {
    return null
  }
}

/**
 * Probe a single origin. Returns `null` if nothing that looks like an opencode
 * server answers. A `401` still reports the instance so the caller can request
 * credentials — the v2 server always requires Basic auth.
 */
export async function probeInstance(
  input: string,
  credentials?: Credentials,
  timeoutMs = 1500,
): Promise<InstanceInfo | null> {
  const origin = normalizeOrigin(input)
  if (!origin) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const client = new ServerClient(origin, credentials)
  try {
    let info: { version: string }
    try {
      info = await client.info(controller.signal)
    } catch (error) {
      if (error instanceof ServerError && error.unauthorized) {
        return { id: origin, origin, product: "opencode", version: "unknown", requiresAuth: true }
      }
      return null
    }
    if (!info?.version) return null

    let directory: string | undefined
    try {
      directory = (await client.location({ signal: controller.signal })).directory
    } catch {
      /* location is best-effort */
    }

    return {
      id: origin,
      origin,
      product: "opencode",
      version: info.version || "unknown",
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
  const timeoutMs = opts.timeoutMs ?? 1500
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
  return results
}
