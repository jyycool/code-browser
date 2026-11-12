import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULTS, loadConfig, mergeConfig, parseProxy, proxyLabel } from "../src/main/config.js";

describe("mergeConfig", () => {
  it("keeps defaults for an empty object", () => {
    const { config, warnings } = mergeConfig(DEFAULTS, {});
    expect(config).toEqual(DEFAULTS);
    expect(warnings).toEqual([]);
  });

  it("takes known keys of the right type and trims strings", () => {
    const { config } = mergeConfig(DEFAULTS, {
      appName: "  我的浏览器 ", startUrl: "https://shop.example.com/", platform: "macos", showNavBar: false,
      newWindow: "block", embedMode: "follow", extraArgs: ["--lang=zh-CN"], maxWindow: { width: 2560, height: 1440 },
    });
    expect(config.appName).toBe("我的浏览器");
    expect(config.startUrl).toBe("https://shop.example.com/");
    expect(config.platform).toBe("macos");
    expect(config.showNavBar).toBe(false);
    expect(config.newWindow).toBe("block");
    expect(config.embedMode).toBe("follow");
    expect(config.extraArgs).toEqual(["--lang=zh-CN"]);
    expect(config.maxWindow).toEqual({ width: 2560, height: 1440 });
  });

  it("warns about and ignores bad values", () => {
    const { config, warnings } = mergeConfig(DEFAULTS, {
      platform: "beos", geoip: "yes", startUrl: "ftp://x", accent: "blue", fingerprint: "", newWindow: "tab",
      extraArgs: [1], maxWindow: { width: 100, height: 100 }, proxy: "gopher://h:1",
    });
    expect(config.platform).toBe(DEFAULTS.platform);
    expect(config.geoip).toBe(DEFAULTS.geoip);
    expect(config.startUrl).toBe(DEFAULTS.startUrl);
    expect(config.accent).toBe(DEFAULTS.accent);
    expect(config.fingerprint).toBe(DEFAULTS.fingerprint);
    expect(config.newWindow).toBe(DEFAULTS.newWindow);
    expect(config.extraArgs).toEqual([]);
    expect(config.maxWindow).toEqual(DEFAULTS.maxWindow);
    expect(config.proxy).toBe("");
    expect(warnings.length).toBe(9);
  });

  it("rejects a non-object", () => {
    expect(mergeConfig(DEFAULTS, [1, 2]).warnings.length).toBe(1);
  });

  it("does not share arrays with the defaults", () => {
    const { config } = mergeConfig(DEFAULTS, {});
    config.extraArgs.push("--x");
    expect(DEFAULTS.extraArgs).toEqual([]);
  });
});

describe("parseProxy / proxyLabel", () => {
  it("splits credentials out of the URL", () => {
    expect(parseProxy("socks5://u%40x:p%3Aw@1.2.3.4:1080")).toEqual({ server: "socks5://1.2.3.4:1080", username: "u@x", password: "p:w" });
    expect(parseProxy("http://proxy.local:8080")).toEqual({ server: "http://proxy.local:8080" });
  });

  it("rejects unsupported or incomplete specs", () => {
    expect(() => parseProxy("socks4://h:1")).toThrow();
    expect(() => parseProxy("http://h")).toThrow();
    expect(() => parseProxy("not a url")).toThrow();
  });

  it("never shows the password", () => {
    expect(proxyLabel("socks5://user:secret@1.2.3.4:1080")).toBe("socks5://user:***@1.2.3.4:1080");
    expect(proxyLabel("")).toBe("未使用");
    expect(proxyLabel("bad")).toBe("格式错误");
  });
});

describe("loadConfig", () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cb-cfg-"));

  it("creates config.json from the defaults on first run", () => {
    const dir = tmp();
    const defaults = path.join(dir, "defaults.json");
    fs.writeFileSync(defaults, JSON.stringify({ appName: "Shipped" }));
    const r = loadConfig(path.join(dir, "user"), defaults);
    expect(r.config.appName).toBe("Shipped");
    expect(JSON.parse(fs.readFileSync(r.file, "utf8")).appName).toBe("Shipped");
  });

  it("reads the user's file (with a BOM) over the defaults", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "config.json"), "﻿" + JSON.stringify({ startUrl: "https://a.example/" }));
    const r = loadConfig(dir, path.join(dir, "missing.json"));
    expect(r.config.startUrl).toBe("https://a.example/");
    expect(r.warnings).toEqual([]);
  });

  it("falls back to the defaults on broken JSON", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "config.json"), "{ nope");
    const r = loadConfig(dir, path.join(dir, "missing.json"));
    expect(r.config).toEqual(DEFAULTS);
    expect(r.warnings[0]).toMatch(/不是有效的 JSON/);
  });
});
