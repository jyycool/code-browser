<div align="center">

<img src="docs/assets/clyde.svg" alt="Clyde, the Clearcote chameleon" width="120" />

# Clearcote Browser

**Blend in. Stay clear.**

[![Release](https://img.shields.io/github/v/release/clearcotelabs/clearcote-browser?include_prereleases&label=release&style=flat-square&labelColor=07080a&color=38e0d6)](https://github.com/clearcotelabs/clearcote-browser/releases)
[![npm](https://img.shields.io/npm/v/clearcote?style=flat-square&logo=npm&logoColor=white&label=npm&labelColor=07080a&color=CB3837)](https://www.npmjs.com/package/clearcote)
[![PyPI](https://img.shields.io/pypi/v/clearcote?style=flat-square&logo=pypi&logoColor=white&label=pip&labelColor=07080a&color=3776AB)](https://pypi.org/project/clearcote/)
[![NuGet](https://img.shields.io/nuget/v/Clearcote?style=flat-square&logo=nuget&logoColor=white&label=nuget&labelColor=07080a&color=004880)](https://www.nuget.org/packages/Clearcote)
[![Docker](https://img.shields.io/docker/pulls/teamflatearth/clearcote?style=flat-square&logo=docker&logoColor=white&label=docker&labelColor=07080a&color=2496ED)](https://hub.docker.com/r/teamflatearth/clearcote)
[![License](https://img.shields.io/badge/license-BSD--3--Clause-38e0d6?style=flat-square&labelColor=07080a)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?style=flat-square&logo=discord&logoColor=white&labelColor=07080a)](https://discord.gg/WxvCjAnXZm)
[![llms.txt](https://img.shields.io/badge/for%20agents-llms.txt-24292f?style=flat-square&logo=readme&logoColor=white)](llms.txt)

### [Get the latest build free with GitHub →](https://www.clearcotelabs.com/pricing?utm_source=github&utm_medium=readme&utm_content=hero-cta#free)

[Website](https://www.clearcotelabs.com/?utm_source=github&utm_medium=readme&utm_content=hero-nav) · [Docs](https://www.clearcotelabs.com/docs?utm_source=github&utm_medium=readme&utm_content=hero-nav) · [Pricing](https://www.clearcotelabs.com/pricing?utm_source=github&utm_medium=readme&utm_content=hero-nav) · [Playground](https://www.clearcotelabs.com/dashboard/playground?utm_source=github&utm_medium=readme&utm_content=hero-nav) · [Discord](https://discord.gg/WxvCjAnXZm)

</div>

Clearcote is an open-source Chromium with its fingerprint controls compiled into the C++ engine. Each
browser presents one coherent machine: the JavaScript surface, the HTTP headers and the TLS handshake
all come from the same real Chromium, so they agree with each other. You drive it with the Playwright
or Puppeteer code you already have.

## Quickstart

```bash
pip install clearcote
```

```python
from clearcote import launch

browser = launch(fingerprint="user-7423")   # same seed -> same machine on every launch
page = browser.new_page()                   # a standard Playwright Browser from here on
page.goto("https://example.com")
browser.close()
```

The SDK downloads the browser on first use and checks its SHA-256. Node.js: `npm install clearcote`.
.NET: `dotnet add package Clearcote`. Docker, a CDP endpoint or hosted browsers: [choose how to run it](#choose-how-to-run-it).

To hear about new builds, click **Watch → Custom → Releases** at the top of this page.

## At a glance

| | |
|---|---|
| **What it is** | A Chromium distribution (based on ungoogled-chromium) plus a stack of readable source patches |
| **Works with** | Playwright, Puppeteer, and any tool that speaks the Chrome DevTools Protocol (CDP) |
| **SDKs** | Python, Node.js / TypeScript, .NET. `launch()` returns a standard Playwright `Browser` |
| **Runs on** | Windows x64, Linux x64, Docker. Or hosted on our servers, with nothing to install |
| **License** | BSD-3-Clause for the code and patches. The open build is reproducible from this repo |
| **Cost** | Open build: free. Latest build: free for one browser at a time with GitHub. Pro: $49/month. Hosted: €1 per GB |
| **Website** | [clearcotelabs.com](https://www.clearcotelabs.com/?utm_source=github&utm_medium=readme&utm_content=at-a-glance): docs, pricing, the dashboard and hosted browsers |
| **For AI agents** | [`llms.txt`](llms.txt) · [`AGENTS.md`](AGENTS.md) · an [MCP server](mcp/) |

---

## Choose how to run it

Pick the row that matches what you want to do, then jump to its section. Every path runs the same engine.

| I want to… | Use | Section |
|---|---|---|
| Use Clearcote from my own Playwright or Puppeteer code | The SDK | [Run it from your code](#run-it-from-your-code) |
| Attach a tool that already speaks CDP (browser-use, Crawl4AI, Stagehand, …) | A CDP endpoint | [Run it as a CDP endpoint](#run-it-as-a-cdp-endpoint) |
| Run it in a container | The Docker image | [Run it in Docker](#run-it-in-docker) |
| Run it without installing anything | Hosted browsers | [Run it in the cloud](#run-it-in-the-cloud) |
| Give an AI assistant (Claude, Cursor, Cline) a browser | The MCP server | [Give an AI assistant a browser](#give-an-ai-assistant-a-browser) |
| Describe a task in words and get JSON back | Agent runs | [Let an agent do the task](#let-an-agent-do-the-task) |
| Move code I already run on another tool | Usually one changed line | [Switch from another tool](#switch-from-another-tool) |

---

## Switch from another tool

Clearcote is a real Chromium that speaks CDP, so existing code usually moves over by changing the one
line that starts or finds the browser. The code after that line stays the same.

**From Playwright.** `launch()` returns the same Playwright `Browser`, so only the launch call changes:

```diff
- from playwright.sync_api import sync_playwright
- browser = sync_playwright().start().chromium.launch()
+ from clearcote import launch
+ browser = launch(fingerprint="user-7423")
```

```diff
- import { chromium } from "playwright";
- const browser = await chromium.launch();
+ import { launch } from "clearcote";
+ const browser = await launch({ fingerprint: "user-7423" });
```

<details>
<summary><b>From a CDP tool (browser-use, Crawl4AI, Stagehand, …), a hosted browser service, a stealth plugin, a closed anti-detect browser, or Selenium</b></summary>

**From a tool that connects over CDP.** Start Clearcote as an endpoint (`clearcote-serve --port 9222`,
the [Docker image](#run-it-in-docker) or `serve()`), then point the tool at it:

| Tool | The line that changes |
|---|---|
| Playwright (Python / Node) | `chromium.connect_over_cdp("http://127.0.0.1:9222")` / `chromium.connectOverCDP(...)` |
| Puppeteer | `puppeteer.connect({ browserURL: "http://127.0.0.1:9222" })` |
| browser-use | `Browser(cdp_url="http://127.0.0.1:9222")` |
| Crawl4AI | `BrowserConfig(browser_mode="cdp", cdp_url="http://127.0.0.1:9222")` |
| nodriver | `uc.start(host="127.0.0.1", port=9222)` |
| Playwright MCP | `npx @playwright/mcp --cdp-endpoint http://127.0.0.1:9222` |
| Stagehand 4 | `localBrowser.connect({ cdpUrl: "http://127.0.0.1:9222" })`, then `Stagehand.create({ browser })`. Needs two launch options, below |
| Any other CDP client | The `webSocketDebuggerUrl` from `http://127.0.0.1:9222/json/version` |

Stagehand 4 runs its own extension inside the browser, so the endpoint needs the two switches that
Stagehand's own launcher adds. Keep the port on `127.0.0.1`:

```javascript
import { serve } from "clearcote";
import { Stagehand, localBrowser } from "@browserbasehq/stagehand";

const srv = await serve({
  fingerprint: "user-7423",
  allowOrigins: "*",                               // Stagehand's extension connects back to the endpoint
  args: ["--enable-unsafe-extension-debugging"],   // lets Stagehand load that extension over CDP
});
const stagehand = await Stagehand.create({ browser: await localBrowser.connect({ cdpUrl: srv.cdpUrl }) });
```

Each row was run against a Clearcote endpoint on 6 October 2026 (Playwright 1.63, Puppeteer 25,
browser-use 0.13, Crawl4AI 0.9, nodriver 0.50, Playwright MCP 0.0.83, Stagehand 4.1).

**From a hosted browser service.** If your provider gives you a CDP WebSocket URL, use the `connectUrl`
of a Clearcote cloud session instead. Your connect call does not change. See [Run it in the cloud](#run-it-in-the-cloud).

**From a stealth plugin.** Remove `puppeteer-extra-plugin-stealth`, `playwright-stealth` and similar
plugins. The persona is set in the engine, and script patches on top of it conflict with it.

**From a closed anti-detect browser.** These usually start a profile through a local API and give your
script a CDP address. Replace that call with `serve(fingerprint="profile-name")` or `launch(...)`. The
same seed returns the same machine every time; give `serve()` a `user_data_dir` to keep cookies and storage
as well, or use the [Profile Manager](https://github.com/clearcotelabs/clearcote-profile-manager) desktop app.

**From Selenium or WebDriver.** This is the exception. Clearcote is driven over CDP, so those scripts need
porting to Playwright, Puppeteer or nodriver.

</details>

Side-by-side comparisons with other tools: [clearcotelabs.com/alternatives](https://www.clearcotelabs.com/alternatives?utm_source=github&utm_medium=readme&utm_content=switch-from-another-tool).

---

## Run it from your code

Install the SDK. It downloads the right Clearcote binary for your OS on first use, checks its SHA-256,
and caches it. You do not need `playwright install`.

```bash
pip install clearcote          # Python
npm install clearcote          # Node.js / TypeScript
dotnet add package Clearcote   # .NET
```

**Python**

```python
from clearcote import launch          # asyncio: from clearcote.async_api import launch

browser = launch(
    fingerprint="user-7423",          # same seed -> same machine every launch; new seed -> a new, unlinked one
    platform="windows",               # "windows" | "linux" | "macos" | "android"
    timezone="America/New_York",
)
page = browser.new_page()             # a standard Playwright Browser from here on
page.goto("https://example.com")
browser.close()
```

**Node.js / TypeScript**

```javascript
import { launch } from "clearcote";

const browser = await launch({
  fingerprint: "user-7423",
  platform: "windows",
  brand: "Edge",                      // "Chrome" (default) | "Edge" | "Opera" | "Vivaldi"
  timezone: "America/New_York",
});
const page = await browser.newPage();
await page.goto("https://example.com");
await browser.close();
```

**.NET**

```csharp
using Clearcote;

var browser = await Clearcote.Clearcote.LaunchAsync(new LaunchOptions {
    Fingerprint = "user-7423", Platform = "windows", Timezone = "America/New_York",
});
var page = await browser.NewPageAsync();   // a standard Microsoft.Playwright IBrowser
await page.GotoAsync("https://example.com");
await browser.CloseAsync();
```

### Common options

| Option (Python / Node) | What it does |
|---|---|
| `fingerprint` | The seed. One seed is one machine: hardware, screen, GPU and per-site render noise derive from it. Fonts and language do not: every seed on one machine shows the same font list (limited to fonts common on the platform it presents), and the language comes from `accept_language` / `acceptLanguage`, `geoip` or the `en-US` default |
| `platform` | The operating system the browser presents: `windows`, `linux`, `macos` or `android` |
| `brand` | The browser brand in the user agent and client hints: `Chrome`, `Edge`, `Opera`, `Vivaldi` |
| `proxy` | `{"server": "http://host:8080", "username": "u", "password": "p"}`. HTTP and SOCKS5 with a username and password both work |
| `geoip` / `geoip` | `True` matches the timezone, languages and `Accept-Language` to the proxy's exit location (and the WebRTC IP, on the licensed build) |
| `humanize` / `humanize` | Moves, clicks, drags, scrolls and types as native, trusted input with human-like paths |
| `light_stealth` / `lightStealth` | Changes only hardware metadata (cores, memory, screen depth, pixel ratio, touch) and leaves rendering real |
| `fingerprint_profile` / `fingerprintProfile` | Loads a real machine captured with the [collector](tools/fingerprint-collect) or from the [profile library](https://github.com/clearcotelabs/clearcote-profiles). Use it instead of `fingerprint`, not with it: a seed next to a profile adds canvas noise that strict checkers score as tampering |
| `version` / `version` | Picks a Chromium major, for example `"150"`. Leave it out for the newest build your tier allows |

Anything else is passed straight to Playwright (`headless`, `args`, `timeout`, …). Full lists:
[Python](sdk/python/README.md#fingerprint-options) · [Node](sdk/node/README.md#fingerprint-options) · [.NET](sdk/dotnet).

### Using a plain binary instead of the SDK

Download a signed build from [Releases](https://github.com/clearcotelabs/clearcote-browser/releases), unzip it,
and point stock Playwright (or any CDP client) at it with `--fingerprint` switches:

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=r"C:\clearcote\chrome.exe",
        args=["--fingerprint=seed-123", "--fingerprint-platform=windows"],
    )
    page = browser.new_page()
    page.goto("https://example.com")
    browser.close()
```

---

## Run it as a CDP endpoint

`serve()` starts Clearcote directly (not through Playwright), so no automation flag is added and
`navigator.webdriver` stays `false`. Anything that can connect over CDP attaches to it unchanged.

```bash
clearcote-serve --port 9222 --fingerprint seed-123 --platform windows   # prints http://127.0.0.1:9222
```

```python
from clearcote import serve
from playwright.sync_api import sync_playwright

with serve(fingerprint="seed-123", platform="windows") as srv:          # binds 127.0.0.1
    browser = sync_playwright().start().chromium.connect_over_cdp(srv.cdp_url)
```

Need several identities behind one port? `clearcote serve --port 9222` starts one browser per identity,
chosen in the connection URL (`http://127.0.0.1:9222?fingerprint=acct-1&timezone=Europe/Berlin`).
See [many identities on one endpoint](sdk/python/README.md#many-identities-on-one-endpoint-serve_multiplex-clearcote-serve).

---

## Run it in Docker

The official image is a Clearcote browser exposed as a CDP endpoint on port 9222.

```bash
# the seccomp profile that lets Chrome keep its sandbox (it ships in the image)
docker run --rm --tmpfs /opt/xdg-cache --entrypoint cat teamflatearth/clearcote /etc/clearcote/seccomp.json > clearcote-seccomp.json
docker run -d --rm -v clearcote-cache:/opt/xdg-cache --shm-size=1g -p 127.0.0.1:9222:9222 \
  --security-opt seccomp=clearcote-seccomp.json teamflatearth/clearcote
```

`-v clearcote-cache:/opt/xdg-cache` keeps the engine in a named volume. Keep it on every run: with a licence key,
a container started without it downloads the licensed engine (about 164 MB) again, and each of those downloads
counts against your key's download limit.

Without `--security-opt` it still runs, with Chrome's sandbox off. In Windows PowerShell, copy the profile out
with `docker cp` instead of `>`: see [Pull & run](docker/README.md#pull--run) and [Chrome's sandbox](docker/README.md#chromes-sandbox).

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp("http://localhost:9222")
    page = browser.new_page()
    page.goto("https://example.com")
    print(page.title())
```

Set the persona with environment variables: `CC_PLATFORM` (`windows`, `linux`, `macos`, `android`),
`CC_FINGERPRINT` (the seed; unset, each container gets its own random one), `CC_BRAND`, `CC_TIMEZONE`,
`CC_ACCEPT_LANGUAGE`, `CC_TLS_PROFILE`.

```bash
docker run -d --rm -v clearcote-cache:/opt/xdg-cache --shm-size=1g -p 127.0.0.1:9222:9222 \
  --security-opt seccomp=clearcote-seccomp.json \
  -e CC_PLATFORM=windows -e CC_FINGERPRINT=user-7423 teamflatearth/clearcote
```

The CDP port gives full control of the browser. Publish it on `127.0.0.1` or a trusted network only.
The image bakes in the signed Linux binary and the fonts a Windows persona needs.
WebRTC reports the proxy's exit (or, without a proxy, the container's own public address), looked up at start: see
[Networking and WebRTC](docker/README.md#networking-and-webrtc).
Details: [`docker/README.md`](docker/README.md) · [deployment guide](https://www.clearcotelabs.com/docs/deployment?utm_source=github&utm_medium=readme&utm_content=run-it-in-docker).

---

## Run it in the cloud

Hosted Clearcote browsers run on our servers. One API call starts one and returns a CDP WebSocket URL,
and your Playwright or Puppeteer code connects to it the same way it connects to a local browser.

```python
from clearcote import launch

browser = launch(cloud=True, country="us", identity="acct-1")   # needs CLEARCOTE_API_KEY=cc_live_...
page = browser.new_page()
page.goto("https://example.com")
browser.close()                                                 # ends the hosted session
```

Setting `CLEARCOTE_CLOUD=1` moves existing `launch()` code to the cloud without editing it. Without the SDK:

```javascript
import { chromium } from "playwright";

const res = await fetch("https://www.clearcotelabs.com/api/v1/browsers", {
  method: "POST",
  headers: { authorization: "Bearer cc_live_...", "content-type": "application/json" },
  body: JSON.stringify({ identity: "acct-1", country: "us" }),
});
const { connectUrl } = await res.json();
const browser = await chromium.connectOverCDP(connectUrl);
```

- **A residential IP is included.** Pick a `country`, `state` or `city`, or leave it to us.
- **The same `identity` label returns the same device on the same exit IP** in later sessions.
- **€1 per GB of traffic, and nothing else**: no plan, no hourly charge, no separate proxy bill. Prepaid from €5; `maxGb` caps a session.
- **Dedicated physical servers**, not shared cloud virtual machines.
- **The dashboard [Playground](https://www.clearcotelabs.com/dashboard/playground?utm_source=github&utm_medium=readme&utm_content=run-it-in-the-cloud)** runs a task or a script in a cloud browser and shows the live view, every step and the result.

New accounts that sign in with a GitHub account at least 30 days old get a one-time welcome credit.
API keys: [dashboard](https://www.clearcotelabs.com/dashboard/api-keys?utm_source=github&utm_medium=readme&utm_content=run-it-in-the-cloud) · Docs: [hosted browsers](https://www.clearcotelabs.com/docs/hosted-browsers?utm_source=github&utm_medium=readme&utm_content=run-it-in-the-cloud) · Site status: [Clearcote Tracker](https://github.com/clearcotelabs/clearcote-tracker).

---

## Give an AI assistant a browser

The [MCP server](mcp/) gives Claude Desktop, Cursor, Cline or any MCP client one shared Clearcote browser
and about 20 tools (`read_page`, `click`, `fill_field`, `screenshot`, `save_profile`, `get_cdp_endpoint`, …).

```json
{
  "mcpServers": {
    "clearcote": {
      "command": "npx",
      "args": ["-y", "clearcote-mcp"],
      "env": { "CLEARCOTE_FINGERPRINT": "acct-1", "CLEARCOTE_PLATFORM": "windows" }
    }
  }
}
```

Python users can run `pip install clearcote-mcp` and `clearcote-mcp` instead of `npx`.

---

## Let an agent do the task

**In the cloud.** Send a task in plain words; an agent works through it in a hosted browser and returns
JSON that matches your schema. Secrets are referred to as `{{name}}` and never reach the model.

```python
from clearcote.cloud import Cloud

run = Cloud().runs.create(
    "Return the three newest posts with their title and link",
    url="https://news.ycombinator.com/newest",
    schema={"type": "array", "items": {"type": "object", "properties": {"title": {"type": "string"}, "link": {"type": "string"}}}},
)
print(run["status"], run["result"]["output"])
```

Runs can pause and hand the browser to a person, be recorded, and report to a webhook.
Reference: [agent runs](https://www.clearcotelabs.com/docs/runs?utm_source=github&utm_medium=readme&utm_content=let-an-agent-do-the-task).

**On your machine.** The SDK also ships an in-browser agent that uses Chrome's own Actor framework and
any model on [OpenRouter](https://openrouter.ai) or another OpenAI-compatible endpoint:
[`launch_agent` / `run_agent_task`](sdk/python/README.md#ai-agent-openrouter).

---

## How it works

**The controls live in the engine, not in the page.** Most stealth tools change the fingerprint from
JavaScript: they replace `navigator.webdriver`, the WebGL vendor or `navigator.plugins` with script.
A replaced function can be told apart from a native one, for example:

- `Function.prototype.toString` shows its source instead of `[native code]`;
- its property descriptor and `hasOwnProperty` differ from a native getter's;
- a clean `toString` taken from a new iframe or Web Worker still sees the replacement.

In Clearcote the getter behind `navigator.vendor` is the C++ getter, so it is native code in every frame
and worker. There is no replacement to find.

**One seed, one coherent machine.** A `fingerprint` seed sets the hardware, screen and GPU together,
plus per-site canvas and WebGL noise, so the values agree with each other. Fonts, languages, timezone and
audio do not come from the seed: fonts are the platform's common fonts, languages and timezone come from
your options or `geoip`, and audio samples are left as Chromium computes them. Because the page's
JavaScript and the network stack come from one real Chromium, the user agent, client-hint headers, TLS
handshake and HTTP/2 settings agree too.

**What you can control**

- **Identity:** user agent and client hints (brand, platform, version, architecture), the same in JavaScript and in `Sec-CH-UA` headers.
- **GPU:** WebGL vendor, renderer, `getParameter` limits and extensions, plus WebGPU limits that match the same GPU.
- **Rendering:** per-site canvas and WebGL noise from the seed, or switched off; an optional [real-GPU canvas bridge](docs/CANVAS-BRIDGE.md).
- **Audio:** `AudioContext` reports the persona's sample rate and latency instead of the host's. Audio samples (`getChannelData`, `copyFromChannel`, offline rendering) get no noise and are the same on every seed: they match stock Chrome on the same machine, and noise would give values no real Chrome produces.
- **Fonts:** the persona's operating-system fonts with the right widths, including on a Linux server.
- **Hardware and screen:** cores, memory, storage quota, screen size, colour depth, pixel ratio, `getScreenDetails()`, touch points.
- **Locale and network:** timezone, languages, `Accept-Language`, `Intl` locale, geolocation, and a TLS and HTTP/2 shape that matches the claimed Chrome version. The licensed build also reports a coherent WebRTC IP.
- **Long tail:** speech voices, media codecs, media devices, CSS media queries, battery, network information, keyboard layout.
- **Input:** human-like, trusted mouse and keyboard input that keeps `navigator.webdriver` `false` (synthetic paths in the open build, recorded human paths in the licensed build).

The patches that ship: [patches/](patches/) · the design plan they were built from, which also lists surfaces that were never built: [docs/PATCHES.md](docs/PATCHES.md) · the release gate that checks them: [docs/STEALTH-COHERENCE.md](docs/STEALTH-COHERENCE.md).

---

## 指纹修改详情（中文）

> 独立文档版本：[docs/zh/FINGERPRINT.md](docs/zh/FINGERPRINT.md)

本节汇总 Clearcote 内核（Chromium `151.0.7922.108`，见 [`UPSTREAM_REVISION`](UPSTREAM_REVISION)）
相对上游 Chromium / ungoogled-chromium **实际改过的指纹能力**，以及对应的命令行开关。
每一项都能在 [`patches/`](patches/) 里找到对应补丁，逐补丁说明见 [`patches/README.md`](patches/README.md)。

规则（`977-persona-active-predicate`）：

| 启动方式 | 结果 |
|---|---|
| 不传 `--fingerprint` / `--fingerprint-profile` | 用宿主机真实值（单项覆盖开关仍然生效） |
| `--fingerprint=<种子>` | 由种子生成一整套**自洽画像**（persona），并按站点加噪 |
| `--fingerprint-profile=<档案>` | 呈现导入的真机档案，**不加噪**；档案缺的字段由种子补齐 |

单项开关的优先级统一为：**开关 > 画像 > 真机**。

---

<details>
<summary><b>展开全部 14 节：每个指纹面、对应开关与补丁</b></summary>

### 1. 种子与画像模型

Clearcote 不是给每个 API 单独随机，而是用一个种子推导出一台"完整的机器"，让各个接口彼此对得上。

- **`--fingerprint=<种子>`**：数字或任意字符串（字符串会被哈希成数字，不会崩溃）。
  同一个种子每次启动得到同一台机器；换一个种子就是一台新的、无法关联的机器。
- **按站点加噪**（`001-farble-seed-core`）：噪声种子 = 全局种子 × 站点 eTLD+1。
  同一站点在会话内稳定，不同站点之间的噪声互不相关，无法跨站串联。
- **画像引擎**（`002-persona-profile`）：按真实设备分布加权抽取平台、GPU、屏幕、字体、语言、
  内存、核数等，保证它们之间自洽（例如 Windows 画像 → D3D11 GPU 串 → Segoe UI 字体 → Windows 语音）。
- **`--fingerprint-schema=2`**（`980` / `981`）：第 2 版画像。屏幕和 GPU 档次跟硬件档次挂钩，
  `jsHeapSizeLimit` 按画像内存计算；触摸、色域、`navigator.connection`、音频采样率按实测比例抽取。
  默认是第 1 版，已有种子的结果不变。
- **自检**：`--clearcote-validate-persona=<N|a,b,c|current>` 生成画像并检查跨接口一致性，
  打印报告后退出（0 = 无矛盾，3 = 有矛盾）（`974`）。

---

### 2. 渲染噪声（Canvas / WebGL / Audio）

| 面 | 改动 | 补丁 |
|---|---|---|
| Canvas 2D | `toDataURL` / `toBlob` / `getImageData` / `measureText` 按站点加噪；所有导出路径读到的像素一致（含局部读取），纯色区域按位置加噪 | `060` |
| WebGL | `readPixels` 及 WebGL canvas 快照加噪 | `070` |
| Audio | 采样数据**不加噪**（`getChannelData`、`copyFromChannel`、离线渲染与原生 Chrome 一致）；只有 `sampleRate` / `baseLatency` / `outputLatency` 来自画像 | `020` |
| ClientRects | **不加噪**，原样上报 | `050` |

为什么 ClientRects 和音频采样不加噪：

- ClientRects 是字体、DPR、视口共同计算出来的**结果**，单独扰动只会制造矛盾
  （例如 `getClientRects()` 与 `getBoundingClientRect()` 对不上），所以继承自上游的 rects 噪声被删除了。
- 音频加噪会产生真实 Chrome 不可能输出的数值；离线渲染的采样率也不做扰动，因为 44099.99 这种非标准值本身就是破绽。

关闭噪声的开关：

| 开关 | 作用 |
|---|---|
| `--disable-fingerprint-noise` | 关闭全部按站点噪声（Canvas / WebGL 等），画像身份仍保留 |
| `--cc-no-farble` | 同上：保留整个画像（UA、屏幕、GPU、TLS），只关噪声（`220`） |
| `--disable-canvas-noise` | 只关 Canvas 2D 读回噪声，WebGL 等其它面不变 |

> 提示：部分检测服务会把渲染噪声识别为"篡改"。如果更在意"看起来像未修改的浏览器"，
> 可以关掉噪声只保留画像，或改用 `--fingerprint-profile` 导入真机档案（不加噪）。

---

### 3. Navigator / UA / UA-CH / 硬件

| 开关 | 改什么 | 补丁 |
|---|---|---|
| `--fingerprint-platform=` | `navigator.platform`、UA 与 UA-CH platform：`windows` / `macos` / `linux` / `android`（不区分大小写） | `002` `010` |
| `--fingerprint-platform-version=` | UA-CH `platformVersion` | `010` |
| `--fingerprint-brand=` | UA-CH 品牌：`chrome` / `edge` / `opera` / `vivaldi` | `010` |
| `--fingerprint-brand-version=` | 品牌完整版本号（`fullVersionList`）；`chrome` 时决定 Chromium 版本 | `010` |
| `--fingerprint-hardware-concurrency=` | `navigator.hardwareConcurrency` | `030` |
| `--fingerprint-device-memory=` | `navigator.deviceMemory` 与 `Device-Memory` 请求头（同一个数，按 Chrome 的 2 的幂取整） | `030` |
| `--fingerprint-storage-quota=` | `navigator.storage.estimate()` 配额 | `145` |

默认行为（传了种子、不传单项开关）：

- UA / UA-CH 版本从真实 Chromium 151 稳定版版本池中按种子挑选；`bitness=64`、`wow64=false`、`model=""`。
- `navigator.webdriver` 为 `false`，自动化与 Headless 特征被移除（`010`、`110`、`120`）。
- `performance.memory.jsHeapSizeLimit` 取真实桌面值，不随宿主内存变化（`146`）。

---

### 4. 屏幕 / DPR / 指针

| 开关 | 改什么 |
|---|---|
| `--fingerprint-screen-width=` / `--fingerprint-screen-height=` | `screen.width/height`（CSS 逻辑像素） |
| `--fingerprint-avail-width=` / `--fingerprint-avail-height=` | `screen.availWidth/availHeight` |
| `--fingerprint-color-depth=` | `screen.colorDepth` / `pixelDepth` |
| `--fingerprint-device-pixel-ratio=` | `devicePixelRatio` |
| `--fingerprint-max-touch-points=` | `navigator.maxTouchPoints`，并影响 `(pointer)` / `(hover)` 媒体查询 |

DPR 会同步到所有相关位置（`961` / `962`）：`Sec-CH-DPR` 请求头、CSS `resolution` 媒体查询、
`srcset` 与 `image-set()` 的选择，以及指针事件的屏幕坐标。

**屏幕尺寸和 DPR 要成对设置。** 检测站看到的"物理分辨率"= `screen.width × devicePixelRatio`，
只改其一会算出不存在的分辨率。不传时两者都由画像生成，天然成对。

其它屏幕相关的一致性（无需开关，传种子即生效）：

- `getScreenDetails()` 多屏信息、`window.outer*`、`screenX/Y` 来自画像，不暴露真实显示器（`140`）。
- `outerWidth/outerHeight` 使用真实窗口边框，与指针坐标一致（`972`）；初始窗口不超过画像屏幕的工作区（`975`）。
- CSS `@media` 的 `device-width/height`、`resolution`、色深、`color-gamut` 跟随画像（`141`）。
- 桌面画像有触摸点时，主指针仍是鼠标（触屏笔记本）；只有移动端画像才是粗指针（`142`）。

---

### 5. GPU / WebGL / WebGPU

| 开关 | 改什么 |
|---|---|
| `--fingerprint-gpu-vendor=` | WebGL `UNMASKED_VENDOR_WEBGL` |
| `--fingerprint-gpu-renderer=` | WebGL `UNMASKED_RENDERER_WEBGL` |
| `--fingerprint-webgpu-vendor=` / `-architecture=` / `-device=` / `-description=` | WebGPU `GPUAdapterInfo` |
| `--disable-gpu-string-spoof` | **只**改回真实的 vendor/renderer 字符串，参数表和扩展仍用画像 |
| `--disable-gpu-fingerprint` | 整个 WebGL/WebGPU 回到宿主真实 GPU（字符串、参数表、扩展、读回都不改） |
| `--fingerprint-gpu-backend-real` | 声明宿主有真实 GPU 后端；第 2 版画像据此才会使用独显档次 |

画像 GPU 在整个会话内固定（所有站点看到同一块 GPU），并且以下各面全部对齐到这块 GPU：

- WebGL1/WebGL2 `getParameter` 完整参数表、`getSupportedExtensions`（两种上下文各自的列表）、
  `getShaderPrecisionFormat`、模板掩码（`070` `071` `955` `968` `985`）。
- WebGPU：`requestAdapter()` 的 vendor/architecture（按型号）、`limits`（不超过真实适配器能力）、
  `features`（与真实适配器取交集）、`getPreferredCanvasFormat()`（`075` `967` `970` `982` `983`）。
- `MediaCapabilities.decodingInfo()` 的硬解能力矩阵（`147`）。
- Windows 画像跑在非 D3D 宿主上时：不暴露 D3D11 不可能有的 ASTC/ETC 扩展（`969`）；
  可选环境变量 `CLEARCOTE_SHADER_DIALECT=hlsl` 让 `WEBGL_debug_shaders` 报 HLSL（`966`）。

**vendor 与 renderer 必须是同一块真实 GPU 的成套字符串。** 乱配，或者移动端 UA 配桌面独显，都会被判为篡改。
不确定时不要手填，让画像生成。

---

### 6. 字体 / 语音 / 数学函数

| 面 | 行为 | 补丁 |
|---|---|---|
| 字体 | 只暴露画像的字体集：默认是按真实 Windows 安装建模的约 300 个字体族，或导入档案的 `fonts.detected`；Linux 宿主上用 231 个度量兼容的替代字体 | `040` |
| `system-ui` | Windows 画像下解析为 Segoe UI | `971` |
| 语音 | `speechSynthesis.getVoices()` 返回画像语音：默认 Windows SAPI 的 en-US David / Zira / Mark，或档案中的 `speech[]`；不会为空 | `170` |
| `Math.tanh` | Windows 画像在任何宿主上都返回与 Windows 逐位相同的结果 | `965` |

macOS 画像另有 3 个字体补丁，见 [`patches/macos-150/`](patches/macos-150/) 与 [`docs/MACOS-FONTS.md`](docs/MACOS-FONTS.md)。

---

### 7. 时区 / 语言 / 地理位置

| 开关 | 改什么 | 补丁 |
|---|---|---|
| `--timezone=` | JS `Intl` / `Date` 的 IANA 时区（如 `America/New_York`） | `090` |
| `--lang=` | UI 语言、`navigator.language`、`Intl` 默认 locale | Chromium 原生 + `092` |
| `--accept-lang=` | `Accept-Language` 请求头与 `navigator.languages`（Chromium 原生） | |
| `--fingerprint-location=纬度,经度` | `navigator.geolocation` 直接返回该坐标（精度 100 m） | `180` |

渲染进程的 ICU/`Intl` 默认 locale 跟随画像语言（`092`），所以 `Intl.DateTimeFormat`、
`toLocaleString` 与 `navigator.language` 一致；语音默认语言也跟随画像，不会漏出宿主语言。

**时区、语言、地理位置应与出口 IP 所在地一致**，最好在启动前按代理出口 IP 查好再填。
这些开关在启动时读取，运行中改不了，需要重启进程。

---

### 8. 网络：WebRTC / 代理 / TLS

| 开关 | 作用 | 补丁 |
|---|---|---|
| `--webrtc-ip=<IP>` | 伪造 srflx 候选为该 IP（填代理出口 IP），**不发送真实 STUN**，屏蔽 host 候选，真实内网/公网 IP 不泄露 | `100` |
| `--proxy-server=` | Chromium 原生代理（HTTP / HTTPS / SOCKS5） | |
| `--proxy-auth=用户名:密码` | 引擎自己应答 HTTP/HTTPS 代理认证（Basic、Digest），不需要 CDP 拦截 | `978` |
| `--socks5-credentials=用户名:密码` | SOCKS5 用户名密码认证（RFC 1929） | `963` `984` |
| `--socks5-udp` | 通过 SOCKS5 UDP ASSOCIATE 转发 WebRTC 等 UDP 流量 | `973` |
| `--fingerprint-tls-profile=chrome-<主版本>` | 让 TLS ClientHello 中随版本变化的字段（后量子密钥交换组、ALPS 码点）与画像的 Chromium 主版本一致；`off` / `native` / 不传 = 原样 | `210` |

**带认证的住宅代理可以直接在引擎里用，不需要本地无认证 SOCKS5 中转桥。**

TLS 画像只调整随版本变化的字段，密码套件列表、版本范围、签名算法和扩展顺序随机化都保持真实 Chrome 的行为。

---

### 9. 其它设备接口（传种子即生效）

| 接口 | 画像值 | 补丁 |
|---|---|---|
| `navigator.getBattery()` | 桌面插电：充电中、100%；getter 与 `chargingchange` / `levelchange` 事件一致 | `150` `979` |
| `navigator.connection` | 住宅 4g（第 2 版画像按实测比例抽取 rtt / downlink） | `150` `981` |
| `navigator.keyboard.getLayoutMap()` | US-QWERTY | `150` |
| `enumerateDevices()` | 真实 Windows 板载声卡的麦克风/扬声器组合，`deviceId` / `groupId` 由种子决定，授权前 label 为空 | `148` |
| `navigator.share` / `canShare` | Windows 画像下存在 | `160` |
| `new URL("C:/").protocol` | `"file:"`（Windows 行为） | `160` |

---

### 10. 导入真机档案

```
--fingerprint-profile=<gzip 压缩后再 base64 编码的 JSON>
```

用 [`tools/fingerprint-collect`](tools/fingerprint-collect/) 在一台真机上采集，或从公开数据集转换。
档案会驱动 GPU（字符串、完整 `getParameter` 表、扩展、WebGPU）、屏幕、字体、语音、音频、Chrome 版本、
CSS `@media`、触摸点、编解码能力和媒体设备列表。档案里没有的字段由 `--fingerprint` 种子补齐，所以不完整的档案也能保持自洽。
导入档案时**不加渲染噪声**。

---

### 11. Canvas 渲染桥（可选）

`--canvas-bridge-url=ws://主机:端口/路径` 把 Canvas/WebGL 的**绘制操作**转发到一台拥有真实 GPU 的渲染主机，
取回那台机器真实渲染的像素。效果是：读回的像素就来自画像声称的那种 GPU，而不只是改了字符串。

| 开关 | 作用 |
|---|---|
| `--canvas-bridge-auth=用户:密码` | HTTP Basic 认证 |
| `--canvas-bridge-mode=off\|all\|allow\|deny` | 按站点启用策略，默认 `all` |
| `--canvas-bridge-allow=` / `--canvas-bridge-deny=` | 逗号分隔的 eTLD+1 列表 |
| `--canvas-bridge-fallback=block\|local` | 缓存未命中时阻塞等待，或改为本地渲染 |

服务端见 [`tools/canvas-bridge-server`](tools/canvas-bridge-server/)，详细说明见 [`docs/CANVAS-BRIDGE.md`](docs/CANVAS-BRIDGE.md)。

---

### 12. 配置文件与输入

| 开关 | 作用 | 补丁 |
|---|---|---|
| `--portable-profile` | Cookie 加密密钥保存在配置目录内，复制配置目录后 Cookie 仍可用 | `964` |
| `--profile-encryption-key=<密钥>` | 由该密钥派生 Cookie 加密密钥 | `964` |
| `--agent-llm-url=` / `--agent-llm-key=` | 浏览器内置 AI Agent（使用你自己的 OpenAI 兼容接口），默认关闭 | `200` |

CDP 下发的鼠标键盘输入走正常输入路由，带曲线和抖动轨迹，不会被标记为调试器合成事件（`130` `200`）。

---

### 13. 调用方式

内核只读取**命令行开关**，任何语言都可以通过创建进程来启动。Windows 示例：

```bat
chrome.exe ^
  --fingerprint=7423 ^
  --fingerprint-platform=windows ^
  --timezone=America/New_York ^
  --lang=en-US --accept-lang=en-US,en ^
  --proxy-server=socks5://1.2.3.4:1080 --socks5-credentials=user:pass ^
  --webrtc-ip=1.2.3.4 ^
  --fingerprint-location=40.7128,-74.0060 ^
  --fingerprint-tls-profile=chrome-151 ^
  --user-data-dir=D:\profiles\7423 ^
  --remote-debugging-port=9222
```

更推荐通过 SDK 启动。SDK 会自动下载并校验浏览器、拼好开关，并返回标准的 Playwright `Browser`：

```python
from clearcote import launch

browser = launch(fingerprint="user-7423", platform="windows")
```

详见 [Python SDK](sdk/python/README.md)、[Node SDK](sdk/node/README.md)、[.NET SDK](sdk/dotnet)。
**不要再叠加 stealth 插件**（`puppeteer-extra-plugin-stealth`、`playwright-stealth`），
它们在 JS 层改的值会与引擎画像冲突。

---

### 14. 使用建议

1. **一个身份对应一个种子和一个配置目录。** 种子决定"机器"，`--user-data-dir` 决定 Cookie 与存储。
2. **优先使用画像，少手填单项。** 手填的值只要和其它面对不上就会暴露；不确定时交给画像生成。
3. **时区、语言、地理位置、`--webrtc-ip` 都按代理出口 IP 填写。**
4. **屏幕和 DPR 成对设置，GPU vendor 和 renderer 成套设置。**
5. **想要"像未修改的浏览器"**：用 `--fingerprint-profile` 导入真机档案，或加 `--disable-fingerprint-noise` 关掉噪声。
6. 用 `--clearcote-validate-persona=current` 检查当前命令行生成的画像是否自洽。

请只在合法、获得授权的场景下使用，并遵守目标网站的服务条款，见 [DISCLAIMER.md](DISCLAIMER.md)。

</details>

---

## Builds and tiers

There is one open build and one licensed build. The licensed build is offered two ways.

| | **Open build** | **Free with GitHub** | **Pro, $49/month** |
|---|---|---|---|
| Account | None | GitHub account at least 30 days old | Clearcote account |
| Build | Open, reproducible from this repo | Latest licensed build | Latest licensed build |
| New Chromium majors | About 2 months after release | The day they are built | The day they are built |
| Private stealth patches, recorded human motion, profile library | No | Yes | Yes |
| Older builds and version pinning | Open builds | Latest only | Yes |
| Browsers at the same time | Unlimited | 1 | Up to 250, more on request |
| Support | GitHub issues | GitHub issues | Email from the owner |

- The open build has the full identity surface: personas, render noise, TLS profiles, humanized input. No tier unlocks more spoofing.
- The licensed build adds stealth work that is kept private, so it is **not** reproducible from public source.
- A licence key goes in `CLEARCOTE_LICENSE_KEY=cc_lic_...`, `license_key=` / `licenseKey`, or `clearcote login`. Free with GitHub needs SDK 0.30.0 or newer.

[Get it free with GitHub](https://www.clearcotelabs.com/pricing?utm_source=github&utm_medium=readme&utm_content=builds-and-tiers#free) · [Get Pro](https://www.clearcotelabs.com/pricing?utm_source=github&utm_medium=readme&utm_content=builds-and-tiers) · per-feature table: [Node](sdk/node/README.md#whats-in-each-tier)

### Build availability (October 2026)

| Chromium | Licensed build (Free with GitHub, Pro) | Open build |
|---|---|---|
| **155** (`155.0.8059.39`) | **Available now** | ~Dec 2026 |
| **154** (`154.0.8037.57`) | Available | ~Dec 2026 |
| **153** (`153.0.8010.53`) | Available | ~Nov 2026 |
| **152** (`152.0.7977.82`) | Available | ~Nov 2026 |
| **151** (`151.0.7922.108`) | Available | **Available now** (`v0.1.0-pre.25`) |
| **150** (`150.0.7871.114`) | Available | Available |
| **149** (`149.0.7827.114`) | Available | Available |

Open-build dates are estimates on a two-month cadence, not promises. Choose a major with
`launch(version="155")`, or omit `version` for the newest your tier allows.

The open 151 build is an official, optimized Chromium build: the "page crashed!" / `STATUS_BREAKPOINT`
crashes of the open 150 build are gone, and it starts as root in a container without extra
capabilities. It also adds authenticated SOCKS5 and SOCKS5 UDP relaying, and more GPU, WebGL, WebGPU,
window and screen coherence.

---

## Verify a release, or build it yourself

Every release is SHA-256 checksummed and GPG-signed with the Clearcote release key, which does not change:

```
CA96 F185 F96A 693A EDB3  AC1F CB00 D851 B7A8 6B0F
```

The open build can be rebuilt from this repo and compared with the published one
([docs/VERIFY.md](docs/VERIFY.md)). To build Windows (cross-compiled) or Linux (native) on a Linux host:

```bash
git clone https://github.com/clearcotelabs/clearcote-browser.git
cd clearcote-browser && WORK=~/clearcote-build ./build.sh
```

Guide: [docs/BUILDING.md](docs/BUILDING.md) · patches: [`patches/`](patches/) (applied in the order of [`patches/series`](patches/series)).

---

## FAQ

**Is Clearcote free?**
The open build is free and open source with no account. The latest licensed build is free for one browser
at a time with a GitHub account, and Pro ($49/month) runs up to 250 at once. Hosted browsers cost €1 per GB.

**Do I have to change my Playwright code?**
No. `launch()` returns a normal Playwright `Browser`. Replace `chromium.launch(...)` with `launch(...)` and keep the rest.

**Does it work with Puppeteer, Selenium or other tools?**
Puppeteer and any CDP client: yes, through the binary or a CDP endpoint. Selenium and WebDriver: no, because Clearcote is driven over CDP.

**Which operating systems are supported?**
Windows x64, Linux x64 and **macOS arm64** (Apple Silicon), plus the Docker image. The browser can present itself as
Windows, Linux, macOS or Android on any of them.
The macOS build is **unsigned** — clear the quarantine flag after verifying it ([VERIFY.md](docs/VERIFY.md) §2a).
macOS x64 (Intel) is not built; on an Intel Mac `launch()` still runs the Docker image through Docker Desktop
(SDK 0.40.0+).

**Should I add a stealth plugin on top?**
No. Plugins such as `puppeteer-extra-plugin-stealth` change values from JavaScript, which conflicts with the engine-level persona.

**Is the licensed build open source?**
No. The open build is BSD-3 and reproducible. The licensed build adds private patches and is not reproducible from public source.

**What is it for?**
Privacy, QA and testing, research and lawful automation. Respect site terms and the law. See [DISCLAIMER.md](DISCLAIMER.md).

---

## More

| | |
|---|---|
| **Website** | [clearcotelabs.com](https://www.clearcotelabs.com/?utm_source=github&utm_medium=readme&utm_content=more) · [Docs](https://www.clearcotelabs.com/docs?utm_source=github&utm_medium=readme&utm_content=more) · [Pricing](https://www.clearcotelabs.com/pricing?utm_source=github&utm_medium=readme&utm_content=more) · [Compare alternatives](https://www.clearcotelabs.com/alternatives?utm_source=github&utm_medium=readme&utm_content=more) · [Blog](https://www.clearcotelabs.com/blog?utm_source=github&utm_medium=readme&utm_content=more) |
| **SDK references** | [Python](sdk/python/README.md) · [Node](sdk/node/README.md) · [.NET](sdk/dotnet) |
| **Docs** | [VERIFY](docs/VERIFY.md) · [BUILDING](docs/BUILDING.md) · [PATCHES](docs/PATCHES.md) · [UPGRADING](docs/UPGRADING.md) · [CANVAS-BRIDGE](docs/CANVAS-BRIDGE.md) · [STEALTH-COHERENCE](docs/STEALTH-COHERENCE.md) |
| **Hosted** | [Hosted browsers](https://www.clearcotelabs.com/docs/hosted-browsers?utm_source=github&utm_medium=readme&utm_content=more) · [Agent runs](https://www.clearcotelabs.com/docs/runs?utm_source=github&utm_medium=readme&utm_content=more) · [Playground](https://www.clearcotelabs.com/dashboard/playground?utm_source=github&utm_medium=readme&utm_content=more) · [Site status](https://github.com/clearcotelabs/clearcote-tracker) |
| **Profiles** | [clearcote-profiles](https://github.com/clearcotelabs/clearcote-profiles) · [collector](tools/fingerprint-collect) · [Profile Manager app](https://github.com/clearcotelabs/clearcote-profile-manager) |
| **For agents** | [llms.txt](llms.txt) · [AGENTS.md](AGENTS.md) |
| **Project** | [ROADMAP](ROADMAP.md) · [CONTRIBUTING](CONTRIBUTING.md) · [SECURITY](SECURITY.md) · [Discord](https://discord.gg/WxvCjAnXZm) |

## Credits and license

Clearcote builds on [Chromium](https://www.chromium.org/) (BSD-3),
[ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium) (the de-Googled base),
[fingerprint-chromium](https://github.com/adryfish/fingerprint-chromium) (engine-level fingerprint controls),
[Brave](https://brave.com/privacy-updates/3-fingerprint-randomization/) (the per-site "farbling" model) and
[Camoufox](https://github.com/daijro/camoufox) (a sibling open browser). It is an independent project and
ships no proprietary code. Full attributions: [CREDITS.md](CREDITS.md).

Code and patches are [BSD-3-Clause](LICENSE); upstream components keep their own licenses. Provided as is
([DISCLAIMER.md](DISCLAIMER.md)).
