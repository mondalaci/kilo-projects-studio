/**
 * kilo-search — a small local service that provides FTS5/BM25 content search
 * over Kilo conversations, without modifying the Kilo server.
 *
 * It opens the Kilo SQLite database READ-ONLY (WAL allows many concurrent
 * readers) and maintains its own FTS5 index in a separate database file.
 *
 * Sync strategy:
 *   - initial backfill of all searchable parts
 *   - `PRAGMA data_version` on the Kilo db as a cheap cross-process change
 *     detector; when it moves, index parts newer than the stored watermark
 *
 * Endpoints:
 *   GET /health
 *   GET /search?q=<query>&limit=<n>
 */

import { Database } from "bun:sqlite"
import { homedir } from "node:os"
import { join } from "node:path"
import { mkdirSync } from "node:fs"

const KILO_DB = process.env.KILO_DB ?? join(homedir(), ".local", "share", "kilo", "kilo.db")
const SEARCH_DB = process.env.KILO_SEARCH_DB ?? join(import.meta.dir, "..", "data", "search.db")
const PORT = Number(process.env.KILO_SEARCH_PORT ?? 27184)
const HOST = process.env.KILO_SEARCH_HOST ?? "127.0.0.1"
const ORIGIN = process.env.KILO_SEARCH_ORIGIN ?? "*"
const POLL_MS = Number(process.env.KILO_SEARCH_POLL_MS ?? 1000)

/** Message text, file references and tool errors — mirrors the server's RecallSearch. */
const TEXT_SQL = `CASE
    WHEN json_extract(p.data, '$.type') = 'text' THEN coalesce(json_extract(p.data, '$.text'), '')
    WHEN json_extract(p.data, '$.type') = 'file' THEN trim(
      coalesce(json_extract(p.data, '$.filename'), '') || ' ' ||
      CASE WHEN coalesce(json_extract(p.data, '$.url'), '') NOT LIKE 'data:%'
        THEN coalesce(json_extract(p.data, '$.url'), '') ELSE '' END || ' ' ||
      coalesce(json_extract(p.data, '$.source.path'), '') || ' ' ||
      coalesce(json_extract(p.data, '$.source.name'), '') || ' ' ||
      CASE WHEN coalesce(json_extract(p.data, '$.source.uri'), '') NOT LIKE 'data:%'
        THEN coalesce(json_extract(p.data, '$.source.uri'), '') ELSE '' END || ' ' ||
      coalesce(json_extract(p.data, '$.source.clientName'), '')
    )
    ELSE coalesce(json_extract(p.data, '$.state.error'), '')
  END`

const PART_FILTER_SQL = `json_valid(p.data) AND (
    (json_extract(p.data, '$.type') = 'text'
      AND coalesce(json_extract(p.data, '$.synthetic'), 0) = 0
      AND coalesce(json_extract(p.data, '$.ignored'), 0) = 0)
    OR json_extract(p.data, '$.type') = 'file'
    OR (json_extract(p.data, '$.type') = 'tool'
      AND json_extract(p.data, '$.state.status') = 'error')
  )`

mkdirSync(join(SEARCH_DB, ".."), { recursive: true })

const index = new Database(SEARCH_DB, { create: true })

/** The Kilo db is opened fresh per use: a long-lived read-only WAL connection can
 *  pin to an old snapshot, hiding newly committed parts. */
function withKilo<T>(fn: (db: Database) => T): T {
  const db = new Database(KILO_DB, { readonly: true })
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

index.run("PRAGMA journal_mode = WAL")
index.run("PRAGMA synchronous = NORMAL")

index.run(`
  CREATE TABLE IF NOT EXISTS parts (
    id INTEGER PRIMARY KEY,
    part_id TEXT UNIQUE,
    session_id TEXT,
    updated INTEGER,
    text TEXT
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS part_fts USING fts5(
    text, content='parts', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER IF NOT EXISTS parts_ai AFTER INSERT ON parts BEGIN
    INSERT INTO part_fts(rowid, text) VALUES (new.id, new.text);
  END;
  CREATE TRIGGER IF NOT EXISTS parts_ad AFTER DELETE ON parts BEGIN
    INSERT INTO part_fts(part_fts, rowid, text) VALUES ('delete', old.id, old.text);
  END;
  CREATE TRIGGER IF NOT EXISTS parts_au AFTER UPDATE ON parts BEGIN
    INSERT INTO part_fts(part_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO part_fts(rowid, text) VALUES (new.id, new.text);
  END;
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`)

const getWatermark = (): number => {
  const row = index.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'watermark'").get()
  return row ? Number(row.value) : 0
}
const setWatermark = (value: number) =>
  index.run("INSERT INTO meta(key, value) VALUES('watermark', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
    String(value),
  ])

const upsert = index.prepare(
  `INSERT INTO parts(part_id, session_id, updated, text) VALUES (?, ?, ?, ?)
   ON CONFLICT(part_id) DO UPDATE SET
     session_id = excluded.session_id, updated = excluded.updated, text = excluded.text`,
)

/** Index all parts with time_updated > since (0 = full backfill), returning the new watermark. */
function indexSince(db: Database, since: number): { indexed: number; watermark: number } {
  let watermark = since
  let indexed = 0
  const page = db.query<
    { part_id: string; session_id: string; updated: number; text: string },
    [number]
  >(
    `SELECT p.id AS part_id, p.session_id AS session_id, p.time_updated AS updated, ${TEXT_SQL} AS text
     FROM part p
     WHERE ${PART_FILTER_SQL} AND p.time_updated > ? AND length(${TEXT_SQL}) > 0
     ORDER BY p.time_updated, p.id
     LIMIT 2000`,
  )

  try {
    for (;;) {
      const rows = page.all(since)
      if (rows.length === 0) break
      const tx = index.transaction((items: typeof rows) => {
        for (const row of items) {
          upsert.run(row.part_id, row.session_id, row.updated, row.text)
          if (row.updated > watermark) watermark = row.updated
        }
      })
      tx(rows)
      indexed += rows.length
      since = rows[rows.length - 1].updated
      if (rows.length < 2000) break
    }
  } finally {
    page.finalize()
  }
  return { indexed, watermark }
}

