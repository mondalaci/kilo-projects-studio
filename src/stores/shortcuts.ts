import { reactive, ref } from "vue"

/**
 * Keyboard-shortcut state.
 *
 * Holding a modifier reveals key badges on the controls its shortcuts trigger,
 * mirroring the "hold Cmd to see shortcuts" pattern. `Alt` and `Ctrl` are separate
 * layers — the filters live on Ctrl, everything else on Alt — so the layer that is
 * held is what gets shown, and each badge names its own modifier.
 *
 * Actions that need to reach a specific component are dispatched through
 * `openRequests` counters that the component watches.
 */
export type ShortcutModifier = "alt" | "ctrl"

/** Which modifier is held, if any. */
export const heldModifier = ref<ShortcutModifier | null>(null)

export function setHeldModifier(value: ShortcutModifier | null) {
  heldModifier.value = value
}

export const openRequests = reactive({ model: 0, project: 0, sessions: 0, effort: 0, tools: 0, chats: 0 })

export function requestOpen(which: "model" | "project" | "sessions" | "effort" | "tools" | "chats") {
  openRequests[which] += 1
}

/** Key codes (layout/modifier independent) for the shortcuts. */
export const shortcutKeys = {
  model: "KeyM",
  project: "KeyP",
  newChat: "KeyN",
  focusChat: "KeyC",
  sessions: "KeyS",
  chats: "KeyL",
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
