// One browser session: verify the engine -> resolve the exit IP -> start the engine -> embed it.
// Emits progress for the loading screen and keeps watch for an unexpected exit.
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { serve, resolveGeoDetailed, type Server } from "code-browser";
import { Cdp } from "./cdp.js";
import type { AppConfig } from "./config.js";
import { parseProxy } from "./config.js";
import type { Embedder } from "./embed.js";
import { Guard } from "./guard.js";

export type StepId = "verify" | "geo" | "launch" | "embed";
export type StepStatus = "pending" | "running" | "done" | "skipped" | "error";
export interface Step { id: StepId; label: string; status: StepStatus; note?: string }

export const STEP_LABELS: Record<StepId, string> = {
  verify: "校验浏览器内核",
  geo: "查询代理出口 IP，设置时区与语言",
  launch: "启动浏览器（无地址栏模式）",
  embed: "嵌入到应用窗口",
};

const EXE = process.platform === "win32" ? "chrome.exe" : "chrome";

/** Where the engine is: the configured path, else a `kernel/` folder next to the app. */
export function kernelCandidates(configured: string, roots: { appRoot: string; resources: string }): string[] {
  if (configured) return [path.isAbsolute(configured) ? configured : path.resolve(roots.appRoot, configured)];
  return [path.join(roots.resources, "kernel", EXE), path.join(roots.appRoot, "kernel", EXE)];
}

export function findKernel(configured: string, roots: { appRoot: string; resources: string }): { path: string; found: boolean } {
  const c = kernelCandidates(configured, roots);
  const hit = c.find((p) => fs.existsSync(p));
  return { path: hit ?? c[0], found: Boolean(hit) };
}

/** The engine's command line beyond what serve() adds. */
export function engineArgs(cfg: AppConfig, opts: { exitIp?: string; offscreen: boolean }): string[] {
  const a = [
    `--app=${cfg.startUrl}`,
    "--portable-profile",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,800",
  ];
  if (opts.offscreen) a.push("--window-position=-32000,-32000");   // no flash before it is embedded
  if (opts.exitIp) a.push(`--webrtc-ip=${opts.exitIp}`);
  return [...a, ...cfg.extraArgs];
}

/**
 * Does the process still exist? A browser killed by a signal keeps exitCode null in Node, so
 * Server.isAlive() alone misses it; signal 0 only probes for existence.
 */