/** Newest part timestamp in the Kilo db — the sync change signal. */
function newestPartUpdated(db: Database): number {
  const row = db.query<{ v: number | null }, []>("SELECT max(time_updated) AS v FROM part").get()
  return row?.v ?? 0
}

let polls = 0
let lastError: string | null = null
let lastSync: Record<string, unknown> = {}

function sync(force = false) {
  const watermark = getWatermark()
  withKilo((db) => {
    const newest = newestPartUpdated(db)
    if (!force && newest <= watermark) {
      lastSync = { watermark, newest, skipped: true }
      return
    }
    const { indexed, watermark: next } = indexSince(db, watermark)
    // Advance past non-indexable parts too (reasoning, step markers, completed
    // tools); parts written during the pass are > newest and caught next poll.
    setWatermark(Math.max(next, newest))
    lastSync = { watermark, newest, indexed, next }
    if (indexed > 0) console.log(`[kilo-search] indexed ${indexed} parts (watermark ${next})`)
  })
}

// ---- session metadata cache -------------------------------------------------

type SessionMeta = { title: string; directory: string; updated: number }
let sessionCache = new Map<string, SessionMeta>()
let sessionCacheAt = 0

function sessions(): Map<string, SessionMeta> {
  if (Date.now() - sessionCacheAt < 1000 && sessionCache.size) return sessionCache
  const rows = withKilo((db) =>
    db
      .query<{ id: string; title: string; directory: string; time_updated: number }, []>(
        "SELECT id, title, directory, time_updated FROM session",
      )
      .all(),
  )
  sessionCache = new Map(rows.map((r) => [r.id, { title: r.title, directory: r.directory, updated: r.time_updated }]))
  sessionCacheAt = Date.now()
  return sessionCache
}

// ---- query ------------------------------------------------------------------

type PartHit = { session_id: string; part_id: string; score: number; snippet: string }

const searchStmt = index.query<PartHit, [string, number]>(
  `SELECT p.session_id AS session_id, p.part_id AS part_id, bm25(part_fts) AS score,
          snippet(part_fts, 0, '', '', ' … ', 14) AS snippet
   FROM part_fts JOIN parts p ON p.id = part_fts.rowid
   WHERE part_fts MATCH ?
   ORDER BY score
   LIMIT ?`,
)

/** Build a safe FTS5 MATCH expression: quoted terms joined by `op`. */
function matchExpr(query: string, op: "AND" | "OR"): string | null {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean)
    .slice(0, 16)
  if (terms.length === 0) return null
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(` ${op} `)
}

export function search(query: string, limit: number) {
  const trimmed = query.trim()
  if (!trimmed) return []

  // Prefer sessions matching every term; fall back to any term.
  let hits = searchStmt.all(matchExpr(trimmed, "AND") ?? "", 2000)
  if (hits.length === 0) hits = searchStmt.all(matchExpr(trimmed, "OR") ?? "", 2000)

  const meta = sessions()
  const best = new Map<string, { score: number; snippet: string; partID: string }>()
  for (const hit of hits) {
    if (!meta.has(hit.session_id)) continue // deleted session
    const current = best.get(hit.session_id)
    if (!current || hit.score < current.score) best.set(hit.session_id, { score: hit.score, snippet: hit.snippet, partID: hit.part_id })
  }

  return [...best.entries()]
    .sort((a, b) => a[1].score - b[1].score)
    .slice(0, limit)
    .map(([sessionID, hit]) => {
      const info = meta.get(sessionID)!
      return {
        sessionID,
        title: info.title,
        directory: info.directory,
        updated: info.updated,
        score: hit.score,
        snippet: hit.snippet,
      }
    })
}

// ---- http -------------------------------------------------------------------

const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } })

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  fetch(req) {
    const url = new URL(req.url)
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors })
    if (url.pathname === "/health") {
      const parts = index.query<{ n: number }, []>("SELECT count(*) AS n FROM parts").get()?.n ?? 0
      return json({ ok: true, parts, sessions: sessions().size, watermark: getWatermark(), kiloDB: KILO_DB })
    }
    if (url.pathname === "/sessions") {
      const limit = Math.min(50000, Math.max(1, Number(url.searchParams.get("limit") ?? 2000) || 2000))
      const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0)
      const all = [...sessions().entries()].sort((a, b) => b[1].updated - a[1].updated)
      return json({
        total: all.length,
        results: all.slice(offset, offset + limit).map(([sessionID, meta]) => ({
          sessionID,
          title: meta.title,
          directory: meta.directory,
          updated: meta.updated,
        })),
      })
    }
    if (url.pathname === "/debug") {
      return json({
        watermark: getWatermark(),
        newest: withKilo((db) => newestPartUpdated(db)),
        polls,
        lastError,
        lastSync,
      })
    }
    if (url.pathname === "/search") {
      const q = url.searchParams.get("q") ?? ""
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20))
      return json({ results: search(q, limit) })
    }
    return json({ error: "not found" }, 404)
  },
})

// initial backfill (blocking) then start watching for changes
sync(true)
setInterval(() => {
  polls++
  try {
    sync()
  } catch (error) {
    lastError = String(error)
    console.error("[kilo-search] sync failed:", error)
  }
}, POLL_MS)

console.log(`[kilo-search] listening on http://${HOST}:${server.port} (kilo.db: ${KILO_DB})`)
