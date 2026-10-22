import { computed, ref, shallowRef } from "vue"
import { ServerClient, type Credentials } from "@/api/client"
import { discoverInstances, normalizeOrigin, probeInstance, type InstanceInfo } from "@/api/discovery"

const STORAGE_KEY = "opencode-projects-studio.connections"

export interface SavedConnection {
  origin: string
  label?: string
  product: InstanceInfo["product"]
  version: string
  username: string
  password: string
  lastUsed: number
}

function loadSaved(): SavedConnection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Canonicalize origins and merge duplicates that refer to the same loopback
    // server (e.g. an old 127.0.0.1 entry and a new localhost one).
    const merged = new Map<string, SavedConnection>()
    for (const item of parsed as SavedConnection[]) {
      const origin = normalizeOrigin(item.origin) ?? item.origin
      const next: SavedConnection = { ...item, origin }
      const previous = merged.get(origin)
      if (!previous) {
        merged.set(origin, next)
        continue
      }
      const [older, newer] = next.lastUsed >= previous.lastUsed ? [previous, next] : [next, previous]
      merged.set(origin, {
        ...newer,
        password: newer.password || older.password,
        username: newer.username || older.username,
      })
    }
    return [...merged.values()]
  } catch {
    return []
  }
}

const saved = ref<SavedConnection[]>(loadSaved())
const discovered = ref<InstanceInfo[]>([])
const scanning = ref(false)
const connected = ref<InstanceInfo | null>(null)
const client = shallowRef<ServerClient | null>(null)
const connecting = ref(false)
const connectError = ref<string | null>(null)
/** Set when a connection could not be written to `localStorage`. */
const storageError = ref<string | null>(null)

/**
 * Credentials that are known to work, keyed by canonical origin.
 *
 * These are kept in memory as well as in storage on purpose. `localStorage` can
 * be unavailable — a wiped profile, private mode — and its write failure used to
 * be silent, so a reload lost the password. Every later scan then probed the
 * server unauthenticated, got a 401, and the picker kept asking for the password
 * it had already been given.
 */
const memoryCredentials = new Map<string, Credentials>()

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved.value))
    storageError.value = null
    return true
  } catch (error) {
    storageError.value = `Could not save the connection: ${
      error instanceof Error ? error.message : String(error)
    }`
    return false
  }
}

function rememberCredentials(origin: string, credentials: Credentials | undefined) {
  if (!credentials?.password) return
  const canonical = normalizeOrigin(origin) ?? origin
  memoryCredentials.set(canonical, {
    username: credentials.username || "opencode",
    password: credentials.password,
  })
}

function credentialsFor(origin: string): Credentials | undefined {
  const canonical = normalizeOrigin(origin) ?? origin
  // In-memory first: it survives a storage failure within this run.
  const remembered = memoryCredentials.get(canonical)
  if (remembered) return remembered
  const entry = saved.value.find((item) => item.origin === canonical)
  if (!entry?.password) return undefined
  return { username: entry.username || "opencode", password: entry.password }
}

export function useConnection() {
  /** Saved connections merged with the most recent discovery results. */
  const instances = computed<InstanceInfo[]>(() => {
    const map = new Map<string, InstanceInfo>()
    for (const item of saved.value) {
      map.set(item.origin, {
        id: item.origin,
        origin: item.origin,
        product: item.product,
        version: item.version,
        // A server that needs no password is saved with an empty one, so the
        // probe result — not the stored record — decides this.
        requiresAuth: false,
        directory: undefined,
      })
    }
    for (const item of discovered.value) map.set(item.origin, item)
    return [...map.values()]
  })

  async function scan() {
    scanning.value = true
    try {
      discovered.value = await discoverInstances({
        candidates: saved.value.map((item) => item.origin),
        credentialsFor,
      })
    } finally {
      scanning.value = false
    }
  }

  async function connect(info: InstanceInfo, credentials?: Credentials) {
    connecting.value = true
    connectError.value = null
    try {
      const creds = credentials ?? credentialsFor(info.origin)
      const next = new ServerClient(info.origin, creds)

      // Verify the server is reachable and, when it requires auth, that the
      // credentials actually work before entering the app shell.
      const probe = await probeInstance(info.origin, creds)
      if (!probe) {
        connectError.value = `Could not reach ${info.origin}. Is the server running?`
        return false
      }
      if (probe.requiresAuth) {
        connectError.value = creds
          ? "Authentication failed. Check the username and password."
          : "This server requires a password."
        return false
      }

      client.value = next
      connected.value = probe
      rememberCredentials(probe.origin, creds)

      const existing = saved.value.find((item) => item.origin === probe.origin)
      const record: SavedConnection = {
        origin: probe.origin,
        product: probe.product,
        version: probe.version,
        username: creds?.username || existing?.username || "opencode",
        // `||`, not `??`: an empty string would otherwise replace a password
        // that is already stored and lock the server out of future scans.
        password: creds?.password || existing?.password || "",
        lastUsed: Date.now(),
      }
      saved.value = [record, ...saved.value.filter((item) => item.origin !== probe.origin)]
      persist()

      const merge = discovered.value.find((item) => item.origin === probe.origin)
      if (merge) Object.assign(merge, probe)
      else discovered.value = [probe, ...discovered.value]
      return true
    } catch (error) {
      connectError.value = error instanceof Error ? error.message : String(error)
      client.value = null
      connected.value = null
      return false
    } finally {
      connecting.value = false
    }
  }

  function disconnect() {
    client.value = null
    connected.value = null
  }

  function forget(origin: string) {
    const canonical = normalizeOrigin(origin) ?? origin
    saved.value = saved.value.filter((item) => item.origin !== canonical)
    discovered.value = discovered.value.filter((item) => item.origin !== canonical)
    memoryCredentials.delete(canonical)
    persist()
  }

  function selectInstance(origin: string, credentials?: Credentials) {
    const info: InstanceInfo =
      instances.value.find((item) => item.origin === origin) ?? {
        id: origin,
        origin,
        product: "unknown",
        version: "unknown",
        requiresAuth: false,
      }
    if (credentials) {
      const normalized = normalizeOrigin(origin)
      if (normalized) origin = normalized
    }
    return connect(info, credentials)
  }

  return {
    saved,
    discovered,
    instances,
    scanning,
    connected,
    client,
    connecting,
    connectError,
    storageError,
    scan,
    connect,
    disconnect,
    forget,
    selectInstance,
    credentialsFor,
  }
}