/**
 * Minimal static file server for the built renderer.
 *
 * Production loads the UI over `http://127.0.0.1:<random port>` rather than
 * `file://`, because the Kilo/opencode server only accepts requests from
 * loopback HTTP origins (`http://localhost:*`, `http://127.0.0.1:*`). A `file://`
 * page sends no usable Origin, so CORS would block every API call, and
 * localStorage is unreliable there too.
 */
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const http = require("node:http")
const path = require("node:path")

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
}

/**
 * The port the UI is served on.
 *
 * It is fixed on purpose: the renderer is an `http://127.0.0.1:<port>` origin, and
 * `localStorage` is keyed by origin — theme, split positions, the saved server and
 * the unread markers all live there. A fresh port per launch would mean a fresh,
 * empty origin each time and nothing would be remembered.
 */
const PREFERRED_PORT = 45999

/** Serve `root` on loopback; resolves with the port actually used. */
function startStaticServer(root, preferredPort = PREFERRED_PORT) {
  if (preferredPort) {
    return listen(root, preferredPort).catch((error) => {
      if (error?.code !== "EADDRINUSE") throw error
      // Something else holds the port. Falling back keeps the app usable, but
      // this origin has no stored preferences, so say so rather than silently
      // losing them.
      console.warn(`[static] port ${preferredPort} is in use; falling back to an ephemeral port (settings will not persist)`)
      return listen(root, 0)
    })
  }
  return listen(root, 0)
}

function listen(root, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const send = (code, body) => {
        res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" })
        res.end(body)
      }
      void (async () => {
        try {
          const url = new URL(req.url || "/", "http://127.0.0.1")
          const decoded = decodeURIComponent(url.pathname)
          const relative = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "")
          const target = path.join(root, relative)

          let file = target
          let stat = await fsp.stat(file).catch(() => null)
          if (!stat || stat.isDirectory()) {
            // SPA fallback: unknown paths render the app shell.
            file = path.join(root, "index.html")
            stat = await fsp.stat(file).catch(() => null)
          }
          if (!stat) {
            send(404, "Not found")
            return
          }

          res.writeHead(200, {
            "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
            "Content-Length": stat.size,
            "Cache-Control": "no-store",
          })
          if (req.method === "HEAD") {
            res.end()
            return
          }
          fs.createReadStream(file).pipe(res)
        } catch {
          if (!res.headersSent) send(500, "Internal error")
          else res.end()
        }
      })()
    })

    server.on("error", reject)
    server.listen(port, "127.0.0.1", () => resolve(server.address().port))
  })
}

module.exports = { startStaticServer, PREFERRED_PORT }
