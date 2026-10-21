/**
 * Git plumbing used by the Electron main process.
 *
 * Everything here shells out to the user's `git`, so the app reports exactly
 * what the repository says (including the user's global config: ignore rules,
 * diff settings, renames, submodules) instead of reimplementing git in JS.
 */
const path = require("node:path")
const { execFile } = require("node:child_process")

/** Cap on how much of a patch is shipped to the renderer. */
const MAX_PATCH_BYTES = 2 * 1024 * 1024

/** Run `git` and resolve with the outcome instead of throwing on a non-zero exit. */
function git(args, { cwd, timeoutMs = 20_000 } = {}) {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: "utf8" },
      (error, stdout, stderr) => {
        const missing = Boolean(error && error.code === "ENOENT")
        resolve({
          ok: !error,
          missing,
          code: error && typeof error.code === "number" ? error.code : error ? 1 : 0,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
        })
      },
    )
  })
}

/** Resolve the repository that contains `dir`, if any. */
async function repoInfo(dir) {
  if (typeof dir !== "string" || !dir.trim()) return { isRepo: false, reason: "no directory" }

  const inside = await git(["-C", dir, "rev-parse", "--is-inside-work-tree"])
  if (inside.missing) return { isRepo: false, reason: "git-not-installed" }
  if (!inside.ok || inside.stdout.trim() !== "true") return { isRepo: false, reason: "not-a-repository" }

  const [top, branch, head] = await Promise.all([
    git(["-C", dir, "rev-parse", "--show-toplevel"]),
    git(["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]),
    git(["-C", dir, "rev-parse", "--short", "HEAD"]),
  ])

  const root = top.ok && top.stdout.trim() ? top.stdout.trim() : dir
  return {
    isRepo: true,
    root,
    name: path.basename(root) || root,
    branch: branch.ok ? branch.stdout.trim() : null,
    head: head.ok ? head.stdout.trim() : null,
  }
}

/**
 * Parse `git status --porcelain=v1 -z`.
 *
 * With `-z` a plain entry is `XY <path>` terminated by NUL; a rename or copy
 * carries the original path in the following NUL-separated field.
 */
function parsePorcelain(buffer) {
  const fields = buffer.split("\0")
  const files = []
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i]
    if (!entry) continue
    const index = entry[0]
    const worktree = entry[1]
    const filePath = entry.slice(3)
    let origPath
    if (index === "R" || index === "C" || worktree === "R" || worktree === "C") {
      origPath = fields[++i] || undefined
    }
    const untracked = index === "?" && worktree === "?"
    const ignored = index === "!" && worktree === "!"
    if (ignored) continue
    files.push({
      path: filePath,
      origPath,
      index,
      worktree,
      untracked,
      staged: !untracked && index !== " " && index !== "?",
      unstaged: untracked || worktree !== " ",
    })
  }
  return files
}

/** Working-tree status for the repository containing `dir`. */
async function status(dir) {
  const repo = await repoInfo(dir)
  if (!repo.isRepo) return { ...repo, files: [] }

  // `--no-optional-locks` is a global git option, so it must precede the
  // subcommand; putting it after `status` makes git reject the whole command.
  const res = await git(
    ["-C", repo.root, "--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { timeoutMs: 30_000 },
  )
  if (!res.ok) return { ...repo, files: [], error: res.stderr.trim() || "git status failed" }
  return { ...repo, files: parsePorcelain(res.stdout) }
}

/** Resolve a repo-relative path and refuse anything outside the repository. */
function resolveInside(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative)) return null
  const full = path.resolve(root, relative)
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  if (full !== root && !full.startsWith(prefix)) return null
  return full
}

/**
 * Unified patch for one file.
 *
 * `scope` selects what the patch is measured against: `staged` compares the
 * index to HEAD, `worktree` compares the working tree to the index, and
 * `untracked` renders the whole file as an addition.
 */
async function diff(dir, { path: relative, scope = "worktree" } = {}) {
  const repo = await repoInfo(dir)
  if (!repo.isRepo) return { ok: false, error: "Not a git repository", files: [] }
  const full = resolveInside(repo.root, relative)
  if (!full) return { ok: false, error: "Invalid path" }

  const flags = ["--no-color", "--no-ext-diff", "--unified=3"]
  let args
  if (scope === "untracked") {
    // `git diff --no-index` against /dev/null renders a new file as all-added
    // and exits 1 when the two sides differ.
    args = ["-C", repo.root, "diff", ...flags, "--no-index", "--", process.platform === "win32" ? "NUL" : "/dev/null", relative]
  } else if (scope === "staged") {
    args = ["-C", repo.root, "diff", "--cached", ...flags, "--", relative]
  } else {
    args = ["-C", repo.root, "diff", ...flags, "--", relative]
  }

  const res = await git(args, { timeoutMs: 30_000 })
  if (!res.ok && res.code !== 1) return { ok: false, error: res.stderr.trim() || "git diff failed" }

  let patch = res.stdout
  let truncated = false
  if (Buffer.byteLength(patch, "utf8") > MAX_PATCH_BYTES) {
    patch = Buffer.from(patch, "utf8").subarray(0, MAX_PATCH_BYTES).toString("utf8")
    // Drop a dangling final line so the renderer never sees half a row.
    patch = patch.slice(0, patch.lastIndexOf("\n") + 1)
    truncated = true
  }

  const binary = /^Binary files .* differ$/m.test(patch) || patch.includes("GIT binary patch")
  return { ok: true, patch, binary, truncated, root: repo.root }
}

/** Stage one path (works for additions, modifications and deletions). */
async function stage(dir, relative) {
  const repo = await repoInfo(dir)
  if (!repo.isRepo) return { ok: false, error: "Not a git repository" }
  if (!resolveInside(repo.root, relative)) return { ok: false, error: "Invalid path" }
  const res = await git(["-C", repo.root, "add", "-A", "--", relative])
  return res.ok ? { ok: true } : { ok: false, error: res.stderr.trim() || "git add failed" }
}

/** Unstage one path, leaving the working tree untouched. */
async function unstage(dir, relative) {
  const repo = await repoInfo(dir)
  if (!repo.isRepo) return { ok: false, error: "Not a git repository" }
  if (!resolveInside(repo.root, relative)) return { ok: false, error: "Invalid path" }
  const res = await git(["-C", repo.root, "restore", "--staged", "--", relative])
  if (res.ok) return { ok: true }
  // Older git (< 2.23) has no `restore`.
  const fallback = await git(["-C", repo.root, "reset", "-q", "HEAD", "--", relative])
  return fallback.ok ? { ok: true } : { ok: false, error: fallback.stderr.trim() || "git reset failed" }
}

module.exports = { git, repoInfo, status, diff, stage, unstage }
