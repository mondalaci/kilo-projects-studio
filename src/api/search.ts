/**
 * Content search, backed by the shared `opencode-search` service.
 *
 * The client lives in the opencode-search repository (`client/index.ts`); this
 * module binds it to this app's storage key and source. Falls back cleanly when
 * the service is not running.
 */
import { createSearchClient } from "opencode-search/client"

export type { ContentHit, SearchHealth, SearchSourceHealth, SessionPage } from "opencode-search/client"

const client = createSearchClient({
  storageKey: "opencode-projects-studio.search-url",
  source: "opencode",
})

export const { searchURL, setSearchURL, searchContent, searchHealth, searchReachable, listSessionsPage, listAllSessions } =
  client