export function pidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function sha256(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

export interface SessionEvents {
  steps: (steps: Step[]) => void;
  status: (s: { ip?: string; timezone?: string }) => void;
  ready: () => void;
  failed: (message: string) => void;
  crashed: () => void;
  title: (title: string) => void;
  toast: (t: { title: string; body: string }) => void;
}

export class Session extends EventEmitter {
  private steps: Step[] = (Object.keys(STEP_LABELS) as StepId[]).map((id) => ({ id, label: STEP_LABELS[id], status: "pending" }));
  private server: Server | null = null;
  private cdp: Cdp | null = null;
  private guard: Guard | null = null;
  private watch: ReturnType<typeof setInterval> | null = null;
  private stopping = false;
  private cancelled = false;

  constructor(
    private readonly cfg: AppConfig,
    private readonly paths: { appRoot: string; resources: string; userData: string },
    private readonly embedder: Embedder,
  ) { super(); }

  get running(): boolean { return this.server !== null; }

  async start(): Promise<void> {
    try {
      // 1. engine
      const { exe } = await this.step("verify", async () => {
        const k = findKernel(this.cfg.executablePath, this.paths);
        if (!k.found) throw new Error(`未找到浏览器内核：${k.path}。请把编译好的内核放到这个位置，或在配置文件中设置 executablePath。`);
        if (this.cfg.kernelSha256) {
          const got = await sha256(k.path);
          if (got.toLowerCase() !== this.cfg.kernelSha256.toLowerCase()) throw new Error("浏览器内核的 SHA-256 与配置中的 kernelSha256 不一致，文件可能被替换或损坏。");
          return { exe: k.path, note: "SHA-256 一致" };
        }
        return { exe: k.path, note: "已找到" };
      });

      // 2. exit IP -> timezone / language
      const proxy = this.cfg.proxy ? parseProxy(this.cfg.proxy) : undefined;
      let timezone = this.cfg.timezone || undefined;
      let acceptLanguage = this.cfg.acceptLanguage || undefined;
      let exitIp: string | undefined;
      if (this.cfg.geoip) {
        await this.step("geo", async () => {
          const r = await resolveGeoDetailed(proxy, { quiet: true });
          if (!r.geo) return { note: `未能获取（${r.reason ?? "未知原因"}），使用默认设置` };
          exitIp = r.geo.ip;
          timezone ??= r.geo.timezone;
          acceptLanguage ??= r.geo.acceptLanguage;
          return { note: [r.geo.ip, r.geo.timezone].filter(Boolean).join(" · ") };
        });
      } else this.mark("geo", "skipped", "配置中已关闭");
      this.emit("status", { ip: exitIp, timezone });
      this.checkCancelled();

      // 3. engine
      await this.step("launch", async () => {
        this.server = await serve({
          executablePath: exe,
          fingerprint: this.cfg.fingerprint,
          platform: this.cfg.platform,
          brand: this.cfg.brand,
          proxy,
          timezone,
          acceptLanguage,
          geoip: false,
          headless: false,
          quiet: true,
          userDataDir: path.join(this.paths.userData, "profile"),
          args: engineArgs(this.cfg, { exitIp, offscreen: this.embedder.supported }),
        });
        this.checkCancelled();
        this.cdp = await Cdp.connect(this.server.cdpUrl);
        this.cdp.on("disconnected", () => this.checkAlive());
        this.guard = new Guard(this.cdp, { startUrl: this.cfg.startUrl, newWindow: this.cfg.newWindow }, {
          onTitle: (t) => this.emit("title", t),
          onToast: (title, body) => this.emit("toast", { title, body }),
        });
        await this.guard.start();
        return {};
      });

      // 4. embed
      if (this.embedder.supported) {
        await this.step("embed", async () => {
          await this.embedder.attach(this.server!.pid ?? -1);
          return {};
        });
      } else this.mark("embed", "skipped", "仅 Windows 支持嵌入；当前以独立窗口运行");

      this.watch = setInterval(() => this.checkAlive(), 1000);
      this.emit("ready");
    } catch (e) {
      const msg = (e as Error).message;
      await this.shutdown();
      if (!this.cancelled) this.emit("failed", msg);
    }
  }

  nav(action: "back" | "forward" | "reload" | "home"): void {
    void this.guard?.nav(action).catch(() => {});
  }

  /** Stop on request (Stop button, quitting, cancel during loading). */
  async stop(): Promise<void> {
    this.cancelled = true;
    await this.shutdown();
  }

  private async shutdown(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
    this.guard?.stop();
    this.cdp?.close();
    this.embedder.detach();
    const srv = this.server;
    this.server = null;
    if (srv) await srv.close().catch(() => {});
  }

  private checkAlive(): void {
    if (this.stopping || !this.server) return;
    if (!this.server.isAlive() || !pidAlive(this.server.pid)) {
      void this.shutdown().then(() => this.emit("crashed"));
    }
  }

  private checkCancelled(): void {
    if (this.cancelled) throw new Error("cancelled");
  }

  private async step<T extends { note?: string }>(id: StepId, fn: () => Promise<T>): Promise<T> {
    this.checkCancelled();
    this.mark(id, "running");
    try {
      const r = await fn();
      this.mark(id, "done", r.note);
      return r;
    } catch (e) {
      this.mark(id, "error", (e as Error).message);
      throw e;
    }
  }

  private mark(id: StepId, status: StepStatus, note?: string): void {
    this.steps = this.steps.map((s) => (s.id === id ? { ...s, status, note } : s));
    this.emit("steps", this.steps);
  }
}
