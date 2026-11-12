import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../src/main/config.js";
import { addCommands, deleteCommands, policyValues } from "../src/main/policy.js";
import { engineArgs, findKernel, kernelCandidates } from "../src/main/session.js";
import {
  WS_CAPTION, WS_CHILD, WS_POPUP, WS_THICKFRAME, WS_VISIBLE, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
  childStyle, followStyle, hwndFromBuffer, isBlockedShortcut, noTaskbarExStyle, pickBrowserWindow, toPhysical,
} from "../src/main/winconst.js";

describe("window styles", () => {
  const overlapped = (WS_CAPTION | WS_THICKFRAME | 0x00080000 | 0x00020000 | 0x00010000 | WS_VISIBLE) >>> 0;

  it("turns a framed window into a visible child without a frame", () => {
    const s = childStyle(overlapped);
    expect(s & WS_CHILD).toBe(WS_CHILD);
    expect(s & WS_VISIBLE).toBe(WS_VISIBLE);
    expect(s & WS_CAPTION).toBe(0);
    expect(s & WS_THICKFRAME).toBe(0);
    expect(childStyle((overlapped | WS_POPUP) >>> 0) & WS_POPUP).toBe(0);
    expect(s).toBeGreaterThanOrEqual(0);
  });

  it("makes a frameless popup for follow mode", () => {
    const s = followStyle(overlapped);
    expect((s & WS_POPUP) >>> 0).toBe(WS_POPUP);
    expect(s & WS_CHILD).toBe(0);
    expect(s & WS_CAPTION).toBe(0);
  });

  it("drops the taskbar button", () => {
    const ex = noTaskbarExStyle(WS_EX_APPWINDOW);
    expect(ex & WS_EX_APPWINDOW).toBe(0);
    expect(ex & WS_EX_TOOLWINDOW).toBe(WS_EX_TOOLWINDOW);
  });
});

describe("geometry", () => {
  it("is exact at 100 %", () => {
    expect(toPhysical({ x: 0, y: 88, width: 1280, height: 712 }, 1)).toEqual({ x: 0, y: 88, width: 1280, height: 712 });
  });

  it("rounds edges at 125 % and 150 % so areas meet without gaps", () => {
    expect(toPhysical({ x: 0, y: 88, width: 1280, height: 712 }, 1.25)).toEqual({ x: 0, y: 110, width: 1600, height: 890 });
    const a = toPhysical({ x: 0, y: 0, width: 100.4, height: 10 }, 1.5);
    const b = toPhysical({ x: 100.4, y: 0, width: 50, height: 10 }, 1.5);
    expect(a.x + a.width).toBe(b.x);
  });

  it("reads an HWND from Electron's handle buffer", () => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(0x1a2b3cn);
    expect(hwndFromBuffer(b)).toBe(0x1a2b3c);
    const b4 = Buffer.alloc(4);
    b4.writeUInt32LE(0x55);
    expect(hwndFromBuffer(b4)).toBe(0x55);
  });

  it("picks the engine's largest visible main window", () => {
    expect(pickBrowserWindow([
      { hwnd: 1, className: "Chrome_WidgetWin_0", visible: true, area: 9e6 },
      { hwnd: 2, className: "Chrome_WidgetWin_1", visible: false, area: 9e6 },
      { hwnd: 3, className: "Chrome_WidgetWin_1", visible: true, area: 100 },
      { hwnd: 4, className: "Chrome_WidgetWin_1", visible: true, area: 1e6 },
    ])).toBe(4);
    expect(pickBrowserWindow([])).toBeNull();
  });
});

describe("shortcuts", () => {
  const k = (vk: number, mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean }> = {}) =>
    ({ vk, ctrl: false, shift: false, alt: false, ...mods });

  it("blocks browser UI shortcuts", () => {
    expect(isBlockedShortcut(k(0x54, { ctrl: true }))).toBe(true);                 // Ctrl+T
    expect(isBlockedShortcut(k(0x4e, { ctrl: true }))).toBe(true);                 // Ctrl+N
    expect(isBlockedShortcut(k(0x4e, { ctrl: true, shift: true }))).toBe(true);    // Ctrl+Shift+N
    expect(isBlockedShortcut(k(0x49, { ctrl: true, shift: true }))).toBe(true);    // Ctrl+Shift+I
    expect(isBlockedShortcut(k(0x7b))).toBe(true);                                  // F12
    expect(isBlockedShortcut(k(0x46, { alt: true }))).toBe(true);                  // Alt+F
    expect(isBlockedShortcut(k(0x2e, { ctrl: true, shift: true }))).toBe(true);    // Ctrl+Shift+Del
  });

  it("keeps editing and find shortcuts", () => {
    for (const vk of [0x43, 0x56, 0x58, 0x41, 0x5a, 0x46, 0x50]) {                // C V X A Z F P
      expect(isBlockedShortcut(k(vk, { ctrl: true })), vk.toString(16)).toBe(false);
    }
    expect(isBlockedShortcut(k(0x54))).toBe(false);                                 // plain "t" typing
    expect(isBlockedShortcut(k(0x74))).toBe(false);                                 // F5 reload
  });
});

describe("policies", () => {
  it("writes and removes the same values", () => {
    const add = addCommands();
    const del = deleteCommands();
    expect(add.length).toBe(policyValues().length);
    expect(add.map((a) => [a[1], a[3]])).toEqual(del.map((d) => [d[1], d[3]]));
    expect(add[0]).toEqual(["add", "HKCU\\Software\\Policies\\Chromium", "/v", "DeveloperToolsAvailability", "/t", "REG_DWORD", "/d", "2", "/f"]);
    expect(add.some((a) => a[1].endsWith("\\URLBlocklist") && a[7] === "chrome://*")).toBe(true);
  });
});

describe("engine", () => {
  it("builds the app-mode command line", () => {
    const a = engineArgs({ ...DEFAULTS, startUrl: "https://s.example/", extraArgs: ["--lang=zh-CN"] }, { exitIp: "203.0.113.7", offscreen: true });
    expect(a[0]).toBe("--app=https://s.example/");
    expect(a).toContain("--portable-profile");
    expect(a).toContain("--window-position=-32000,-32000");
    expect(a).toContain("--webrtc-ip=203.0.113.7");
    expect(a.at(-1)).toBe("--lang=zh-CN");
    const b = engineArgs(DEFAULTS, { offscreen: false });
    expect(b.some((x) => x.startsWith("--window-position"))).toBe(false);
    expect(b.some((x) => x.startsWith("--webrtc-ip"))).toBe(false);
  });

  it("finds the engine in kernel/ or at the configured path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-kernel-"));
    const roots = { appRoot: root, resources: path.join(root, "res") };
    expect(findKernel("", roots).found).toBe(false);
    const exe = process.platform === "win32" ? "chrome.exe" : "chrome";
    fs.mkdirSync(path.join(root, "kernel"));
    fs.writeFileSync(path.join(root, "kernel", exe), "");
    expect(findKernel("", roots)).toEqual({ path: path.join(root, "kernel", exe), found: true });
    expect(kernelCandidates("bin/chrome.exe", roots)).toEqual([path.join(root, "bin", "chrome.exe")]);
    expect(kernelCandidates("/abs/chrome.exe", roots)).toEqual(["/abs/chrome.exe"]);
  });
});
