import { ref } from "vue"
import { desktopBridge } from "@/api/desktop"

/**
 * Desktop window state.
 *
 * The frame is chromeless, so nothing in the OS reports whether the window is
 * maximized: the main process pushes it, and both the window buttons (which swap
 * their glyph) and the resize grips (which step aside while maximized) read it.
 */

const api = desktopBridge()?.window

/** True while the window is maximized; a maximized window cannot be resized. */
export const windowMaximized = ref(false)

let tracking = false

/** Start following the maximize state. Safe to call from every consumer. */
export function trackWindowState() {
  if (tracking || !api) return
  tracking = true
  void api.isMaximized().then((value) => {
    windowMaximized.value = value
  })
  api.onMaximizedChange((value) => {
    windowMaximized.value = value
  })
}
