import { computed, ref, shallowRef } from "vue"
import { ServerClient, type Credentials } from "@/api/client"
import { discoverInstances, normalizeOrigin, probeInstance, type InstanceInfo } from "@/api/discovery"

const STORAGE_KEY = "kilo-projects-studio.connections"

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

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved.value))
  } catch {
    /* storage unavailable */
  }
}

function credentialsFor(origin: string): Credentials | undefined {
  const canonical = normalizeOrigin(origin) ?? origin
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

      const existing = saved.value.find((item) => item.origin === probe.origin)
      const record: SavedConnection = {
        origin: probe.origin,
        product: probe.product,
        version: probe.version,
        username: creds?.username ?? existing?.username ?? "opencode",
        password: creds?.password ?? existing?.password ?? "",
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
    scan,
    connect,
    disconnect,
    forget,
    selectInstance,
    credentialsFor,
  }
}