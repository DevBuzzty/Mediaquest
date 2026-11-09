#!/usr/bin/env node
"use strict"
// Written into the project by podium-init. A plugin cannot ship a statusLine, and a
// path into the plugin cache names a version directory that goes stale on the next
// update -- so this file finds the installed podium-rituals layer at run time.
//
// Lookup order: PODIUM_RITUALS_ROOT (explicit override), then the install record
// ~/.claude/plugins/installed_plugins.json (this project's entry, else the user entry, else the first). That record is Claude Code's internal
// file, not a documented interface: when it is missing, unreadable or has an
// unexpected shape, this prints a minimal line ending in "podium?" instead of
// failing, and podium-rituals' SessionStart check reports why.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { execFileSync } = require("child_process")

// Same worktree rule as podium-core/lib/data-dir.js (this file lives in the project and cannot require core).
const WORKTREE_PATH = /^(.*?)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+(?:[\\/].*)?$/i

function normPath(p) {
  let n = String(p).replace(/\\/g, "/").replace(/\/+$/, "")
  if (process.platform === "win32" || process.platform === "darwin") n = n.toLowerCase()
  return n
}

// installed_plugins.json lists the plugin once per scope: the user entry plus one per project that installed it.
// This project's own entry wins (a worktree counts as its main checkout), then the user entry, then [0].
function pickEntry(entries, projectDir) {
  if (projectDir) {
    const m = WORKTREE_PATH.exec(String(projectDir))
    const wanted = [normPath(projectDir)]
    if (m) wanted.push(normPath(m[1]))
    for (const w of wanted) {
      const hit = entries.find((e) => e && typeof e.projectPath === "string" && normPath(e.projectPath) === w)
      if (hit) return hit
    }
  }
  return entries.find((e) => e && e.scope === "user") || entries[0]
}

function resolveRitualsRoot(env = process.env, home = os.homedir(), projectDir = null) {
  if (env.PODIUM_RITUALS_ROOT) return { root: env.PODIUM_RITUALS_ROOT, via: "env", detail: null }
  const file = path.join(home, ".claude", "plugins", "installed_plugins.json")
  let raw
  try {
    raw = fs.readFileSync(file, "utf8")
  } catch (err) {
    return {
      root: null,
      via: err && err.code === "ENOENT" ? "missing" : "unreadable",
      detail: `${file}: ${err && err.message ? err.message : String(err)}`,
    }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { root: null, via: "corrupt", detail: `${file}: ${err.message}` }
  }
  const plugins = parsed && typeof parsed === "object" && parsed.plugins && typeof parsed.plugins === "object" ? parsed.plugins : null
  if (!plugins) return { root: null, via: "corrupt", detail: `${file}: no plugins object` }
  const key = Object.keys(plugins).find((k) => k.startsWith("podium-rituals@"))
  if (!key) return { root: null, via: "not-installed", detail: null }
  const entry = Array.isArray(plugins[key]) && plugins[key].length > 0 ? pickEntry(plugins[key], projectDir) : null
  if (!entry || typeof entry.installPath !== "string" || entry.installPath.length === 0) {
    return { root: null, via: "corrupt", detail: `${file}: ${key} has no installPath` }
  }
  return { root: entry.installPath, via: "installed_plugins", detail: null }
}

// "podium?" is literal on purpose: this file lives in the project and cannot reach lib/messages.js when it needs this line.
function minimalLine(projectDir) {
  let branch = "?"
  try {
    branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: projectDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()
  } catch (_) {
    /* not a repo -- keep "?" */
  }
  return `${os.hostname()} | ${branch} | podium?`
}

module.exports = { resolveRitualsRoot, minimalLine }

if (require.main === module) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  let line
  try {
    const { root } = resolveRitualsRoot(process.env, os.homedir(), projectDir)
    line = root ? require(path.join(root, "bin", "statusline.js")).render(projectDir) : minimalLine(projectDir)
  } catch (_) {
    line = minimalLine(projectDir)
  }
  process.stdout.write(line)
}
