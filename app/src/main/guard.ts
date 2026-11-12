// Keeps the embedded browser to ONE page: no internal pages (chrome://, devtools://, …) and no
// extra windows or tabs. New windows are either opened in the main page or closed, per config.
import type { CdpEvent, CdpTransport } from "./cdp.js";
import type { NewWindowPolicy } from "./config.js";

export interface TargetInfo {
  targetId: string;
  type: string;
  url: string;
  title?: string;
  openerId?: string;
}

const BLOCKED_PREFIXES = [
  "chrome:", "chrome-untrusted:", "chrome-search:", "chrome-extension:", "devtools:",
  "view-source:", "file:", "edge:", "brave:",
];

/** Internal or local pages the user must never reach. about:blank and about:srcdoc are allowed. */
export function isBlockedUrl(url: string): boolean {
  const u = url.trim().toLowerCase();
  if (BLOCKED_PREFIXES.some((p) => u.startsWith(p))) return true;
  if (u.startsWith("about:")) return !(u === "about:blank" || u === "about:srcdoc");
  return false;
}

export function isBlank(url: string): boolean {
  const u = url.trim().toLowerCase();
  return u === "" || u === "about:blank";
}

/**
 * Targets that are not pages. Only DevTools windows among them are closed: the rest are workers,
 * frames, or Chromium's own UI (type "browser_ui", e.g. chrome://omnibox-popup.top-chrome/), which
 * Chromium recreates at once if closed.
 */
function isDevtoolsWindow(t: TargetInfo): boolean {
  return t.type !== "page" && t.url.trim().toLowerCase().startsWith("devtools:");
}

export type NewPageAction = "close-internal" | "close-blocked" | "wait" | "redirect";

/** What to do with a page target that is not the main page. */
export function classifyNewPage(url: string, policy: NewWindowPolicy): NewPageAction {
  if (isBlockedUrl(url)) return "close-internal";
  if (policy === "block") return "close-blocked";
  return isBlank(url) ? "wait" : "redirect";
}

export interface GuardHooks {
  onTitle(title: string): void;
  onToast(title: string, body: string): void;
}

export interface GuardOptions {
  startUrl: string;
  newWindow: NewWindowPolicy;
  /** How long a new blank window may stay blank before it is closed (ms). */
  blankTimeoutMs?: number;
}

export class Guard {
  private mainId: string | null = null;
  private mainSession: string | null = null;
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly onEvent = (e: CdpEvent) => { void this.handle(e).catch(() => { /* target may be gone */ }); };

  constructor(private readonly cdp: CdpTransport, private readonly opts: GuardOptions, private readonly hooks: GuardHooks) {}

  get mainTargetId(): string | null { return this.mainId; }

  async start(): Promise<void> {
    this.cdp.on("event", this.onEvent);
    await this.cdp.send("Target.setDiscoverTargets", { discover: true });
    const { targetInfos } = await this.cdp.send<{ targetInfos: TargetInfo[] }>("Target.getTargets");
    for (const t of targetInfos) await this.onCreated(t);
  }

  stop(): void {
    this.cdp.off("event", this.onEvent);
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
  }

  /** Toolbar actions on the main page. */
  async nav(action: "back" | "forward" | "reload" | "home"): Promise<void> {
    const s = this.mainSession;
    if (!s) return;
    if (action === "reload") { await this.cdp.send("Page.reload", {}, s); return; }
    if (action === "home") { await this.cdp.send("Page.navigate", { url: this.opts.startUrl }, s); return; }
    const h = await this.cdp.send<{ currentIndex: number; entries: { id: number }[] }>("Page.getNavigationHistory", {}, s);
    const i = h.currentIndex + (action === "back" ? -1 : 1);
    if (i >= 0 && i < h.entries.length) await this.cdp.send("Page.navigateToHistoryEntry", { entryId: h.entries[i].id }, s);
  }

  private async handle(e: CdpEvent): Promise<void> {
    if (e.sessionId) return;   // page-session events are not used
    const info = e.params.targetInfo as TargetInfo | undefined;
    if (e.method === "Target.targetCreated" && info) await this.onCreated(info);
    else if (e.method === "Target.targetInfoChanged" && info) await this.onChanged(info);
    else if (e.method === "Target.targetDestroyed") this.clearPending(String(e.params.targetId));
  }

  private async onCreated(t: TargetInfo): Promise<void> {
    if (t.type !== "page") {
      if (isDevtoolsWindow(t)) await this.close(t.targetId, "已拦截：开发者工具", "开发者工具在本应用中不可用。");
      return;
    }
    if (this.mainId === null && !isBlockedUrl(t.url)) {
      await this.adoptMain(t);
      return;
    }
    if (t.targetId === this.mainId) return;
    await this.applyToNewPage(t);
  }

  private async onChanged(t: TargetInfo): Promise<void> {
    if (t.targetId === this.mainId) {
      if (t.title !== undefined) this.hooks.onTitle(t.title || t.url);
      if (isBlockedUrl(t.url) && this.mainSession) {
        await this.cdp.send("Page.navigate", { url: this.opts.startUrl }, this.mainSession);
        this.hooks.onToast("已拦截：浏览器内部页面", "这个页面在本应用中不可用，已返回起始页。");
      }
      return;
    }
    if (this.pending.has(t.targetId) && !isBlank(t.url)) {
      this.clearPending(t.targetId);
      await this.applyToNewPage(t);
    } else if (!this.pending.has(t.targetId) && isDevtoolsWindow(t)) {
      await this.close(t.targetId, "已拦截：开发者工具", "开发者工具在本应用中不可用。");
    }
  }

  private async applyToNewPage(t: TargetInfo): Promise<void> {
    switch (classifyNewPage(t.url, this.opts.newWindow)) {
      case "close-internal":
        await this.close(t.targetId, "已拦截：浏览器内部页面", "这个页面在本应用中不可用。");
        break;
      case "close-blocked":
        await this.close(t.targetId, "已拦截：打开新窗口", "网页尝试打开新窗口，已被拦截。");
        break;
      case "wait":
        this.pending.set(t.targetId, setTimeout(() => {
          this.pending.delete(t.targetId);
          void this.close(t.targetId, "已拦截：打开新窗口", "网页尝试打开一个空白窗口，已被拦截。").catch(() => {});
        }, this.opts.blankTimeoutMs ?? 5_000));
        break;
      case "redirect":
        if (this.mainSession) await this.cdp.send("Page.navigate", { url: t.url }, this.mainSession);
        await this.close(t.targetId, "已拦截：打开新窗口", "网页尝试打开新窗口，已改为在当前页面中打开。");
        break;
    }
  }

  private async adoptMain(t: TargetInfo): Promise<void> {
    this.mainId = t.targetId;
    const { sessionId } = await this.cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId: t.targetId, flatten: true });
    this.mainSession = sessionId;
    if (t.title) this.hooks.onTitle(t.title);
  }

  private async close(targetId: string, toastTitle: string, toastBody: string): Promise<void> {
    this.clearPending(targetId);
    await this.cdp.send("Target.closeTarget", { targetId });
    this.hooks.onToast(toastTitle, toastBody);
  }

  private clearPending(targetId: string): void {
    const t = this.pending.get(targetId);
    if (t) clearTimeout(t);
    this.pending.delete(targetId);
  }
}
