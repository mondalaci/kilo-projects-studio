/**
 * Dev launcher for the Electron app.
 *
 * Starts the Vite dev server, waits until it accepts connections, then launches
 * Electron pointed at it. Killing either process tears the other one down, so
 * `npm run app:dev` behaves like a single long-running command.
 */
import { spawn } from "node:child_process"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const HOST = "127.0.0.1"
const PORT = Number(process.env.KPS_DEV_PORT ?? 5273)
const URL = `http://${HOST}:${PORT}/`

/** Resolve a node_modules/.bin shim to an absolute path. */
function bin(name) {
  const suffix = process.platform === "win32" ? ".cmd" : ""
  return path.join(root, "node_modules", ".bin", name + suffix)
}

function waitForPort(host, port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host, port })
      socket.once("connect", () => {
        socket.destroy()
        resolve()
      })
      socket.once("error", () => {
        socket.destroy()
        if (Date.now() > deadline) reject(new Error(`Timed out waiting for ${host}:${port}`))
        else setTimeout(attempt, 150)
      })
    }
    attempt()
  })
}

const children = new Set()

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM")
  }
  process.exit(code)
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0))
}

const vite = spawn(bin("vite"), ["--host", HOST, "--port", String(PORT), "--strictPort"], {
  cwd: root,
  stdio: "inherit",
})
children.add(vite)
vite.on("exit", (code) => {
  console.error(`[dev] vite exited (${code ?? 0})`)
  shutdown(code ?? 0)
})

await waitForPort(HOST, PORT)

const electronArgs = [root]
if (process.env.KPS_NO_SANDBOX === "1") electronArgs.push("--no-sandbox")

// Some editors and harnesses export ELECTRON_RUN_AS_NODE, which makes the
// Electron binary run as plain Node (no app/window APIs). Drop it so the app
// starts even when launched from such an environment.
const electronEnv = { ...process.env, KPS_DEV_URL: URL }
delete electronEnv.ELECTRON_RUN_AS_NODE

const electron = spawn(bin("electron"), electronArgs, {
  cwd: root,
  stdio: "inherit",
  env: electronEnv,
})
children.add(electron)
electron.on("exit", (code) => {
  console.log(`[dev] electron exited (${code ?? 0})`)
  shutdown(code ?? 0)
})
