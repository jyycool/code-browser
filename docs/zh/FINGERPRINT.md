# Clearcote 指纹修改详情

本文汇总 Clearcote 内核（Chromium `151.0.7922.108`，见 [`UPSTREAM_REVISION`](../../UPSTREAM_REVISION)）
相对上游 Chromium / ungoogled-chromium **实际改过的指纹能力**，以及对应的命令行开关。
每一项都能在 [`patches/`](../../patches/) 里找到对应补丁，逐补丁说明见 [`patches/README.md`](../../patches/README.md)。

规则（`977-persona-active-predicate`）：

| 启动方式 | 结果 |
|---|---|
| 不传 `--fingerprint` / `--fingerprint-profile` | 用宿主机真实值（单项覆盖开关仍然生效） |
| `--fingerprint=<种子>` | 由种子生成一整套**自洽画像**（persona），并按站点加噪 |
| `--fingerprint-profile=<档案>` | 呈现导入的真机档案，**不加噪**；档案缺的字段由种子补齐 |

单项开关的优先级统一为：**开关 > 画像 > 真机**。

---

## 1. 种子与画像模型

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

## 2. 渲染噪声（Canvas / WebGL / Audio）

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

## 3. Navigator / UA / UA-CH / 硬件

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

## 4. 屏幕 / DPR / 指针

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

## 5. GPU / WebGL / WebGPU

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

## 6. 字体 / 语音 / 数学函数

| 面 | 行为 | 补丁 |
|---|---|---|
| 字体 | 只暴露画像的字体集：默认是按真实 Windows 安装建模的约 300 个字体族，或导入档案的 `fonts.detected`；Linux 宿主上用 231 个度量兼容的替代字体 | `040` |
| `system-ui` | Windows 画像下解析为 Segoe UI | `971` |
| 语音 | `speechSynthesis.getVoices()` 返回画像语音：默认 Windows SAPI 的 en-US David / Zira / Mark，或档案中的 `speech[]`；不会为空 | `170` |
| `Math.tanh` | Windows 画像在任何宿主上都返回与 Windows 逐位相同的结果 | `965` |

macOS 画像另有 3 个字体补丁，见 [`patches/macos-150/`](../../patches/macos-150/) 与 [`MACOS-FONTS.md`](MACOS-FONTS.md)。

---

## 7. 时区 / 语言 / 地理位置

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

## 8. 网络：WebRTC / 代理 / TLS

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

## 9. 其它设备接口（传种子即生效）

| 接口 | 画像值 | 补丁 |
|---|---|---|
| `navigator.getBattery()` | 桌面插电：充电中、100%；getter 与 `chargingchange` / `levelchange` 事件一致 | `150` `979` |
| `navigator.connection` | 住宅 4g（第 2 版画像按实测比例抽取 rtt / downlink） | `150` `981` |
| `navigator.keyboard.getLayoutMap()` | US-QWERTY | `150` |
| `enumerateDevices()` | 真实 Windows 板载声卡的麦克风/扬声器组合，`deviceId` / `groupId` 由种子决定，授权前 label 为空 | `148` |
| `navigator.share` / `canShare` | Windows 画像下存在 | `160` |
| `new URL("C:/").protocol` | `"file:"`（Windows 行为） | `160` |

---

## 10. 导入真机档案

```
--fingerprint-profile=<gzip 压缩后再 base64 编码的 JSON>
```

用 [`tools/fingerprint-collect`](../../tools/fingerprint-collect/) 在一台真机上采集，或从公开数据集转换。
档案会驱动 GPU（字符串、完整 `getParameter` 表、扩展、WebGPU）、屏幕、字体、语音、音频、Chrome 版本、
CSS `@media`、触摸点、编解码能力和媒体设备列表。档案里没有的字段由 `--fingerprint` 种子补齐，所以不完整的档案也能保持自洽。
导入档案时**不加渲染噪声**。

---

## 11. Canvas 渲染桥（可选）

`--canvas-bridge-url=ws://主机:端口/路径` 把 Canvas/WebGL 的**绘制操作**转发到一台拥有真实 GPU 的渲染主机，
取回那台机器真实渲染的像素。效果是：读回的像素就来自画像声称的那种 GPU，而不只是改了字符串。

| 开关 | 作用 |
|---|---|
| `--canvas-bridge-auth=用户:密码` | HTTP Basic 认证 |
| `--canvas-bridge-mode=off\|all\|allow\|deny` | 按站点启用策略，默认 `all` |
| `--canvas-bridge-allow=` / `--canvas-bridge-deny=` | 逗号分隔的 eTLD+1 列表 |
| `--canvas-bridge-fallback=block\|local` | 缓存未命中时阻塞等待，或改为本地渲染 |

服务端见 [`tools/canvas-bridge-server`](../../tools/canvas-bridge-server/)，详细说明见 [`CANVAS-BRIDGE.md`](CANVAS-BRIDGE.md)。

---

## 12. 配置文件与输入

| 开关 | 作用 | 补丁 |
|---|---|---|
| `--portable-profile` | Cookie 加密密钥保存在配置目录内，复制配置目录后 Cookie 仍可用 | `964` |
| `--profile-encryption-key=<密钥>` | 由该密钥派生 Cookie 加密密钥 | `964` |
| `--agent-llm-url=` / `--agent-llm-key=` | 浏览器内置 AI Agent（使用你自己的 OpenAI 兼容接口），默认关闭 | `200` |

CDP 下发的鼠标键盘输入走正常输入路由，带曲线和抖动轨迹，不会被标记为调试器合成事件（`130` `200`）。

---

## 13. 调用方式

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

详见 [Python SDK](../../sdk/python/README.md)、[Node SDK](../../sdk/node/README.md)、[.NET SDK](../../sdk/dotnet)。
**不要再叠加 stealth 插件**（`puppeteer-extra-plugin-stealth`、`playwright-stealth`），
它们在 JS 层改的值会与引擎画像冲突。

---

## 14. 使用建议

1. **一个身份对应一个种子和一个配置目录。** 种子决定"机器"，`--user-data-dir` 决定 Cookie 与存储。
2. **优先使用画像，少手填单项。** 手填的值只要和其它面对不上就会暴露；不确定时交给画像生成。
3. **时区、语言、地理位置、`--webrtc-ip` 都按代理出口 IP 填写。**
4. **屏幕和 DPR 成对设置，GPU vendor 和 renderer 成套设置。**
5. **想要"像未修改的浏览器"**：用 `--fingerprint-profile` 导入真机档案，或加 `--disable-fingerprint-noise` 关掉噪声。
6. 用 `--clearcote-validate-persona=current` 检查当前命令行生成的画像是否自洽。

请只在合法、获得授权的场景下使用，并遵守目标网站的服务条款，见 [DISCLAIMER.md](../../DISCLAIMER.md)。
