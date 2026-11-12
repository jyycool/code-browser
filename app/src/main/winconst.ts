// Pure Win32 helpers (no native calls), so they can be unit-tested on any OS.

export const GWL_STYLE = -16;
export const GWL_EXSTYLE = -20;
export const GWLP_HWNDPARENT = -8;

export const WS_CHILD = 0x40000000;
export const WS_POPUP = 0x80000000;
export const WS_VISIBLE = 0x10000000;
export const WS_CLIPCHILDREN = 0x02000000;
export const WS_CAPTION = 0x00c00000;
export const WS_THICKFRAME = 0x00040000;
export const WS_SYSMENU = 0x00080000;
export const WS_MINIMIZEBOX = 0x00020000;
export const WS_MAXIMIZEBOX = 0x00010000;

export const WS_EX_APPWINDOW = 0x00040000;
export const WS_EX_TOOLWINDOW = 0x00000080;

export const SWP_NOSIZE = 0x0001;
export const SWP_NOMOVE = 0x0002;
export const SWP_NOZORDER = 0x0004;
export const SWP_NOACTIVATE = 0x0010;
export const SWP_FRAMECHANGED = 0x0020;
export const SWP_SHOWWINDOW = 0x0040;

export const SW_HIDE = 0;
export const SW_SHOW = 5;

export const WH_KEYBOARD_LL = 13;
export const WM_KEYDOWN = 0x0100;
export const WM_SYSKEYDOWN = 0x0104;

const FRAME_BITS = WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;

/** Window style for a browser window turned into a child of the shell window. */
export function childStyle(style: number): number {
  return ((style & ~(FRAME_BITS | WS_POPUP)) | WS_CHILD | WS_VISIBLE) >>> 0;
}

/** Window style for a frameless, owned browser window that follows the shell ("follow" mode). */
export function followStyle(style: number): number {
  return ((style & ~(FRAME_BITS | WS_CHILD)) | WS_POPUP | WS_VISIBLE) >>> 0;
}

/** Extended style: never a taskbar button of its own. */
export function noTaskbarExStyle(exStyle: number): number {
  return ((exStyle & ~WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW) >>> 0;
}

export interface Rect { x: number; y: number; width: number; height: number }

/**
 * CSS px (renderer) -> physical px. Edges are rounded rather than sizes, so neighbouring areas
 * never leave a 1 px gap at fractional scale factors (125 %, 150 %).
 */
export function toPhysical(r: Rect, scale: number): Rect {
  const left = Math.round(r.x * scale);
  const top = Math.round(r.y * scale);
  const right = Math.round((r.x + r.width) * scale);
  const bottom = Math.round((r.y + r.height) * scale);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** Pick the engine's main window among a process's top-level windows. */
export function pickBrowserWindow(wins: { hwnd: number; className: string; visible: boolean; area: number }[]): number | null {
  const c = wins.filter((w) => w.visible && w.className === "Chrome_WidgetWin_1").sort((a, b) => b.area - a.area);
  return c.length ? c[0].hwnd : null;
}

/** HWND from Electron's getNativeWindowHandle() buffer. */
export function hwndFromBuffer(buf: Buffer): number {
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
}

// Virtual-key codes used by the shortcut blocker.
const VK = {
  F1: 0x70, F4: 0x73, F11: 0x7a, F12: 0x7b, DELETE: 0x2e, HOME: 0x24,
  A: 0x41, B: 0x42, C: 0x43, D: 0x44, E: 0x45, F: 0x46, H: 0x48, I: 0x49, J: 0x4a, M: 0x4d,
  N: 0x4e, O: 0x4f, S: 0x53, T: 0x54, U: 0x55, W: 0x57,
};

export interface KeyCombo { vk: number; ctrl: boolean; shift: boolean; alt: boolean }

/**
 * Browser shortcuts that would open browser UI (new windows or tabs, history, downloads,
 * DevTools, settings, the app menu) or close the embedded page. Find (Ctrl+F), copy/paste and
 * print stay available.
 */
export function isBlockedShortcut(k: KeyCombo): boolean {
  if (!k.ctrl && !k.alt && !k.shift && [VK.F1, VK.F11, VK.F12].includes(k.vk)) return true;
  if (k.alt && !k.ctrl && [VK.F, VK.E, VK.HOME].includes(k.vk)) return true;
  if (k.ctrl && !k.alt && !k.shift && [VK.T, VK.N, VK.W, VK.H, VK.J, VK.O, VK.S, VK.U, VK.D, VK.F4].includes(k.vk)) return true;
  if (k.ctrl && k.shift && !k.alt && [VK.N, VK.T, VK.W, VK.I, VK.J, VK.C, VK.B, VK.O, VK.M, VK.A, VK.DELETE].includes(k.vk)) return true;
  return false;
}
