// Optional Chromium enterprise policies (config "writePolicies": true), Windows only.
// They live in HKCU\Software\Policies\Chromium and therefore apply to EVERY Chromium-based
// browser of this Windows user, not just this app. That is why they are off by default; the
// CDP guard and the shortcut blocker already keep users away from internal pages.
import { execFile } from "node:child_process";

export const POLICY_KEY = "HKCU\\Software\\Policies\\Chromium";

export interface PolicyValue { key: string; name: string; type: "REG_DWORD" | "REG_SZ"; data: string }

export function policyValues(): PolicyValue[] {
  const dword = (name: string, v: number): PolicyValue => ({ key: POLICY_KEY, name, type: "REG_DWORD", data: String(v) });
  const blocklist = ["chrome://*", "chrome-untrusted://*", "devtools://*", "view-source:*", "file://*"];
  return [
    dword("DeveloperToolsAvailability", 2),   // DevTools off
    dword("IncognitoModeAvailability", 1),    // no incognito windows
    dword("BrowserGuestModeEnabled", 0),
    dword("BrowserAddPersonEnabled", 0),
    dword("PasswordManagerEnabled", 0),
    dword("PromptForDownloadLocation", 0),
    ...blocklist.map((url, i) => ({ key: `${POLICY_KEY}\\URLBlocklist`, name: String(i + 1), type: "REG_SZ" as const, data: url })),
  ];
}

/** `reg.exe` argument lists that write the policies. */
export function addCommands(values = policyValues()): string[][] {
  return values.map((v) => ["add", v.key, "/v", v.name, "/t", v.type, "/d", v.data, "/f"]);
}

/** `reg.exe` argument lists that remove exactly what addCommands() wrote. */
export function deleteCommands(values = policyValues()): string[][] {
  return values.map((v) => ["delete", v.key, "/v", v.name, "/f"]);
}

function reg(args: string[]): Promise<void> {
  return new Promise((resolve) => execFile("reg", args, { windowsHide: true }, () => resolve()));
}

export async function writePolicies(): Promise<void> {
  if (process.platform !== "win32") return;
  for (const a of addCommands()) await reg(a);
}

export async function removePolicies(): Promise<void> {
  if (process.platform !== "win32") return;
  for (const a of deleteCommands()) await reg(a);
}
