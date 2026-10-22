/**
 * Optional runtime configuration, loaded from `opencode-projects-studio.json` served at
 * the site root (i.e. `public/opencode-projects-studio.json`, copied into the build).
 *
 * It is a plain static file, so it can be edited on a running deployment and
 * picked up on the next reload — no rebuild or restart needed. A missing or
 * invalid file is treated as an empty config, so the app keeps its defaults.
 */
export interface RuntimeConfig {
  /**
   * Primary agent to select on load, when it matches an available agent. A
   * `?agent=` GET param still takes precedence when present.
   */
  defaultAgent?: string | null
}

const CONFIG_URL = `${import.meta.env.BASE_URL}opencode-projects-studio.json`

let pending: Promise<RuntimeConfig> | null = null

/** Fetch the runtime config once; resolves to `{}` when absent or invalid. */
export function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (!pending) {
    pending = fetch(CONFIG_URL, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : {}))
      .catch(() => ({}))
      .then((data) => (data && typeof data === "object" ? (data as RuntimeConfig) : {}))
  }
  return pending
}
