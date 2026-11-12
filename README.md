<div align="center">

# code-browser

**把指纹控制编译进引擎的开源 Chromium**

[快速开始](#快速开始) · [使用方式](#使用方式) · [工作原理](#工作原理) · [指纹能力](#指纹能力) · [从源码构建](#从源码构建) · [文档](#文档)

</div>

code-browser 是一个基于 ungoogled-chromium 的浏览器发行版，外加一组可读的 C++ 源码补丁。指纹伪装写在引擎里，而不是在页面里注入 JavaScript。
每个浏览器呈现一台**内部自洽**的机器：JavaScript 能读到的值、HTTP 请求头和 TLS 握手都来自同一个真实的 Chromium，所以它们彼此一致。

你可以继续用现有的 Playwright、Puppeteer 或任何 Chrome DevTools Protocol（CDP）客户端来驱动它。

## 一览

| | |
|---|---|
| **是什么** | 基于 ungoogled-chromium（去 Google 化）的 Chromium 发行版 + 一组可读的源码补丁 |
| **内核版本** | Chromium `151.0.7922.108`（见 [`UPSTREAM_REVISION`](UPSTREAM_REVISION)） |
| **配合使用** | Playwright、Puppeteer，以及任何支持 CDP 的工具 |
| **SDK** | Python、Node.js / TypeScript、.NET。`launch()` 返回标准的 Playwright `Browser` |
| **平台** | Windows x64、Linux x64、Docker |
| **许可证** | BSD-3-Clause（见 [LICENSE](LICENSE)） |

---

## 快速开始

SDK 包目前还没有发布到包仓库，请从本仓库源码安装：

```bash
pip install ./sdk/python                 # Python
npm install ./sdk/node                   # Node.js / TypeScript
dotnet add reference sdk/dotnet/src/CodeBrowser/CodeBrowser.csproj   # .NET
```

```python
from code_browser import launch

browser = launch(fingerprint="user-7423")   # 同一个种子 → 每次启动都是同一台机器
page = browser.new_page()                   # 从这里开始就是标准的 Playwright Browser
page.goto("https://example.com")
browser.close()
```

SDK 第一次使用时会下载浏览器二进制，校验 SHA-256 后缓存下来，不需要 `playwright install`。
如果你使用自己编译的浏览器，传入 `executable_path`，或设置环境变量 `CODE_BROWSER_BINARY` 指向它。

---

## 使用方式

| 我想要… | 用什么 | 章节 |
|---|---|---|
| 在自己的 Playwright / Puppeteer 代码里使用 | SDK | [在代码中使用](#在代码中使用) |
| 接入已经支持 CDP 的工具 | CDP 端点 | [作为 CDP 端点运行](#作为-cdp-端点运行) |
| 在容器里运行 | Docker 镜像 | [在 Docker 中运行](#在-docker-中运行) |
| 让 AI 助手（Claude、Cursor、Cline）操作浏览器 | MCP 服务 | [给 AI 助手一个浏览器](#给-ai-助手一个浏览器) |
| 做一个桌面应用：点"开始"，浏览器嵌在应用里打开 | 桌面应用（Windows） | [`app/README.md`](app/README.md) |
| 不用 SDK，直接启动浏览器 | 命令行开关 | [直接使用浏览器二进制](#直接使用浏览器二进制) |

### 在代码中使用

**从 Playwright 迁移**只需要改启动那一行，之后的代码保持不变：

```diff
- from playwright.sync_api import sync_playwright
- browser = sync_playwright().start().chromium.launch()
+ from code_browser import launch
+ browser = launch(fingerprint="user-7423")
```

**Python**

```python
from code_browser import launch          # asyncio：from code_browser.async_api import launch

browser = launch(
    fingerprint="user-7423",          # 同一个种子 → 同一台机器；换一个种子 → 一台新的、无法关联的机器
    platform="windows",               # "windows" | "linux" | "macos" | "android"
    timezone="America/New_York",
)
page = browser.new_page()
page.goto("https://example.com")
browser.close()
```

**Node.js / TypeScript**

```javascript
import { launch } from "code-browser";

const browser = await launch({
  fingerprint: "user-7423",
  platform: "windows",
  brand: "Edge",                      // "Chrome"（默认）| "Edge" | "Opera" | "Vivaldi"
  timezone: "America/New_York",
});
const page = await browser.newPage();
await page.goto("https://example.com");
await browser.close();
```

**.NET**

```csharp
using CodeBrowser;

var browser = await CodeBrowser.CodeBrowser.LaunchAsync(new LaunchOptions {
    Fingerprint = "user-7423", Platform = "windows", Timezone = "America/New_York",
});
var page = await browser.NewPageAsync();   // 标准的 Microsoft.Playwright IBrowser
await page.GotoAsync("https://example.com");
await browser.CloseAsync();
```

#### 常用选项

| 选项（Python / Node） | 作用 |
|---|---|
| `fingerprint` | 种子。一个种子就是一台机器：硬件、屏幕、GPU 和按站点的渲染噪声都由它决定。字体和语言不由它决定：字体是该平台常见的字体，语言来自 `accept_language` / `acceptLanguage`、`geoip` 或默认的 `en-US` |
| `platform` | 浏览器呈现的操作系统：`windows`、`linux`、`macos` 或 `android` |
| `brand` | UA 和 Client Hints 中的浏览器品牌：`Chrome`、`Edge`、`Opera`、`Vivaldi` |
| `proxy` | `{"server": "http://host:8080", "username": "u", "password": "p"}`。HTTP 和带用户名密码的 SOCKS5 都支持 |
| `geoip` | `True` 时让时区、语言和 `Accept-Language` 与代理出口所在地一致 |
| `humanize` | 移动、点击、拖拽、滚动和输入都使用带人类轨迹的原生可信输入 |
| `light_stealth` / `lightStealth` | 只改硬件元数据（核数、内存、色深、像素比、触摸点），渲染保持真实 |
| `fingerprint_profile` / `fingerprintProfile` | 加载用 [采集器](tools/fingerprint-collect) 从真机采集的档案。它用来代替 `fingerprint`，不要两者同时用 |
| `executable_path` / `executablePath` | 使用指定路径的浏览器二进制，而不是 SDK 下载的版本 |

其它参数都会原样传给 Playwright（`headless`、`args`、`timeout` 等）。完整列表见各 SDK 的说明：
[Python](sdk/python/README.md) · [Node](sdk/node/README.md) · [.NET](sdk/dotnet)。

**注意：**
- **一个身份对应一个种子。** 同一个 `fingerprint` 字符串每次都返回同一台机器；新字符串就是一台新的、无法关联的机器。
- **不要再叠加 stealth 插件**（如 `puppeteer-extra-plugin-stealth`、`playwright-stealth`）。它们在 JavaScript 层修改的值会和引擎中的画像冲突。
- **不支持 Selenium / WebDriver。** code-browser 通过 CDP 驱动，这类脚本需要改写为 Playwright、Puppeteer 或其它 CDP 客户端。

### 作为 CDP 端点运行

`serve()` 直接启动浏览器（不经过 Playwright），不会添加自动化标志，`navigator.webdriver` 保持为 `false`。
任何能通过 CDP 连接的工具都可以直接接入。

```bash
code-browser-serve --port 9222 --fingerprint seed-123 --platform windows   # 输出 http://127.0.0.1:9222
```

```python
from code_browser import serve
from playwright.sync_api import sync_playwright

with serve(fingerprint="seed-123", platform="windows") as srv:          # 绑定 127.0.0.1
    browser = sync_playwright().start().chromium.connect_over_cdp(srv.cdp_url)
```

常见工具改连这个端点时，只需要改一行：

| 工具 | 需要改的那一行 |
|---|---|
| Playwright（Python / Node） | `chromium.connect_over_cdp("http://127.0.0.1:9222")` / `chromium.connectOverCDP(...)` |
| Puppeteer | `puppeteer.connect({ browserURL: "http://127.0.0.1:9222" })` |
| 其它 CDP 客户端 | 使用 `http://127.0.0.1:9222/json/version` 返回的 `webSocketDebuggerUrl` |

CDP 端口可以完全控制浏览器，只能绑定在 `127.0.0.1` 或可信网络上。

### 在 Docker 中运行

[`docker/`](docker/) 目录是一个把浏览器暴露为 CDP 端点（9222 端口）的镜像，自带 Windows 画像所需的字体，以及让 Chrome 保留沙箱的 seccomp 配置。

```bash
cd docker
docker build -t code-browser .
docker run -d --rm --shm-size=1g -p 127.0.0.1:9222:9222 \
  --security-opt seccomp=seccomp.json \
  -e CC_PLATFORM=windows -e CC_FINGERPRINT=user-7423 code-browser
```

用环境变量设置画像：`CC_PLATFORM`（`windows`、`linux`、`macos`、`android`）、`CC_FINGERPRINT`（种子；不设置时每个容器随机生成一个）、
`CC_BRAND`、`CC_TIMEZONE`、`CC_ACCEPT_LANGUAGE`、`CC_TLS_PROFILE`。

> 镜像构建时会通过 `pip` 安装 SDK 包，所以需要先把 `code-browser` 包发布到你使用的包仓库，或者修改 `docker/Dockerfile` 改为从本地安装。
> 详见 [`docker/README.md`](docker/README.md)。

### 给 AI 助手一个浏览器

[MCP 服务](mcp/) 给 Claude Desktop、Cursor、Cline 等 MCP 客户端提供一个共享的浏览器，以及约 20 个工具
（`read_page`、`click`、`fill_field`、`screenshot`、`save_profile`、`get_cdp_endpoint` 等）。

```bash
pip install ./sdk/python ./mcp
```

```json
{
  "mcpServers": {
    "code-browser": {
      "command": "code-browser-mcp",
      "env": { "CODE_BROWSER_FINGERPRINT": "acct-1", "CODE_BROWSER_PLATFORM": "windows" }
    }
  }
}
```

使用说明见 [`mcp/USAGE.md`](mcp/USAGE.md)。

### 直接使用浏览器二进制

不用 SDK 也可以：用原版 Playwright（或任何 CDP 客户端）启动浏览器二进制，通过 `--fingerprint` 等开关设置画像：

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=r"C:\code-browser\chrome.exe",
        args=["--fingerprint=seed-123", "--fingerprint-platform=windows"],
    )
    page = browser.new_page()
    page.goto("https://example.com")
    browser.close()
```

所有开关的含义和取值见 [指纹修改详情](docs/zh/FINGERPRINT.md)。

---

## 工作原理

**控制写在引擎里，而不是页面里。** 大多数隐身工具在 JavaScript 中修改指纹：用脚本替换 `navigator.webdriver`、WebGL vendor 或 `navigator.plugins`。
被替换的函数可以和原生函数区分开，例如：

- `Function.prototype.toString` 显示的是源码，而不是 `[native code]`；
- 它的属性描述符和 `hasOwnProperty` 与原生 getter 不同；
- 从新的 iframe 或 Web Worker 中取出的干净 `toString` 依然能看到这个替换。

在 code-browser 中，`navigator.vendor` 背后的 getter 就是 C++ 实现的 getter，在每个 frame 和 worker 里都是原生代码，没有可被发现的替换。

**一个种子，一台自洽的机器。** `fingerprint` 种子同时决定硬件、屏幕和 GPU，以及按站点的 canvas 和 WebGL 噪声，所以这些值彼此一致。
同一站点在一个会话内看到的值稳定，不同站点之间的噪声互不相关，无法跨站关联。
由于页面的 JavaScript 和网络栈来自同一个真实的 Chromium，UA、Client Hints 请求头、TLS 握手和 HTTP/2 设置也彼此一致。

**可控制的内容：**

- **身份：** UA 和 Client Hints（品牌、平台、版本、架构），JavaScript 中和 `Sec-CH-UA` 请求头中一致。
- **GPU：** WebGL vendor、renderer、`getParameter` 限制和扩展，以及与同一块 GPU 一致的 WebGPU 参数。
- **渲染：** 由种子决定的按站点 canvas 和 WebGL 噪声，也可以关闭；可选的 [真实 GPU 渲染桥](docs/zh/CANVAS-BRIDGE.md)。
- **音频：** `AudioContext` 报告画像的采样率和延迟。音频采样本身不加噪，与同一台机器上的原版 Chrome 一致。
- **字体：** 画像操作系统的字体，宽度正确，Linux 服务器上也一样。
- **硬件与屏幕：** 核数、内存、存储配额、屏幕尺寸、色深、像素比、`getScreenDetails()`、触摸点。
- **区域与网络：** 时区、语言、`Accept-Language`、`Intl` 区域、地理位置，以及与所宣称的 Chrome 版本一致的 TLS 和 HTTP/2 特征；
  `--webrtc-ip` 可以让 WebRTC 报告代理出口 IP，不发送真实 STUN 请求。
- **其它：** 语音列表、媒体编解码能力、媒体设备、CSS 媒体查询、电池、网络信息、键盘布局。
- **输入：** 带人类轨迹的可信鼠标和键盘输入，`navigator.webdriver` 保持为 `false`。

---

## 指纹能力

每个指纹面、对应的命令行开关、默认行为和实现它的补丁，都整理在 [**指纹修改详情**](docs/zh/FINGERPRINT.md) 中。启动规则：

| 启动方式 | 结果 |
|---|---|
| 不传 `--fingerprint` / `--fingerprint-profile` | 使用宿主机的真实值（单项覆盖开关仍然生效） |
| `--fingerprint=<种子>` | 由种子生成一整套自洽画像，并按站点加噪 |
| `--fingerprint-profile=<档案>` | 呈现导入的真机档案，不加噪；档案缺的字段由种子补齐 |

单项开关的优先级统一为：**开关 > 画像 > 真机**。

所有引擎修改都是 [`patches/`](patches/) 中的 unified diff，逐个补丁的说明见 [`patches/README.md`](patches/README.md)。
阅读这些 diff 就是审计 code-browser 修改了引擎哪些地方的方式：没有任何编译进去的行为不在这里。

---

## 从源码构建

在一台 Linux 主机上即可构建 Windows x64（交叉编译）和 Linux x64（原生编译）的二进制，不需要 Windows 机器。

```bash
WORK=~/code-browser-build ./build.sh windows     # → chrome.exe 的 zip 包（默认）
WORK=~/code-browser-build ./build.sh linux       # → chrome 的 tar.xz 包
```

也可以在固定版本的构建环境容器中构建（推荐，环境与发布构建一致）：

```bash
docker build -t code-browser-build .
docker run --rm -v "$PWD/out:/code-browser-build/dist" code-browser-build linux
docker run --rm -v "$PWD/out:/code-browser-build/dist" code-browser-build windows
```

**硬件要求：** 约 32 GB 内存（Windows 目标的 ThinLTO 链接峰值约 31 GB）、约 120 GB 空闲磁盘、多核 CPU。
构建类型为 official（ThinLTO + PGO），Windows 交叉构建在 8 核上约需 12 小时。

构建分为 6 个阶段（`scripts/00` 到 `scripts/05`）：获取源码 → 应用补丁 → 主机工具链 → Windows SDK → 配置与编译 → 打包。
完整说明见 [从源码构建](docs/zh/BUILDING.md)，验证产物见 [验证发布](docs/zh/VERIFY.md)。

---

## 文档

中文文档在 [`docs/zh/`](docs/zh/)，英文文档在 [`docs/en/`](docs/en/)，两边文件名一致。

| 文档 | 内容 |
|---|---|
| [FINGERPRINT.md](docs/zh/FINGERPRINT.md) | 每个指纹面、对应开关与补丁 |
| [BUILDING.md](docs/zh/BUILDING.md) | 从源码构建 |
| [VERIFY.md](docs/zh/VERIFY.md) | 验证发布产物（GPG 签名、校验和） |
| [PATCHES.md](docs/zh/PATCHES.md) | 补丁集的设计清单 |
| [PATCH-INTEGRITY.md](docs/zh/PATCH-INTEGRITY.md) | 补丁完整性门禁 |
| [STEALTH-COHERENCE.md](docs/zh/STEALTH-COHERENCE.md) | 隐身一致性门禁 |
| [CANVAS-BRIDGE.md](docs/zh/CANVAS-BRIDGE.md) | Canvas 渲染桥 |
| [MACOS-FONTS.md](docs/zh/MACOS-FONTS.md) | macOS 画像字体 |
| [UPGRADING.md](docs/zh/UPGRADING.md) | 升级 Chromium 版本 |
| [RELEASING.md](docs/zh/RELEASING.md) · [RELEASING-SDK.md](docs/zh/RELEASING-SDK.md) | 浏览器与 SDK 的发布流程 |
| [RELEASE-SMOKE-TEST.md](docs/zh/RELEASE-SMOKE-TEST.md) | 发布冒烟测试 |
| [OFFLINE.md](docs/zh/OFFLINE.md) | 离线模式 |
| [RESEARCH.md](docs/zh/RESEARCH.md) · [RESEARCH-DOSSIER.md](docs/zh/RESEARCH-DOSSIER.md) | 设计研究 |

给 AI 工具看的说明：[`AGENTS.md`](AGENTS.md) · [`llms.txt`](llms.txt)。

---

## 仓库结构

```
code-browser/
├── README.md            # 本文件
├── UPSTREAM_REVISION    # 补丁所针对的 Chromium 版本
├── build.sh             # 一键构建入口
├── Dockerfile           # 可复现的构建环境
├── scripts/             # 构建阶段 00–05，以及发布和 CI 检查
├── patches/             # 引擎源码补丁（unified diff）+ series
├── config/              # args.gn 构建配置
├── sdk/                 # SDK：python/、node/、dotnet/
├── mcp/                 # MCP 服务（code-browser-mcp）
├── app/                 # Windows 桌面应用（Electron，浏览器嵌入在应用内）
├── docker/              # CDP 端点 Docker 镜像
├── tools/               # 指纹采集器、Canvas 渲染桥服务
└── docs/                # 文档：zh/（中文）、en/（英文）
```

---

## 参与贡献

- **补丁优先，不做分叉。** 对 Chromium 的修改都是 `patches/` 下的 unified diff，列在 `patches/series` 中。每个补丁只做一件事，名字清楚，开头注释说明*为什么*。
- **固定版本。** 补丁针对 `UPSTREAM_REVISION` 中的版本。升级时要重新测试整套补丁。
- **在引擎层实现，而不是注入 JS。** 身份/隐私行为属于编译后的代码。
- **不提交密钥和二进制。** 仓库里只有源码和文本补丁。
- **隐私相关的补丁是必需的。** 不要为了让构建通过而删掉隐私/身份补丁，要修好它。

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 报告。

---

## 许可证与致谢

代码和补丁以 [BSD-3-Clause](LICENSE) 许可证发布。上游项目及其许可证见 [CREDITS.md](CREDITS.md)。

code-browser 不隶属于 Google，也未获得其认可。Chromium 和 Chrome 是 Google LLC 的商标。

请只在合法、获得授权的场景下使用（隐私保护、授权范围内的测试与自动化、安全研究），并遵守目标网站的服务条款，见 [DISCLAIMER.md](DISCLAIMER.md)。
