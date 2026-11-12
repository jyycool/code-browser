// App configuration: defaults shipped with the app, overridden by the user's config.json.
// Settings are deliberately not editable in the UI; the config file is the only way to change them.
import fs from "node:fs";
import path from "node:path";

export type Platform = "windows" | "linux" | "macos" | "android";
export type NewWindowPolicy = "same-page" | "block";
export type EmbedMode = "child" | "follow";

export interface AppConfig {
  appName: string;
  tagline: string;
  accent: string;
  startUrl: string;
  fingerprint: string;
  platform: Platform;
  brand: string;
  proxy: string;
  geoip: boolean;
  timezone: string;
  acceptLanguage: string;
  executablePath: string;
  kernelSha256: string;
  extraArgs: string[];
  showNavBar: boolean;
  newWindow: NewWindowPolicy;
  embedMode: EmbedMode;
  blockShortcuts: boolean;
  writePolicies: boolean;
  maxWindow: { width: number; height: number };
}

export const DEFAULTS: AppConfig = {
  appName: "code-browser",
  tagline: "安全、独立的浏览环境",
  accent: "#2563EB",
  startUrl: "https://example.com",
  fingerprint: "user-0001",
  platform: "windows",
  brand: "Chrome",
  proxy: "",
  geoip: true,
  timezone: "",
  acceptLanguage: "",
  executablePath: "",
  kernelSha256: "",
  extraArgs: [],
  showNavBar: true,
  newWindow: "same-page",
  embedMode: "child",
  blockShortcuts: true,
  writePolicies: false,
  maxWindow: { width: 1920, height: 1080 },
};

const PLATFORMS: Platform[] = ["windows", "linux", "macos", "android"];

/** Merge a parsed user config over the defaults, keeping only known keys of the right type. */
export function mergeConfig(base: AppConfig, user: unknown): { config: AppConfig; warnings: string[] } {
  const warnings: string[] = [];
  const out: AppConfig = { ...base, extraArgs: [...base.extraArgs], maxWindow: { ...base.maxWindow } };
  if (user === null || typeof user !== "object" || Array.isArray(user)) {
    if (user !== undefined) warnings.push("配置文件不是一个 JSON 对象，已使用默认配置");
    return { config: out, warnings };
  }
  const u = user as Record<string, unknown>;
  const str = (k: keyof AppConfig) => {
    if (u[k] === undefined) return;
    if (typeof u[k] === "string") (out as unknown as Record<string, unknown>)[k] = (u[k] as string).trim();
    else warnings.push(`配置项 ${k} 应为字符串，已忽略`);
  };
  const bool = (k: keyof AppConfig) => {
    if (u[k] === undefined) return;
    if (typeof u[k] === "boolean") (out as unknown as Record<string, unknown>)[k] = u[k];
    else warnings.push(`配置项 ${k} 应为 true 或 false，已忽略`);
  };
  for (const k of ["appName", "tagline", "accent", "startUrl", "fingerprint", "brand", "proxy",
    "timezone", "acceptLanguage", "executablePath", "kernelSha256"] as const) str(k);
  for (const k of ["geoip", "showNavBar", "blockShortcuts", "writePolicies"] as const) bool(k);

  if (u.platform !== undefined) {
    if (PLATFORMS.includes(u.platform as Platform)) out.platform = u.platform as Platform;
    else warnings.push(`配置项 platform 只能是 ${PLATFORMS.join("、")}，已忽略`);
  }
  if (u.newWindow !== undefined) {
    if (u.newWindow === "same-page" || u.newWindow === "block") out.newWindow = u.newWindow;
    else warnings.push("配置项 newWindow 只能是 same-page 或 block，已忽略");
  }
  if (u.embedMode !== undefined) {
    if (u.embedMode === "child" || u.embedMode === "follow") out.embedMode = u.embedMode;
    else warnings.push("配置项 embedMode 只能是 child 或 follow，已忽略");
  }
  if (u.extraArgs !== undefined) {
    if (Array.isArray(u.extraArgs) && u.extraArgs.every((a) => typeof a === "string")) out.extraArgs = [...u.extraArgs];
    else warnings.push("配置项 extraArgs 应为字符串数组，已忽略");
  }
  if (u.maxWindow !== undefined) {
    const m = u.maxWindow as { width?: unknown; height?: unknown } | null;
    if (m && Number.isInteger(m.width) && Number.isInteger(m.height) && (m.width as number) >= 800 && (m.height as number) >= 600) {
      out.maxWindow = { width: m.width as number, height: m.height as number };
    } else warnings.push("配置项 maxWindow 应为 {width, height}（至少 800×600），已忽略");
  }
  if (!/^https?:\/\//i.test(out.startUrl)) {
    warnings.push("startUrl 必须以 http:// 或 https:// 开头，已改用默认网址");
    out.startUrl = base.startUrl;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(out.accent)) {
    warnings.push("accent 应为 #RRGGBB 颜色，已改用默认颜色");
    out.accent = base.accent;
  }
  if (!out.fingerprint) {
    warnings.push("fingerprint 不能为空，已改用默认种子");
    out.fingerprint = base.fingerprint;
  }
  if (out.proxy) {
    try { parseProxy(out.proxy); } catch (e) {
      warnings.push(`proxy 格式不正确（${(e as Error).message}），本次不使用代理`);
      out.proxy = "";
    }
  }
  return { config: out, warnings };
}

export interface ProxyOption { server: string; username?: string; password?: string }

/** "socks5://user:pass@host:1080" -> Playwright-style proxy object (credentials split out). */
export function parseProxy(spec: string): ProxyOption {
  let u: URL;
  try { u = new URL(spec); } catch { throw new Error("应为 scheme://[用户名:密码@]主机:端口"); }
  const scheme = u.protocol.replace(/:$/, "").toLowerCase();
  if (!["http", "https", "socks5"].includes(scheme)) throw new Error("只支持 http、https、socks5");
  if (!u.hostname || !u.port) throw new Error("缺少主机或端口");
  const out: ProxyOption = { server: `${scheme}://${u.hostname}:${u.port}` };
  if (u.username) out.username = decodeURIComponent(u.username);
  if (u.password) out.password = decodeURIComponent(u.password);
  return out;
}

/** Proxy shown on the home screen: never the password. */
export function proxyLabel(spec: string): string {
  if (!spec) return "未使用";
  try {
    const p = parseProxy(spec);
    return p.username ? p.server.replace("://", `://${p.username}:***@`) : p.server;
  } catch {
    return "格式错误";
  }
}

/**
 * Load the config: `<userData>/config.json` over the shipped defaults. On first run the defaults
 * are copied there so the user has a file to edit.
 */
export function loadConfig(userDataDir: string, defaultsFile: string): { config: AppConfig; file: string; warnings: string[] } {
  let base = DEFAULTS;
  const warnings: string[] = [];
  try {
    base = mergeConfig(DEFAULTS, JSON.parse(fs.readFileSync(defaultsFile, "utf8"))).config;
  } catch { /* the built-in defaults stand */ }
  const file = path.join(userDataDir, "config.json");
  if (!fs.existsSync(file)) {
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(base, null, 2) + "\n", "utf8");
    } catch (e) {
      warnings.push(`无法创建配置文件 ${file}：${(e as Error).message}`);
    }
    return { config: base, file, warnings };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    warnings.push(`配置文件 ${file} 不是有效的 JSON（${(e as Error).message}），已使用默认配置`);
    return { config: base, file, warnings };
  }
  const merged = mergeConfig(base, parsed);
  return { config: merged.config, file, warnings: [...warnings, ...merged.warnings] };
}
