import { ref } from "vue"
import type { ServerClient } from "@/api/client"
import type { ServerEvent } from "@/api/types"
import { useChat } from "./chat"
import { useProjects } from "./projects"
import { useSessions } from "./sessions"

const live = ref(false)
const connecting = ref(false)
const lastEventAt = ref<number | null>(null)

const chat = useChat()
const sessions = useSessions()
const projects = useProjects()

/**
 * The v2 server exposes a single global event stream (`GET /api/event`) carrying
 * every project's events, each tagged with its `location`. A BroadcastChannel
 * elects one leader per server to hold that stream and fan the events out to the
 * other tabs, so a handful of open tabs does not exhaust the per-origin
 * connection pool with one stream each.
 */
const CHANNEL_NAME = "kilo-projects-studio.events.v2"
const PING_MS = 2000
const LEADER_TIMEOUT_MS = PING_MS * 3
const ELECT_GRACE_MS = 400

const supported = typeof BroadcastChannel !== "undefined"
const tabID = Math.random().toString(36).slice(2)
const seen = new Set<string>()

type Msg =
  | { t: "event"; key: string; event: ServerEvent }
  | { t: "ping"; key: string; id: string }
  | { t: "hello"; key: string; id: string }
  | { t: "resync"; key: string }
  | { t: "vacate"; key: string; id: string }

let channel: BroadcastChannel | null = null
let listenerAttached = false
let unloadHooked = false
let activeClient: ServerClient | null = null
let activeKey = ""
let role: "idle" | "leader" | "follower" = "idle"
let controller: AbortController | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null
let watchdog: ReturnType<typeof setInterval> | null = null
let electTimer: ReturnType<typeof setTimeout> | null = null
let lastPingAt = 0
let reconcileTimer: ReturnType<typeof setTimeout> | null = null

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

function keyFor(client: ServerClient) {
  return client.origin
}

function post(msg: Msg) {
  channel?.postMessage(msg)
}

function apply(event: ServerEvent) {
  if (!event?.type) return
  if (event.id) {
    if (seen.has(event.id)) return
    seen.add(event.id)
    if (seen.size > 4000) {
      const keep = [...seen].slice(-2000)
      seen.clear()
      for (const id of keep) seen.add(id)
    }
  }
  lastEventAt.value = Date.now()
  const data = event.data
  sessions.applyEvent(event.type, data)
  projects.applyEvent(event.type, data)
  chat.applyEvent(event.type, data)

  // A turn ending is the point the server has persisted the final messages, so
  // re-read them: streaming is best-effort and the persisted copy is canonical.
  if (
    activeClient &&
    (event.type === "session.execution.succeeded" ||
      event.type === "session.execution.failed" ||
      event.type === "session.idle")
  ) {
    scheduleReconcile()
  }
}

/** Debounced reconcile, so a burst of end events refetches once. */
function scheduleReconcile() {
  if (reconcileTimer) clearTimeout(reconcileTimer)
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null
    if (activeClient) void chat.reconcile(activeClient)
  }, 400)
}

async function resync(client: ServerClient) {
  try {
    await sessions.load(client)
  } catch {
    /* ignore */
  }
  await chat.reconcile(client)
}

/** SSE handler for the leader: apply locally, then fan out to followers. */
function onStreamEvent(event: ServerEvent) {
  apply(event)
  post({ t: "event", key: activeKey, event })
}

function openStream() {
  const client = activeClient
  if (!client) return
  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal
  connecting.value = true

  void (async () => {
    let first = true
    while (!signal.aborted) {
      try {
        await client.subscribe(onStreamEvent, {
          signal,
          onOpen: () => {
            live.value = true
            connecting.value = false
            void resync(client)
            post({ t: "resync", key: activeKey })
          },
        })
      } catch {
        /* connection dropped */
      }
      live.value = false
      if (signal.aborted) break
      if (!first) connecting.value = true
      first = false
      await sleep(1000, signal)
    }
  })()
}

function closeStream() {
  controller?.abort()
  controller = null
}

function startPings() {
  stopPings()
  post({ t: "ping", key: activeKey, id: tabID })
  pingTimer = setInterval(() => post({ t: "ping", key: activeKey, id: tabID }), PING_MS)
}

function stopPings() {
  if (pingTimer) clearInterval(pingTimer)
  pingTimer = null
}

function becomeLeader() {
  role = "leader"
  closeStream()
  openStream()
  startPings()
}

function becomeFollower() {
  role = "follower"
  stopPings()
  closeStream()
}

function elect() {
  if (!supported) {
    becomeLeader()
    return
  }
  role = "follower"
  connecting.value = true
  lastPingAt = 0
  post({ t: "hello", key: activeKey, id: tabID })
  if (electTimer) clearTimeout(electTimer)
  electTimer = setTimeout(
    () => {
      electTimer = null
      if (role === "follower" && lastPingAt === 0) becomeLeader()
    },
    ELECT_GRACE_MS + Math.random() * ELECT_GRACE_MS,
  )
}

function onMessage(event: MessageEvent<Msg>) {
  const msg = event.data
  if (!msg || msg.key !== activeKey) return
  if ("id" in msg && msg.id === tabID) return

  switch (msg.t) {
    case "event":
      apply(msg.event)
      break
    case "ping":
      if (role === "leader") {
        if (msg.id < tabID) becomeFollower()
        break
      }
      lastPingAt = Date.now()
      live.value = true
      connecting.value = false
      break
    case "hello":
      if (role === "leader") post({ t: "ping", key: activeKey, id: tabID })
      break
    case "resync":
      if (role === "follower" && activeClient) void resync(activeClient)
      break
    case "vacate":
      if (role === "follower") {
        lastPingAt = 0
        elect()
      }
      break
  }
}

function stop() {
  if (role === "leader" && supported) post({ t: "vacate", key: activeKey, id: tabID })
  if (electTimer) {
    clearTimeout(electTimer)
    electTimer = null
  }
  if (reconcileTimer) {
    clearTimeout(reconcileTimer)
    reconcileTimer = null
  }
  stopPings()
  if (watchdog) {
    clearInterval(watchdog)
    watchdog = null
  }
  closeStream()
  role = "idle"
  lastPingAt = 0
  live.value = false
  connecting.value = false
  seen.clear()
}

export function useLive() {
  function start(client: ServerClient) {
    stop()
    activeClient = client
    activeKey = keyFor(client)

    if (!supported) {
      becomeLeader()
      return
    }

    if (!channel) channel = new BroadcastChannel(CHANNEL_NAME)
    if (!listenerAttached) {
      channel.onmessage = onMessage
      listenerAttached = true
    }
    if (!unloadHooked && typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => {
        if (role === "leader") post({ t: "vacate", key: activeKey, id: tabID })
      })
      unloadHooked = true
    }

    watchdog = setInterval(() => {
      if (role === "follower" && lastPingAt > 0 && Date.now() - lastPingAt > LEADER_TIMEOUT_MS) elect()
    }, PING_MS)

    elect()
  }

  return { live, connecting, lastEventAt, start, stop }
}
