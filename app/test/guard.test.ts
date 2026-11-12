import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { CdpTransport } from "../src/main/cdp.js";
import { classifyNewPage, Guard, isBlank, isBlockedUrl, type TargetInfo } from "../src/main/guard.js";

describe("url rules", () => {
  it("blocks internal and local pages", () => {
    for (const u of ["chrome://settings", "CHROME://flags", "devtools://devtools/x", "chrome-extension://abc/",
      "view-source:https://a", "file:///C:/x", "about:settings", "chrome-untrusted://x", "edge://settings"]) {
      expect(isBlockedUrl(u), u).toBe(true);
    }
  });

  it("allows web pages and blank pages", () => {
    for (const u of ["https://example.com", "http://a.b/c", "about:blank", "about:srcdoc", ""]) {
      expect(isBlockedUrl(u), u).toBe(false);
    }
    expect(isBlank("about:blank")).toBe(true);
    expect(isBlank("https://x")).toBe(false);
  });

  it("classifies new pages by policy", () => {
    expect(classifyNewPage("chrome://history", "same-page")).toBe("close-internal");
    expect(classifyNewPage("https://x", "block")).toBe("close-blocked");
    expect(classifyNewPage("about:blank", "same-page")).toBe("wait");
    expect(classifyNewPage("https://x", "same-page")).toBe("redirect");
  });
});

class FakeCdp extends EventEmitter implements CdpTransport {
  calls: { method: string; params: Record<string, unknown>; sessionId?: string }[] = [];
  constructor(private readonly targets: TargetInfo[]) { super(); }
  async send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    this.calls.push({ method, params, sessionId });
    if (method === "Target.getTargets") return { targetInfos: this.targets } as T;
    if (method === "Target.attachToTarget") return { sessionId: "S-main" } as T;
    if (method === "Page.getNavigationHistory") return { currentIndex: 1, entries: [{ id: 10 }, { id: 11 }, { id: 12 }] } as T;
    return {} as T;
  }
  close(): void {}
  fire(method: string, params: Record<string, unknown>): void { this.emit("event", { method, params }); }
  of(method: string) { return this.calls.filter((c) => c.method === method); }
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const main: TargetInfo = { targetId: "M", type: "page", url: "https://start.example/", title: "Start" };

async function setup(newWindow: "same-page" | "block" = "same-page") {
  const cdp = new FakeCdp([{ targetId: "B", type: "browser", url: "" }, main]);
  const hooks = { onTitle: vi.fn(), onToast: vi.fn() };
  const g = new Guard(cdp, { startUrl: "https://start.example/", newWindow, blankTimeoutMs: 30 }, hooks);
  await g.start();
  return { cdp, hooks, g };
}

