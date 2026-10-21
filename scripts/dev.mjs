/**
 * Dev launcher for the Electron app.
 *
 * Starts the Vite dev server, waits until it accepts connections, then launches
 * Electron pointed at it. Killing either process tears the other one down, so
 * `npm run app:dev` behaves like a single long-running command.
 */
import { spawn } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
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

/**
 * Chromium keeps its single-instance lock as symlinks in the app's profile,
 * naming the pid that holds it. A run that is killed abruptly leaves them behind
 * and the next launch then exits immediately without a word. Clear it when the
 * pid it names is gone.
 */
function clearStaleLock() {
  if (process.platform !== "linux") return
  const profile = path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "Kilo Projects Studio")
  try {
    const owner = Number(fs.readlinkSync(path.join(profile, "SingletonLock")).split("-").pop())
    if (!owner) return
    try {
      process.kill(owner, 0)
      return // still running: its window will be raised by the lock itself
    } catch {
      // gone, so the lock is stale
    }
    for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      fs.rmSync(path.join(profile, name), { force: true })
    }
    console.log(`[dev] cleared a stale single-instance lock left by pid ${owner}`)
  } catch {
    // No lock at all, which is the normal case.
  }
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
  // The dev port is fixed on purpose (the renderer's origin decides where its
  // settings live), so a second dev server cannot start. Say which port, since
  // the failure otherwise looks like nothing happened.
  console.error(`[dev] vite exited (${code ?? 0})`)
  if (code) console.error(`[dev] port ${PORT} is probably already taken by another dev server; KPS_DEV_PORT overrides it`)
  shutdown(code ?? 0)
})

await waitForPort(HOST, PORT)

clearStaleLock()

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
const launchedAt = Date.now()
electron.on("exit", (code) => {
  console.log(`[dev] electron exited (${code ?? 0})`)
  // A clean exit within a second or two means the single-instance lock: the app
  // found another copy already running and handed over to it.
  if (code === 0 && Date.now() - launchedAt < 3000) {
    console.log("[dev] it exited immediately, which usually means another instance of the app is already running.")
    console.log("[dev] list them with: pgrep -af 'kilo-projects-studio/node_modules'")
  }
  shutdown(code ?? 0)
})
