import { reactive, ref } from "vue"

/**
 * Keyboard-shortcut state.
 *
 * Holding the modifier (`Alt`) reveals key badges on the controls they trigger,
 * mirroring the "hold Cmd to see shortcuts" pattern. Actions that need to reach
 * a specific component are dispatched through `openRequests` counters that the
 * component watches.
 */
export const shortcutsVisible = ref(false)

export const openRequests = reactive({ model: 0, agent: 0, project: 0, sessions: 0, effort: 0, tools: 0 })

export function requestOpen(which: "model" | "agent" | "project" | "sessions" | "effort" | "tools") {
  openRequests[which] += 1
}

/** Key codes (layout/modifier independent) for the shortcuts. */
export const shortcutKeys = {
  model: "KeyM",
  agent: "KeyA",
  project: "KeyP",
  newChat: "KeyN",
  focusChat: "KeyC",
  sessions: "KeyS",
  search: "KeyF",
  effort: "KeyE",
  tools: "KeyT",
  pronounce: "KeyV",
  stop: "KeyX",
} as const

/**
 * Pronunciation widgets are independent Vue apps (one per code block), so the
 * shortcut cannot be dispatched through a single component the way the
 * `openRequests` counters are. Each mounted widget registers its play/stop
 * toggle here; the newest registration wins, so Alt+V drives the most recent
 * widget on screen.
 */
let activePronunciation: (() => void) | null = null

export function registerPronunciation(handler: () => void): () => void {
  activePronunciation = handler
  return () => {
    if (activePronunciation === handler) activePronunciation = null
  }
}

export function togglePronunciation() {
  activePronunciation?.()
}