describe("Guard", () => {
  it("adopts the existing page as the main page", async () => {
    const { cdp, hooks, g } = await setup();
    expect(g.mainTargetId).toBe("M");
    expect(cdp.of("Target.setDiscoverTargets")[0].params).toEqual({ discover: true });
    expect(cdp.of("Target.attachToTarget")[0].params).toEqual({ targetId: "M", flatten: true });
    expect(hooks.onTitle).toHaveBeenCalledWith("Start");
    expect(cdp.of("Runtime.enable")).toEqual([]);
  });

  it("opens a new window's URL in the main page and closes the window", async () => {
    const { cdp, hooks } = await setup("same-page");
    cdp.fire("Target.targetCreated", { targetInfo: { targetId: "P2", type: "page", url: "https://other.example/" } });
    await flush();
    expect(cdp.of("Page.navigate")).toEqual([{ method: "Page.navigate", params: { url: "https://other.example/" }, sessionId: "S-main" }]);
    expect(cdp.of("Target.closeTarget")[0].params).toEqual({ targetId: "P2" });
    expect(hooks.onToast).toHaveBeenCalledWith("已拦截：打开新窗口", expect.stringContaining("当前页面"));
  });

  it("waits for a blank window to get its URL", async () => {
    const { cdp } = await setup("same-page");
    cdp.fire("Target.targetCreated", { targetInfo: { targetId: "P3", type: "page", url: "about:blank" } });
    await flush();
    expect(cdp.of("Target.closeTarget")).toEqual([]);
    cdp.fire("Target.targetInfoChanged", { targetInfo: { targetId: "P3", type: "page", url: "https://late.example/" } });
    await flush();
    expect(cdp.of("Page.navigate")[0].params).toEqual({ url: "https://late.example/" });
    expect(cdp.of("Target.closeTarget")[0].params).toEqual({ targetId: "P3" });
  });

  it("closes a window that stays blank", async () => {
    const { cdp } = await setup("same-page");
    cdp.fire("Target.targetCreated", { targetInfo: { targetId: "P4", type: "page", url: "" } });
    await new Promise((r) => setTimeout(r, 60));
    expect(cdp.of("Target.closeTarget")[0].params).toEqual({ targetId: "P4" });
    expect(cdp.of("Page.navigate")).toEqual([]);
  });

  it("closes new windows outright under the block policy", async () => {
    const { cdp } = await setup("block");
    cdp.fire("Target.targetCreated", { targetInfo: { targetId: "P5", type: "page", url: "https://x.example/" } });
    await flush();
    expect(cdp.of("Target.closeTarget")[0].params).toEqual({ targetId: "P5" });
    expect(cdp.of("Page.navigate")).toEqual([]);
  });

  it("closes DevTools and internal pages wherever they open", async () => {
    const { cdp } = await setup();
    cdp.fire("Target.targetCreated", { targetInfo: { targetId: "D", type: "other", url: "devtools://devtools/bundled/inspector.html" } });
    cdp.fire("Target.targetCreated", { targetInfo: { targetId: "S", type: "page", url: "chrome://settings/" } });
    await flush();
    expect(cdp.of("Target.closeTarget").map((c) => c.params.targetId).sort()).toEqual(["D", "S"]);
  });

  it("ignores workers, iframes and Chromium's own UI targets", async () => {
    const { cdp, hooks } = await setup();
    cdp.fire("Target.targetCreated", { targetInfo: { targetId: "W", type: "service_worker", url: "chrome-extension://abc/background.js" } });
    cdp.fire("Target.targetCreated", { targetInfo: { targetId: "F", type: "iframe", url: "https://ads.example/" } });
    cdp.fire("Target.targetCreated", { targetInfo: { targetId: "U", type: "browser_ui", url: "chrome://omnibox-popup.top-chrome/" } });
    cdp.fire("Target.targetInfoChanged", { targetInfo: { targetId: "U", type: "browser_ui", url: "chrome://omnibox-popup.top-chrome/x" } });
    await flush();
    expect(cdp.of("Target.closeTarget")).toEqual([]);
    expect(hooks.onToast).not.toHaveBeenCalled();
  });

  it("sends the main page back to the start URL when it reaches an internal page", async () => {
    const { cdp, hooks } = await setup();
    cdp.fire("Target.targetInfoChanged", { targetInfo: { ...main, url: "chrome://settings/", title: "Settings" } });
    await flush();
    expect(cdp.of("Page.navigate")[0]).toEqual({ method: "Page.navigate", params: { url: "https://start.example/" }, sessionId: "S-main" });
    expect(hooks.onToast).toHaveBeenCalled();
  });

  it("reports title changes of the main page", async () => {
    const { cdp, hooks } = await setup();
    cdp.fire("Target.targetInfoChanged", { targetInfo: { ...main, url: "https://start.example/a", title: "Page A" } });
    await flush();
    expect(hooks.onTitle).toHaveBeenLastCalledWith("Page A");
  });

  it("drives back / forward / reload / home on the main page", async () => {
    const { cdp, g } = await setup();
    await g.nav("back");
    await g.nav("forward");
    await g.nav("reload");
    await g.nav("home");
    expect(cdp.of("Page.navigateToHistoryEntry").map((c) => c.params.entryId)).toEqual([10, 12]);
    expect(cdp.of("Page.reload").length).toBe(1);
    expect(cdp.of("Page.navigate").at(-1)!.params).toEqual({ url: "https://start.example/" });
    expect(cdp.calls.filter((c) => c.method.startsWith("Page.")).every((c) => c.sessionId === "S-main")).toBe(true);
  });

  it("stops listening after stop()", async () => {
    const { cdp, g } = await setup();
    g.stop();
    cdp.fire("Target.targetCreated", { targetInfo: { targetId: "P9", type: "page", url: "https://x/" } });
    await flush();
    expect(cdp.of("Target.closeTarget")).toEqual([]);
  });
});
