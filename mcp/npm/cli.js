#!/usr/bin/env node
// Thin launcher: run the Python `code-browser-mcp` stdio server, installing it on first use.
// The Python package pulls in `code-browser` (which downloads + SHA-256-verifies the stealth binary).
//
// Route, first that applies:
//   1. `code-browser-mcp` already installed (and new enough) in the system Python: run it, as before.
//   2. `uvx`:  runs it from an isolated, cached environment; needs no system Python.
//   3. `pipx run`: the same, for machines with pipx.
//   4. `pip install --user` (plain `pip install` inside a virtual environment), then run it.
// uvx and pipx come before pip because many Pythons (Debian 12+, Ubuntu 23.04+, Homebrew) refuse
// `pip install` outside a virtual environment (PEP 668, "externally-managed-environment").
"use strict";
const { spawnSync, spawn } = require("node:child_process");
const { version: LAUNCHER_VERSION } = require("./package.json");

const SPEC = "code-browser-mcp>=" + LAUNCHER_VERSION;
const MIN_PYTHON = [3, 10]; // the package's requires-python (mcp/pyproject.toml; a test keeps them equal)

function pythons() {
  return process.platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"];
}
// stdout of `cmd args` when it exits 0, else null (also when cmd is not there).
function output(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return r.status === 0 ? (r.stdout || "").trim() : null;
}
// The first Python on PATH new enough for the package; an older one is passed over.
function findPython() {
  return pythons().find((p) => {
    const v = output(p, ["-c", "import sys;print('%d.%d' % sys.version_info[:2])"]);
    return v !== null && !older(v, MIN_PYTHON.join("."));
  }) || null;
}
// Version of the importable Python server, or null when it is missing or fails to import (0.1.0
// fails under mcp 2.x, and a plain `pip install` would call it satisfied and leave it broken).
function serverVersion(py) {
  return output(py, ["-c", "import code_browser_mcp;print(code_browser_mcp.__version__)"]);
}
function inVirtualenv(py) {
  return output(py, ["-c", "import sys;print(int(sys.prefix != sys.base_prefix))"]) === "1";
}
function onPath(cmd) {
  return output(cmd, ["--version"]) !== null;
}
function older(a, b) {
  const num = (v) => v.split(".").map((p) => parseInt(p, 10) || 0);
  const pa = num(a), pb = num(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}

function fail(lines) {
  console.error(lines.join("\n"));
  process.exit(1);
}
const FIXES = [
  "Fix it with one of these, then run this again:",
  "  - install uv  (https://docs.astral.sh/uv/getting-started/installation/): the launcher then uses uvx",
  "  - install pipx  (e.g. `sudo apt install pipx`, `brew install pipx`): the launcher then uses pipx",
  "  - or install the server into a virtual environment and point your MCP client at it:",
  `      python3 -m venv ~/.code-browser-mcp && ~/.code-browser-mcp/bin/pip install "${SPEC}"`,
  "      command: ~/.code-browser-mcp/bin/code-browser-mcp   (on Windows: %USERPROFILE%\\.code-browser-mcp\\Scripts\\code-browser-mcp.exe)",
];

// [command, args] that starts the server, installing it with pip first if that is the route.
function route() {
  const py = findPython();
  const have = py && serverVersion(py);
  if (have && !older(have, LAUNCHER_VERSION)) return [py, ["-m", "code_browser_mcp"]];
  if (onPath("uvx")) return ["uvx", ["--from", SPEC, "code-browser-mcp"]];
  if (onPath("pipx")) return ["pipx", ["run", "--spec", SPEC, "code-browser-mcp"]];
  const minimum = MIN_PYTHON.join(".");
  if (!py) {
    fail([`[code-browser-mcp] the server needs Python ${minimum}+ (with pip), uv or pipx, and none of them was found.`,
          ...FIXES.slice(0, 3), `  - or install Python ${minimum}+`]);
  }
  console.error(have
    ? `[code-browser-mcp] upgrading the Python package \`code-browser-mcp\` ${have} -> ${LAUNCHER_VERSION}…`
    : "[code-browser-mcp] installing the Python package `code-browser-mcp` with pip…");
  // pip's stdout goes to stderr: stdout is the MCP channel the client is about to read. Its stderr is read (and
  // passed on) to tell a PEP 668 refusal from any other failure.
  const user = inVirtualenv(py) ? [] : ["--user"];
  const install = spawnSync(py, ["-m", "pip", "install", ...user, "--quiet", "--upgrade", SPEC],
                            { stdio: ["ignore", 2, "pipe"], encoding: "utf8" });
  process.stderr.write(install.stderr || "");
  const now = serverVersion(py);
  if (install.status !== 0 || !now || older(now, LAUNCHER_VERSION)) {
    const why = /externally[- ]managed[- ]environment/i.test(install.stderr || "")
      ? `This Python refuses \`pip install\` outside a virtual environment (PEP 668: "externally-managed-environment"),
as Debian 12+, Ubuntu 23.04+ and Homebrew do; pip's own message is above.`
      : "pip's own message is above.";
    fail([`[code-browser-mcp] could not install the Python package \`code-browser-mcp\`: there is no uvx or pipx on PATH, and pip
could not install it. ${why}`, ...FIXES]);
  }
  return [py, ["-m", "code_browser_mcp"]];
}

const [cmd, args] = route();
// Hand over stdio to the MCP server (stdio transport).
const child = spawn(cmd, args, { stdio: "inherit", env: process.env });
child.on("error", (err) => fail([`[code-browser-mcp] could not start ${cmd}: ${err.message}`]));
child.on("exit", (code) => process.exit(code == null ? 0 : code));
// A stopped server closes its browser before it exits. Elsewhere a stop signal is passed on to it. On Windows Node can
// only end a process by force (child.kill), which would leave the browser running: Ctrl+C and Ctrl+Break reach the
// server from the console it shares with this launcher, so the launcher waits for it to exit.
if (process.platform === "win32") {
  for (const signal of ["SIGINT", "SIGBREAK"]) process.on(signal, () => {});
} else {
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
}
