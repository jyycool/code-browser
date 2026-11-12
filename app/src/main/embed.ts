// Puts the engine's --app window inside the shell window.
//   child  : SetParent -> the browser becomes a real child window of the shell (default)
//   follow : the browser stays a frameless top-level window owned by the shell, kept exactly over
//            the content area (fallback if child mode misbehaves on a machine)
// On other systems embedding is skipped and the engine shows its own window (development only).
import type { BrowserWindow } from "electron";
import { screen } from "electron";
import type { EmbedMode } from "./config.js";
import { user32 } from "./win32.js";
import {
  GWL_EXSTYLE, GWL_STYLE, GWLP_HWNDPARENT, SW_HIDE, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOZORDER,
  SWP_SHOWWINDOW, WS_CLIPCHILDREN, childStyle, followStyle, hwndFromBuffer, noTaskbarExStyle, pickBrowserWindow,
  toPhysical, type Rect,
} from "./winconst.js";

export interface Embedder {
  readonly supported: boolean;
  /** Find the browser's window and take it over. Resolves when done. */
  attach(pid: number, timeoutMs?: number): Promise<void>;
  /** The content area in CSS px, relative to the shell's client area. */
  setBounds(r: Rect): void;
  /** Re-apply the last bounds (the shell moved, resized or changed DPI). */
  reposition(): void;
  focus(): void;
  /** Is this foreground window ours (the shell or the embedded browser)? */
  ownsForeground(): boolean;
  detach(): void;
}

class NoopEmbedder implements Embedder {
  readonly supported = false;
  async attach(): Promise<void> { /* the engine keeps its own window */ }
  setBounds(): void {}
  reposition(): void {}
  focus(): void {}
  ownsForeground(): boolean { return false; }
  detach(): void {}
}

class WinEmbedder implements Embedder {
  readonly supported = true;
  private child = 0;
  private bounds: Rect | null = null;
  private readonly parent: number;

  constructor(private readonly win: BrowserWindow, private readonly mode: EmbedMode) {
    this.parent = hwndFromBuffer(win.getNativeWindowHandle());
  }

  async attach(pid: number, timeoutMs = 15_000): Promise<void> {
    const api = user32();
    const deadline = Date.now() + timeoutMs;
    let hwnd: number | null = null;
    while (Date.now() < deadline) {
      hwnd = pickBrowserWindow(api.findWindowsOfProcess(pid));
      if (hwnd) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!hwnd) throw new Error("没有找到浏览器窗口（超时）");
    this.child = hwnd;

    const ex = api.getStyle(hwnd, GWL_EXSTYLE);
    api.setStyle(hwnd, GWL_EXSTYLE, noTaskbarExStyle(ex));
    if (this.mode === "child") {
      api.setStyle(this.parent, GWL_STYLE, (api.getStyle(this.parent, GWL_STYLE) | WS_CLIPCHILDREN) >>> 0);
      api.setStyle(hwnd, GWL_STYLE, childStyle(api.getStyle(hwnd, GWL_STYLE)));
      api.setParent(hwnd, this.parent);
    } else {
      api.setStyle(hwnd, GWL_STYLE, followStyle(api.getStyle(hwnd, GWL_STYLE)));
      api.setStyle(hwnd, GWLP_HWNDPARENT, this.parent);   // owner: stays above the shell, no taskbar entry
    }
    if (this.bounds) this.apply();
    else api.show(hwnd, SW_HIDE);   // shown once the renderer reports where it goes
  }

  setBounds(r: Rect): void {
    this.bounds = r;
    this.apply();
  }

  reposition(): void {
    this.apply();
  }

  focus(): void {
    if (this.child) user32().focus(this.child);
  }

  ownsForeground(): boolean {
    const api = user32();
    const fg = api.foreground();
    if (fg === this.parent || (this.child && fg === this.child)) return true;
    return false;
  }

  detach(): void {
    this.child = 0;
    this.bounds = null;
  }

  private apply(): void {
    if (!this.child || !this.bounds) return;
    const api = user32();
    const scale = screen.getDisplayMatching(this.win.getBounds()).scaleFactor;
    const p = toPhysical(this.bounds, scale);
    const flags = SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW;
    if (this.mode === "child") {
      api.setPos(this.child, p.x, p.y, p.width, p.height, flags);
    } else {
      const origin = api.clientToScreen(this.parent, p.x, p.y);
      api.setPos(this.child, origin.x, origin.y, p.width, p.height, SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
    }
  }
}

export function createEmbedder(win: BrowserWindow, mode: EmbedMode): Embedder {
  return process.platform === "win32" ? new WinEmbedder(win, mode) : new NoopEmbedder();
}
