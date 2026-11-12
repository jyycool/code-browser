// Swallows browser shortcuts (new window/tab, DevTools, history, …) while the shell is in front.
// Windows only: a low-level keyboard hook on the Electron main thread (it runs a message loop).
import { user32 } from "./win32.js";
import { isBlockedShortcut } from "./winconst.js";

const VK_SHIFT = 0x10;
const VK_CONTROL = 0x11;
const VK_MENU = 0x12;

export function startShortcutBlocker(isActive: () => boolean): () => void {
  if (process.platform !== "win32") return () => {};
  const api = user32();
  return api.installKeyboardHook((vk, down) => {
    if (!down || !isActive()) return false;
    return isBlockedShortcut({
      vk,
      ctrl: api.keyDown(VK_CONTROL),
      shift: api.keyDown(VK_SHIFT),
      alt: api.keyDown(VK_MENU),
    });
  });
}
