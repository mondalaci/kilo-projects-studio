import { ref } from "vue"

/**
 * Per-message tool overrides sent as the prompt `tools` map. `false` disables a
 * tool for the next message, `true` forces it on. Reset when the agent changes.
 */
const overrides = ref<Record<string, boolean>>({})

export function useTools() {
  function setOverride(id: string, enabled: boolean) {
    overrides.value = { ...overrides.value, [id]: enabled }
  }

  function reset() {
    overrides.value = {}
  }

  /** Only the explicit overrides are sent; omitted tools use the agent default. */
  function payload(): Record<string, boolean> | undefined {
    const entries = Object.entries(overrides.value)
    return entries.length > 0 ? Object.fromEntries(entries) : undefined
  }

  return { overrides, setOverride, reset, payload }
}
