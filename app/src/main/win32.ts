// Native Win32 calls through koffi (no C++ addon to compile). Loaded only on Windows.
import { createRequire } from "node:module";

type Fn = (...args: unknown[]) => unknown;

export interface User32 {
  findWindowsOfProcess(pid: number): { hwnd: number; className: string; visible: boolean; area: number }[];
  getStyle(hwnd: number, index: number): number;
  setStyle(hwnd: number, index: number, value: number): void;
  setParent(child: number, parent: number): void;
  setPos(hwnd: number, x: number, y: number, w: number, h: number, flags: number): void;
  show(hwnd: number, cmd: number): void;
  focus(hwnd: number): void;
  clientToScreen(hwnd: number, x: number, y: number): { x: number; y: number };
  foreground(): number;
  processOf(hwnd: number): number;
  installKeyboardHook(onKey: (vk: number, isKeyDown: boolean) => boolean): () => void;
  keyDown(vk: number): boolean;
}

let cached: User32 | null = null;

export function user32(): User32 {
  if (cached) return cached;
  if (process.platform !== "win32") throw new Error("Win32 APIs are only available on Windows");
  const require = createRequire(import.meta.url);
  const koffi = require("koffi");
  const u = koffi.load("user32.dll");
  const k32 = koffi.load("kernel32.dll");

  const RECT = koffi.struct("RECT", { left: "long", top: "long", right: "long", bottom: "long" });
  const POINT = koffi.struct("POINT", { x: "long", y: "long" });
  const KBDLLHOOKSTRUCT = koffi.struct("KBDLLHOOKSTRUCT", {
    vkCode: "uint32_t", scanCode: "uint32_t", flags: "uint32_t", time: "uint32_t", dwExtraInfo: "uintptr_t",
  });
  const EnumWindowsProc = koffi.proto("bool __stdcall EnumWindowsProc(intptr_t hwnd, intptr_t lParam)");
  const LowLevelKeyboardProc = koffi.proto("intptr_t __stdcall LowLevelKeyboardProc(int nCode, uintptr_t wParam, KBDLLHOOKSTRUCT *lParam)");

  const EnumWindows: Fn = u.func("bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)");
  const GetWindowThreadProcessId: Fn = u.func("uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32_t *pid)");
  const IsWindowVisible: Fn = u.func("bool __stdcall IsWindowVisible(intptr_t hWnd)");
  const GetClassNameW: Fn = u.func("int __stdcall GetClassNameW(intptr_t hWnd, void *buf, int max)");
  const GetWindowRect: Fn = u.func("bool __stdcall GetWindowRect(intptr_t hWnd, _Out_ RECT *r)");
  const GetWindowLongPtrW: Fn = u.func("intptr_t __stdcall GetWindowLongPtrW(intptr_t hWnd, int index)");
  const SetWindowLongPtrW: Fn = u.func("intptr_t __stdcall SetWindowLongPtrW(intptr_t hWnd, int index, intptr_t value)");
  const SetParent: Fn = u.func("intptr_t __stdcall SetParent(intptr_t child, intptr_t parent)");
  const SetWindowPos: Fn = u.func("bool __stdcall SetWindowPos(intptr_t hWnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)");
  const ShowWindow: Fn = u.func("bool __stdcall ShowWindow(intptr_t hWnd, int cmd)");
  const SetFocus: Fn = u.func("intptr_t __stdcall SetFocus(intptr_t hWnd)");
  const ClientToScreen: Fn = u.func("bool __stdcall ClientToScreen(intptr_t hWnd, _Inout_ POINT *pt)");
  const GetForegroundWindow: Fn = u.func("intptr_t __stdcall GetForegroundWindow()");
  const GetAsyncKeyState: Fn = u.func("int16_t __stdcall GetAsyncKeyState(int vk)");
  const SetWindowsHookExW: Fn = u.func("intptr_t __stdcall SetWindowsHookExW(int id, LowLevelKeyboardProc *proc, intptr_t hmod, uint32_t threadId)");
  const CallNextHookEx: Fn = u.func("intptr_t __stdcall CallNextHookEx(intptr_t hhk, int nCode, uintptr_t wParam, void *lParam)");
  const UnhookWindowsHookEx: Fn = u.func("bool __stdcall UnhookWindowsHookEx(intptr_t hhk)");
  const GetModuleHandleW: Fn = k32.func("intptr_t __stdcall GetModuleHandleW(void *name)");

  const n = (v: unknown) => Number(v);

  cached = {
    findWindowsOfProcess(pid) {
      const found: { hwnd: number; className: string; visible: boolean; area: number }[] = [];
      EnumWindows((hwnd: unknown) => {
        const out = [0];
        GetWindowThreadProcessId(hwnd, out);
        if (out[0] === pid) {
          const buf = Buffer.alloc(512);
          const len = n(GetClassNameW(hwnd, buf, 256));
          const r = { left: 0, top: 0, right: 0, bottom: 0 };
          GetWindowRect(hwnd, r);
          found.push({
            hwnd: n(hwnd),
            className: buf.toString("utf16le", 0, len * 2),
            visible: Boolean(IsWindowVisible(hwnd)),
            area: Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top),
          });
        }
        return true;
      }, 0);
      return found;
    },
    getStyle: (hwnd, index) => n(GetWindowLongPtrW(hwnd, index)) >>> 0,
    setStyle: (hwnd, index, value) => { SetWindowLongPtrW(hwnd, index, value | 0); },
    setParent: (child, parent) => { SetParent(child, parent); },
    setPos: (hwnd, x, y, w, h, flags) => { SetWindowPos(hwnd, 0, x, y, w, h, flags); },
    show: (hwnd, cmd) => { ShowWindow(hwnd, cmd); },
    focus: (hwnd) => { SetFocus(hwnd); },
    clientToScreen(hwnd, x, y) {
      const p = { x, y };
      ClientToScreen(hwnd, p);
      return p;
    },
    foreground: () => n(GetForegroundWindow()),
    processOf(hwnd) {
      const out = [0];
      GetWindowThreadProcessId(hwnd, out);
      return out[0];
    },
    keyDown: (vk) => (n(GetAsyncKeyState(vk)) & 0x8000) !== 0,
    installKeyboardHook(onKey) {
      let hook = 0;
      const cb = koffi.register((nCode: number, wParam: number, lParam: unknown) => {
        if (nCode >= 0) {
          const info = koffi.decode(lParam, KBDLLHOOKSTRUCT) as { vkCode: number };
          const down = wParam === 0x0100 || wParam === 0x0104;   // WM_KEYDOWN / WM_SYSKEYDOWN
          if (onKey(info.vkCode, down)) return 1;               // swallow
        }
        return CallNextHookEx(hook, nCode, wParam, lParam);
      }, koffi.pointer(LowLevelKeyboardProc));
      hook = n(SetWindowsHookExW(13, cb, GetModuleHandleW(null), 0));
      return () => {
        if (hook) UnhookWindowsHookEx(hook);
        koffi.unregister(cb);
        hook = 0;
      };
    },
  };
  void POINT;
  return cached;
}
