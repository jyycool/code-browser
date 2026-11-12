// Electron main process: one shell window, one embedded browser session at a time.
import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, proxyLabel, type AppConfig } from "./config.js";
import { createEmbedder, type Embedder } from "./embed.js";
import { startShortcutBlocker } from "./keys.js";
import { removePolicies, writePolicies } from "./policy.js";
import { findKernel, Session } from "./session.js";
import type { Rect } from "./winconst.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..", "..");           // app/ (dev) or resources/app.asar (packaged)
const resources = app.isPackaged ? process.resourcesPath : appRoot;

if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;
let cfg: AppConfig;
let cfgFile = "";
let cfgWarnings: string[] = [];
let embedder: Embedder | null = null;
let session: Session | null = null;
let unhookKeys: () => void = () => {};
let policiesWritten = false;

function send(channel: string, payload?: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function info() {
  const kernel = findKernel(cfg.executablePath, { appRoot, resources });
  return {
    appName: cfg.appName,
    tagline: cfg.tagline,
    accent: cfg.accent,
    version: app.getVersion(),
    showNavBar: cfg.showNavBar,
    identity: `${cfg.fingerprint} · ${cfg.platform}`,
    proxy: proxyLabel(cfg.proxy),
    kernelFound: kernel.found,
    kernelPath: kernel.path,
    configFile: cfgFile,
    warnings: cfgWarnings,
  };
}

function createWindow(): void {
  win = new BrowserWindow({
    width: Math.min(1280, cfg.maxWindow.width),
    height: Math.min(800, cfg.maxWindow.height),
    minWidth: 960,
    minHeight: 600,
    maxWidth: cfg.maxWindow.width,
    maxHeight: cfg.maxWindow.height,
    frame: false,
    show: false,
    title: cfg.appName,
    backgroundColor: "#F5F6F8",
    webPreferences: {
      preload: path.join(appRoot, "src", "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.once("ready-to-show", () => win?.show());
  // The shell's own UI never navigates away or opens windows.
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  for (const ev of ["resize", "move", "maximize", "unmaximize", "restore"] as const) {
    win.on(ev as "resize", () => embedder?.reposition());
  }
  win.on("maximize", () => send("win:maximized", true));
  win.on("unmaximize", () => send("win:maximized", false));
  win.on("closed", () => { win = null; });
  void win.loadFile(path.join(appRoot, "src", "renderer", "index.html"));

  embedder = createEmbedder(win, cfg.embedMode);
  if (cfg.blockShortcuts) {
    try { unhookKeys = startShortcutBlocker(() => Boolean(session?.running && embedder?.ownsForeground())); }
    catch { /* the guard still closes anything a shortcut opens */ }
  }
}

async function startSession(): Promise<void> {
  if (session || !win || !embedder) return;
  const s = new Session(cfg, { appRoot, resources, userData: app.getPath("userData") }, embedder);
  session = s;
  s.on("steps", (steps) => send("session:steps", steps));
  s.on("status", (st) => send("session:status", st));
  s.on("title", (t) => send("session:title", t));
  s.on("toast", (t) => send("session:toast", t));
  s.on("ready", () => send("session:phase", { phase: "browser" }));
  s.on("failed", (message) => {
    if (session === s) session = null;
    send("session:phase", { phase: "failed", message });
  });
  s.on("crashed", () => {
    if (session === s) session = null;
    send("session:phase", { phase: "crash" });
  });
  send("session:phase", { phase: "loading" });
  await s.start();
}

async function stopSession(): Promise<void> {
  const s = session;
  session = null;
  if (s) await s.stop();
  send("session:phase", { phase: "home" });
}

ipcMain.handle("app:info", () => info());
ipcMain.handle("session:start", () => { void startSession(); });
ipcMain.handle("session:stop", () => stopSession());
ipcMain.on("session:bounds", (_e, r: Rect) => {
  if (r && [r.x, r.y, r.width, r.height].every((v) => Number.isFinite(v))) embedder?.setBounds(r);
});
ipcMain.on("session:nav", (_e, action: string) => {
  if (action === "back" || action === "forward" || action === "reload" || action === "home") session?.nav(action);
});
ipcMain.on("session:focus", () => embedder?.focus());
ipcMain.on("win:minimize", () => win?.minimize());
ipcMain.on("win:toggle-maximize", () => { if (win) (win.isMaximized() ? win.unmaximize() : win.maximize()); });
ipcMain.on("win:close", () => win?.close());

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  const loaded = loadConfig(app.getPath("userData"), path.join(appRoot, "config.default.json"));
  cfg = loaded.config;
  cfgFile = loaded.file;
  cfgWarnings = loaded.warnings;
  if (cfg.writePolicies) {
    await writePolicies();
    policiesWritten = true;
  }
  createWindow();
});

let quitting = false;
app.on("before-quit", (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  void (async () => {
    unhookKeys();
    if (session) await session.stop().catch(() => {});
    if (policiesWritten) await removePolicies();
    app.quit();
  })();
});

app.on("window-all-closed", () => app.quit());
