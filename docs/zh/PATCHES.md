# code-browser 隐身补丁清单

**目标：** Chromium 151.0.7922.108（ungoogled 基础）· Windows x64 + Linux x64 · 在 Linux 上交叉编译（本设计清单是针对 149 起草并核对的；`patches/` 中已提交的补丁集才是唯一可信来源）
**基础伪装层：** adryfish/fingerprint-chromium 142→149 移植
**一致性模型：** Brave 按 eTLD+1 的 farbling，移植到 code-browser 的会话种子根之上
**状态：** 设计方案，写于补丁构建之前 · 文件路径是真实的 Chromium 149 目标

> **这是设计方案，不是实际发布内容的清单。** [`patches/`](../../patches) 中已提交的补丁集才是唯一可信来源。下面有若干行从未被实现，其中包括
> [§2.2](#22--audio) 中所有的音频噪声：没有任何构建会给音频采样加噪。

---

## 1. 概述：隐身论点

code-browser 的隐身姿态建立在**大多数反检测分支都弄错的两条一致性轴线**上：

1. **引擎级一致性（纵向）。** 每个指纹面都必须描述*同一台合理的真实机器*，而且这台机器必须与二进制**实际使用的渲染后端**一致。
   一个 WebGL renderer 字符串不能与 `MAX_TEXTURE_SIZE=4096`、矛盾的 ANGLE/D3D 字符串、不符合分布的 `hardwareConcurrency + deviceMemory`、
   `America/New_York` 时区下的 `Berlin` 地理位置共存，**也不能与一个来自与 renderer 字符串所声称的不同 GPU 的 readPixels 哈希共存。**
   各个面要从精选的真实设备分布（Steam/StatCounter 集群）中**先按档次**抽取，绝不各自独立随机。

2. **按 eTLD+1 的一致性（横向）。** 相对整个隐身领域最重要的一项升级：adryfish/ChromiumFish 使用**一个全局 `--fingerprint` 种子**，
   所以每个站点看到完全相同的加噪值，这就是一个可跨站关联的超级 cookie。code-browser 把这个整数保留为**会话 token**，并在其上叠加 Brave 的按 eTLD+1 推导：
   *同一站点 → 整个会话稳定（没有闪变破绽）；不同站点 → 不可关联；新会话 → 全新画像。*

**渲染后端规则（新增，约束所有 GPU 面）。** 交叉编译的二进制通过*部署主机运行时*存在的后端渲染 WebGL/WebGPU，而不是构建主机。因此 code-browser 固定**一个**画像 GPU，
它的真实像素输出与该后端无法区分：
- **默认部署 = 带真实 GPU 的真实 Windows 主机 →** 宣称一个**主流集成 GPU（Intel UHD 770）的 ANGLE-on-D3D11 字符串**，因为 ANGLE/D3D11 正是该主机上真实消费级 Chrome
  的渲染方式，读回哈希也会落在该 GPU 的真实集群中。
- **无头/SwiftShader 运行时（CI、无 GPU 的 VPS）→** 宣称一个**与 ANGLE-SwiftShader 一致的字符串**，绝不使用独显名称，让 renderer 字符串与像素哈希一致。
- **绝不**在一个无法产生该 GPU 像素的后端之上宣称 "NVIDIA RTX 3060" 级别的独显 renderer。renderer 字符串与 readPixels 哈希不一致是最强的 GPU 破绽，
  而一个制造出这种不一致的字符串伪装，会让浏览器比如实报告后端字符串*更*容易被检测。

**分层。** 三个层次，按顺序应用：

| 层 | 作用 | 来源模型 |
|---|---|---|
| **L0：farbling 核心 + 画像引擎** | 一个统一的种子引擎：`--code-browser-seed` 根 + 按 eTLD+1 的 token 推导 + `SessionCache`（每个面都使用的熵读取器）**以及** `FingerprintProfile` 画像结构（UA/屏幕/硬件/GPU 元组）。两个读取方，一个根。 | Brave `BraveSessionCache` + ChromiumFish 画像种子管线 |
| **L1：adryfish 基础移植** | 重放 adryfish 142→149；为它已覆盖的面提供基础伪装。它的噪声被**升级为按 eTLD+1**，而不是重复打补丁。审计门禁（见下）封堵它对全局种子的读取。 | adryfish/fingerprint-chromium |
| **L2：逐个面的补丁** | Canvas/WebGL/WebGPU/audio/fonts/navigator/screen/TLS/WebRTC/geo-media/timing/去 Google/humanize。每个都读取 L0 token（按站点噪声）或画像（`Current()`）。 | Brave + Camoufox + Cromite + BotBrowser + ChromiumFish |

**三条不可妥协的设计规则**贯穿每个补丁：
- **绝不留空，绝不置零。** 空白 canvas、置零的 `readPixels`、空的 WebGPU vendor、空的 `getVoices()`、被钳制到 100ms 的 `performance.now()`：每一个都比真实值*更*容易暴露。
  code-browser **一致地扰动或替换**，绝不屏蔽。
- **绝不直接读取全局种子。** 每个面都通过 `SessionCache::From(context)` / `fingerprinting::Current()` 解析。只要有一处绕过，就会重新造出可关联的超级 cookie：
  由**构建时断言**强制执行（见 §3），而不是之后某个阶段的审计。
- **绝不让一个常量把整批实例归为一类。** 任何在所有画像上固定为同一个字面量的值（字体集、`prefers-color-scheme`、电池电量）都会成为一个*可关联的群组*。
  这类值按画像从加权分布中抽取，而不是硬编码。

---

## 2. 按领域划分的补丁表

### 2.0 — farbling-core + persona engine (L0 infrastructure)

| 补丁 | 伪装对象 | 技术 | 真实目标文件 | 参考来源 | 优先级 | 检测风险说明 |
|---|---|---|---|---|---|---|
| **code-browser-seed-switch** | 会话熵根：`--code-browser-seed=<uint64>`（adryfish int32 `--fingerprint` 的超集） | 新增 `CONTENT_EXPORT kCodeBrowserSeed`；若未提供，浏览器在启动时自动生成一个 `base::RandUint64`，并回填到 CommandLine；惰性的 `std::call_once Current()` 读取器 | `content/public/common/content_switches.{h,cc}`、`chrome/browser/chrome_content_browser_client.cc` | ChromiumFish `persona-seed.patch`；adryfish `--fingerprint` | **P0** | 没有任何网页可见面。运行风险：如果启动器省略该开关，而各进程各自生成不同的种子 → 会话内闪变。由浏览器生成一次并强制转发。 |
| **code-browser-seed-forward** | 种子在**所有**进程（渲染/GPU/utility/zygote/worker 宿主）间一致 | 把 `kCodeBrowserSeed`（以及 `kPersonaSeed`/`kPersonaOs`）加入 `kSwitchNames[]` 允许列表（`PropagateBrowserCommandLineToRenderer`），并镜像到 GPU/utility 的 `AppendExtraCommandLineSwitches` 中。**涵盖了 `persona-seed-plumbing`：一个转发补丁，而不是两个。** | `content/browser/renderer_host/render_process_host_impl.cc`、`chrome/browser/chrome_content_browser_client.cc` | ChromiumFish `persona-seed.patch` | **P0** | 开关只对本地进程查看工具可见（网页看不到）。反向风险：漏掉某一种进程（shared-worker 宿主）会重新引入不一致。不得与任何会翻转 `navigator.webdriver` 的自动化开关集合冲突。 |
| **code-browser-persona-profile** | 唯一可信来源：`FingerprintProfile`（画像的 Chrome 版本、品牌列表、统一/navigator 平台、UA 元数据、HC、device_memory、屏幕宽高/可用区域/colorDepth/DPR、**唯一的画像 GPU**、WebGL 限制），先按档次抽取 | 新增 `third_party/blink/public/common/fingerprinting/fingerprint_profile.{h,cc}`；`fingerprinting::Current()` 线程局部，通过 `DeriveFromSeed(seed, eTLD+1, os)` 得到。SplitMix64 混合种子 → **先**抽取 `HwTier`（按 Steam 加权）→ 从该档次的子池中抽取 HC+内存+屏幕+GPU（不会出现不符合分布的组合）。**把 `persona-fingerprint-profile` 与 `fingerprint-profile-engine` 的画像部分合并为一个结构。** | `…/public/common/fingerprinting/fingerprint_profile.h`、`…/common/fingerprinting/fingerprint_profile.cc`、`…/common/BUILD.gn` | chromiumfish `persona-seed` + `fingerprint-profile.patch`，扩展为按 eTLD+1 | **P0** | 只要每个操作系统的数据块内部自洽、并且 **GPU 固定为唯一一个与渲染后端一致的值（真实 Windows 部署用 Intel UHD 770 / ANGLE-D3D11；无头用 ANGLE-SwiftShader）**，风险就低。`WeightedPick` 让 `(核数、内存、操作系统、Chrome 版本、屏幕、GPU)` 保持在真实集群内。 |
| **code-browser-persona-version-freeze** | **冻结的画像 Chrome 版本**，由 UA/CH 生成器、TLS group 表、原型一致性 A/B diff、JA4 守卫完全一致地使用 | 把 `FingerprintProfile::chrome_version` 作为单一的 P0 产物暴露出来；所有需要版本一致的使用方都**读取**它，绝不重新推导。取自一个真实发布的 Chrome 构建（完整的四段版本号 + 从该构建采集的品牌列表排列顺序） | `…/common/fingerprinting/fingerprint_profile.cc`（`kPersonaChromeBuilds[]`） | code-browser 原创（堵住跨阶段的版本漂移缺口） | **P0** | 一旦漂移就是致命破绽：UA 说 Chrome X，TLS/原型/JA4 却按 Chrome Y → 与任何真实 Chrome 都对不上。冻结一个值，杜绝 4 个阶段之间的漂移。 |
| **code-browser-etld-token** | 全局种子 → 按 eTLD+1 的 128 位 `base::Token` | 仿照 Brave `CreateStableFarblingToken` 的 `DeriveSiteToken(seed, etld1)`：`high = PersistentHash(etld1) ^ seed; low = PersistentHash(high) ^ rotl(seed)`。eTLD+1 通过 `GetDomainAndRegistry(origin, INCLUDE_PRIVATE_REGISTRIES)` 得到。纯函数，不持久化任何按站点的元数据 | `net/base/registry_controlled_domains/registry_controlled_domain.h`、`components/content_settings/renderer/content_settings_agent_impl.h`、`components/content_settings/common/content_settings_agent.mojom`、`…/content_settings_manager.mojom` | brave-core `brave_shields_utils.cc` `GetFarblingToken` | **P0** | 确定性的：如果种子泄露给 JS，所有 token 都可预测、可关联：种子只能留在浏览器/渲染进程内部。必须按 eTLD+1 划分（`co.uk` 已处理，子域名共享 = 没有破绽）。 |
| **code-browser-mojom-token** | 线路：把按 eTLD+1 的 token 传给每个渲染帧 | 在每帧的 content-settings 结构中加入 `mojo_base.mojom.Token farbling_token`；在浏览器端的 `ContentSettingsManagerImpl` 中填充；在 `ContentSettingsAgentImpl` 上提供 getter | `…/content_settings_agent.mojom`、`…/content_settings_manager.mojom`、`…/content_settings_agent_impl.h`、`third_party/blink/public/platform/web_content_settings_client.h` | brave-core `shields_settings.mojom` | **P0** | 只在 IPC 内部。正确性：**默认零 token = 关闭 farbling**（`token.is_zero()`），所以 `chrome://`、扩展、`file://`、不透明源永远不加噪：给 WebUI 加噪是硬性破绽，还会搞坏浏览器界面。 |
| **code-browser-session-cache** *（== `farbling-seed-core`；只实现一次）* | 渲染端每个文档的种子持有者 + **每个**面都调用的 PRNG 工厂 | 把 `BraveSessionCache` 移植为 `code-browser::SessionCache`，一个 `GarbageCollected Supplement<ExecutionContext>`。从 `ContentSettingsClient->farbling_token()` 取 token，对匿名/credentialless iframe 再异或 StorageKey nonce 哈希。`MakePseudoRandomGenerator(FarbleKey)` → `randen_engine<uint64>`（已确认 abseil 中有），`seed = high^low^key`。逐个面的辅助函数：`PerturbPixels`（HMAC-SHA256）、音频微调、`FarbledInteger`。新增 `core/farbling/BUILD.gn` | `third_party/blink/renderer/core/execution_context/execution_context.h`、`…/platform/supplementable.h`、`…/platform/storage/blink_storage_key.h`、`…/platform/network/network_utils.h` | brave-core `brave_session_cache.{h,cc}` | **P0** | **这个文件就是引擎本身**：一个 bug 会污染所有面。(1) `randen_engine`+HMAC 的数学必须与 Brave 逐位一致；(2) 按 `ExecutionContext` 惰性创建，必须在 GC 后存活，否则值会闪变；(3) token 为零时直接短路。 |
| **code-browser-worker-seed** | 把 token 扩展到 Web/Shared/Service worker + Audio/Paint worklet | 让 `farbling_token` 经过 `GlobalScopeCreationParams` 传递；专用/共享 worker 在 `CreateWorkerContentSettingsClient` 注入，service worker 在 `embedded_worker_instance_client_impl.cc` 注入。`SessionCache::From(worker_scope)` 解析出同一个 token | `content/renderer/render_frame_impl.cc`、`…/workers/global_scope_creation_params.h`、`…/workers/worker_or_worklet_global_scope.h`、`content/renderer/service_worker/embedded_worker_instance_client_impl.cc` | brave-core `brave_session_cache.cc` 的 worker 分支 | **P0** | 如果遗漏风险很高：检测方会*在 Worker 内*运行 canvas/audio 探测，抓只在主线程伪装的实现。service worker 的 token 固定为注册所在的 eTLD+1，而不是顶层帧。 |
| **code-browser-disable-global-fingerprint** | **审计门禁（构建时）：** 消除 adryfish 的单一全局种子路径，让两套种子系统永不共存；让超级 cookie 不可能被发布 | 在 adryfish 142→149 落地后，把 adryfish 的 `FingerprintSeed()` 重定向到每个文档的 `SessionCache` 种子；把内联的全局种子读取替换为 `SessionCache::From(context).MakePseudoRandomGenerator(key)`。**加一个 `static_assert`/编译期守卫：只要还有任何面引用 adryfish 的全局种子访问符号，就让构建失败。** | `…/platform/network/network_utils.cc`、`content/renderer/render_thread_impl.h`、`…/execution_context/execution_context.h` | adryfish 全局访问器（RESEARCH.md 中没有：无法核实；已从引用中删除） | **P0** *（由 P1 提升）* | 门禁必须**在第一个 P0 面之前或与之同时**生效，而不是晚一个阶段：否则 P0 发布出去的就是超级 cookie。构建直接失败而不是警告。具体行号取决于移植了哪些 adryfish 面，但该补丁在 P0a、紧接着重放之后落地。 |

### 2.1 — canvas-webgl-gpu

> **GPU 归属（解决 §2.1 与 §2.5 之间的矛盾）：** 只有**一个**画像 GPU，定义在 `code-browser-persona-profile` 中，真实 Windows 部署时固定为 **Intel UHD 770 / ANGLE-D3D11**
> （无头运行时为 ANGLE-SwiftShader）。**`webgl-strings-coherent` 是 UNMASKED 字符串写入的唯一负责者**；屏幕领域原来的 `webgl-gpu-coherence` 并入这一行
> （它不再写字符串，只读取 `Current().gpu`）。不会有两个补丁写同一个 getter。

| 补丁 | 伪装对象 | 技术 | 真实目标文件 | 参考来源 | 优先级 | 检测风险说明 |
|---|---|---|---|---|---|---|
| **canvas2d-farble-perturb** | `getImageData`、`toDataURL`、`toBlob`/`convertToBlob`、`measureText` | 在每个读回出口执行 `PerturbPixels`：`canvas_key = HMAC-SHA256(token, pixels)`；用前 8 个字节作为种子 `v`；遍历 32 字节的 key，每字节 16 位，每一位选出 `channel=v%3`、`pixel=4*(v%count)+channel`，翻转最低位，再通过 LFSR 前进。依赖内容 + token → 不可见、按站点稳定、不可关联。挂钩 `getImageDataInternal` 的返回、`ToDataURLInternal` 编码前、`CanvasAsyncBlobCreator` 构造函数以及 OffscreenCanvas 路径。`measureText` 对步进宽度使用 `FarbledInteger` | `…/canvas2d/base_rendering_context_2d.cc`、`…/base_rendering_context_2d.idl`、`…/html/canvas/html_canvas_element.cc`、`…/html/canvas/canvas_async_blob_creator.cc`、`…/offscreencanvas/offscreen_canvas.cc`、`…/offscreencanvas2d/offscreen_canvas_rendering_context_2d.cc`、`…/imagebitmap/image_bitmap.cc` | brave-core `PerturbPixelsInternal` | **P0** | 只改最低位 = 低于视觉/统计检测阈值（Brave 已在生产中使用）。**必须**覆盖 OffscreenCanvas + worker。陷阱：`getImageData` 和 `toDataURL` 必须源自**同一个** token。绝不留空。 |
| **webgl-strings-coherent** *（UNMASKED 的唯一负责者；并入屏幕领域的 `webgl-gpu-coherence`）* | WebGL/WebGL2 `UNMASKED_VENDOR/RENDERER_WEBGL`，**以及内联的 `GL_VERSION`/`GL_SHADING_LANGUAGE_VERSION` 字符串**、`getSupportedExtensions`/`getExtension` | 把现有的 `kSpoofWebGLInfo` 钩子（已在 webgl base **4104-4105** 行确认）改为指向 `Current().gpu`：一个真实、内部一致的 **Intel UHD 770 / ANGLE-D3D11** vendor/renderer/驱动元组，与伪装的 UA/操作系统**以及渲染后端**一致。**同时覆盖 WebGL2 内联的 `GL_VERSION`（`webgl2_rendering_context_base.cc:4789`）和 `GL_SHADING_LANGUAGE_VERSION` 分支**，它们目前读取的是**真实的** `ContextGL()->GetString(GL_VERSION)`，会原样泄露 SwiftShader/ANGLE 后端版本。每个上下文一个 `WebGLFarbledExtensionHandler` | `…/webgl/webgl_rendering_context_base.cc`、`…/webgl2_rendering_context_base.cc`、`…/webgl_rendering_context_base.h`、`…/bindings/core/webgl/webgl_farbled_extension_handler.cc`（新增） | brave-core `GetWebGLDebugInfoValue` + camoufox `MaskConfig webGl` + adryfish/ungoogled `kSpoofWebGLInfo` 钩子 | **P0** | **被采集最多的面。** Brave 的随机 8 字符字符串本身就能识别出 Brave：code-browser 默认使用一个**自洽的**真实 Intel UHD 770 元组。评审正确的一点：UNMASKED *确实*会在 4987 行回落到 base（那里没有泄露），但 **WebGL2 `GL_VERSION` 内联读取真实后端，这才是本补丁现在堵上的真正泄露。** renderer 必须与读回哈希一致（一个 GPU）。 |
| **webgl-params-coherence** | 数值/数组型 `getParameter`：`MAX_TEXTURE_SIZE`、`MAX_VIEWPORT_DIMS`、`ALIASED_*_RANGE`、`MAX_*_UNIFORM_VECTORS`、`getShaderPrecisionFormat`、`getContextAttributes`、**`drawingBufferWidth/Height`、antialias/MSAA 采样数** | 用选出 renderer 字符串的**同一个 Intel UHD 770 档案**覆盖（例如 `MAX_TEXTURE_SIZE=16384`）。移植 Camoufox 的 `MaskConfig::GLParam`/`MParamGL`。固定着色器精度三元组 + 上下文属性（BotBrowser 模型）。**把 `drawingBufferWidth/Height` 和 `getContextAttributes().antialias` / 采样数加入枚举的 pname 集合**，使它们与伪装的 GPU 一致，而不是与真实后端的 MSAA 能力一致 | `…/webgl/webgl_rendering_context_base.cc`、`…/webgl2_rendering_context_base.cc`、`…/webgl_context_attribute_helpers.cc`、`…/webgl_shader_precision_format.cc` | camoufox `webgl-spoofing.patch` + BotBrowser `webglAttrs.diff` | **P1** | CreepJS / 指纹工具的 GPU 一致性检查会标记 `renderer` + 不可能的 `MAX_TEXTURE_SIZE`。为画像 GPU 提供一个精选的 `(renderer → 完整参数向量)` 元组。过度伪装（不可能的值）比不伪装更糟。 |
| **webgl-readpixels-farble** | 写入 ArrayBufferView 的 `readPixels()`（绕过 canvas2d 的等价 canvas 指纹） | 在 `ReadPixelsHelper` 中真实的 `ContextGL` `readPixels` 填充缓冲区之后，施加同样的 HMAC+LFSR 最低位扰动，按 eTLD+1 生成 key，受 WEBGL 级别控制。**对 `FLOAT`/`HALF_FLOAT` 帧缓冲：施加一个很小的相对 epsilon 扰动（而不是跳过）**，让浮点 FBO 请求不成为一条没有扰动的读回路径 | `…/webgl/webgl_rendering_context_base.cc`、`…/core/farbling/brave_session_cache.cc` | brave-core `BRAVE_WEBGL_…_RETURN`（Brave 置空；code-browser 扰动） | **P1** | Brave 在 MAXIMUM 级别**屏蔽** → 全零像素 = 可检测。code-browser **扰动**。评审修正：不要跳过浮点：把每个分量乘以按 token 生成的 `1 ± epsilon`（epsilon 远小于关心的 ULP），避免 NaN/Inf 的同时仍然扰动。像素哈希必须来自字符串所宣称的**同一块** GPU。 |
| **webgpu-adapter-farble** | `GPUAdapterInfo`：`vendor`、`architecture`、`device`、`description`、`driver` | 在 `CreateAdapterInfoForAdapter`（`gpu_adapter.cc:125`，已确认）中清理/覆盖，受按站点的 WEBGPU 级别控制，改写为来自喂给 WebGL 的**同一个 Intel UHD 770 档案**的值。像 Brave 的 `BraveScrubWebGpuAdapterInfo` 一样使用 `base::AutoReset`，但提供**真实字符串，而不是空值** | `…/webgpu/gpu_adapter.cc`、`…/gpu_adapter_info.cc`、`…/webgpu/gpu.cc` | brave-core `BraveScrubWebGpuAdapterInfo` | **P1** | Brave 清空字符串 = 可检测，并且与有值的 WebGL 不一致。code-browser 让 WebGPU vendor/arch 与**唯一的**画像 GPU 一致。不一致（WebGL=Intel，WebGPU=NVIDIA）= 强信号。 |
| **gpu-strings-source-coherence** | GPU 进程中的源头：`GPUInfo.gl_vendor/gl_renderer`，展示在 `chrome://gpu`、`GL_VERSION/VENDOR/RENDERER` 中 | 最深层的一致性：在 `gpu_info_collector.cc` 采集时改写 GPU 字符串，让 WebGL/WebGPU/`chrome://gpu`/`GL_VERSION` 全都源自同一条一致的记录 = 画像的 Intel UHD 770。**进程全局**（操作系统基线）；按站点的噪声在 Blink 补丁中叠加 | `gpu/config/gpu_info_collector.cc`、`gpu/config/gpu_info.h`、`gpu/command_buffer/client/gles2_implementation.cc`、`…/service/gles2_cmd_decoder.cc` | code-browser 原创（camoufox 的取值表 + BotBrowser 的档案概念） | **P2** | 正确时起保护作用。风险：`gpu_info_collector` 的结果会用于 GPU 黑名单/驱动规避方案的选择：让 `deviceID/vendorID/driver_version` 保持在真实发布过的 Intel UHD 770 组合内。之所以是 P2，是因为 Blink 补丁已经覆盖了网页可见面。 |

### 2.2 — audio

> **状态：这里的加噪行是有意没有实现的。** 在每个构建中，音频采样（`getChannelData`、`copyFromChannel`、analyser、离线渲染）都与 Chromium 计算的结果完全一致，
> 所以它们与同一台机器上的原版 Chrome 相同；按种子加噪会产生真实 Chrome 不可能输出的值。`audio-context-metadata-spoof` 只有一部分以 `patches/020-audio.patch` 的形式发布：
> 画像默认的 `sampleRate`、`baseLatency` 和 `outputLatency`。继承自 adryfish 的帧数和采样率噪声在该补丁中被关闭。

| 补丁 | 伪装对象 | 技术 | 真实目标文件 | 参考来源 | 优先级 | 检测风险说明 |
|---|---|---|---|---|---|---|
| **audio-buffer-farble** *（采样路径的唯一主噪声源）*，**未实现** | `AudioBuffer.getChannelData()` / `copyFromChannel()`：主要的 AudioContext 指纹 | 给两者加上 `ScriptState`（已确认：`getChannelData` 目前没有 ScriptState）；在读取处 `value *= fudge_factor`，其中 `fudge = 0.999 + (token.high/UINT64_MAX)/1000`，按 eTLD+1。**只修改 JS 可见的副本**，不动内部 DSP | `…/webaudio/audio_buffer.cc`、`…/audio_buffer.h`、`…/audio_buffer.idl` | brave-core `audio_buffer.*.patch` | **P0** | 如果微调约 0.1% 且按 eTLD+1 稳定，风险低（CreepJS 会探测两次：漂移可被检测）。不得触碰内部渲染路径。 |
| **audio-analyser-farble**，**未实现** | `getFloat/ByteFrequencyData`、`getFloat/ByteTimeDomainData` | 在 `RealtimeAnalyser` 中加入 `std::optional<CodeBrowserAudioFarblingHelper>` 成员，在 `AnalyserHandler` 构造函数中用**与 audio-buffer-farble 相同的 token/微调值**初始化；在 4 个读取函数做 dB/字节转换之前短路 | `…/webaudio/realtime_analyser.cc`、`…/realtime_analyser.h`、`…/analyser_handler.cc` | brave-core `realtime_analyser.cc.patch` | **P1** | **单一来源保证：** analyser 与 buffer 的加噪必须从同一个 token 读取同一组共享的 `(seed, fudge)`，否则 CreepJS 的双重探测会看到离线 ≠ 实时 = 可检测的不一致。 |
| **audio-farbling-helper**，**未实现** | 共享的按种子噪声原语（不是一个面） | 新增 `PLATFORM_EXPORT CodeBrowserAudioFarblingHelper(fudge, seed, max)`：默认 = 乘法；MAXIMUM = 63 位 Galois LFSR → `v/UINT64_MAX/10`。seed/fudge 来自按 eTLD+1 的 token（`high→fudge`、`low→seed`）。**这一个辅助实例由 buffer + analyser + 离线隔离共享** | `…/platform/audio/code_browser_audio_farbling_helper.{cc,h}`、`…/platform/BUILD.gn` | brave-core `brave_audio_farbling_helper.{cc,h}` | **P0** | 内部的。LFSR/微调的数学与参考实现逐字节一致；单一共享的种子来源避免了评审指出的三条路径各自偏离。 |
| **audio-context-metadata-spoof**，**部分实现**（`020-audio.patch`：`sampleRate`、`baseLatency`、`outputLatency`；没有 `maxChannelCount`，也没有渲染速率检查） | `sampleRate`、`baseLatency`、`outputLatency`、`maxChannelCount` | 用画像值替换基于权限的延迟量化；构造函数把 `profile.audio_sample_rate` 传给 `RealtimeAudioDestinationNode::Create`；`MaxChannelCount()` 返回画像值。**断言 OfflineAudioContext 确实以伪装的 `sampleRate` 渲染**（在离线目标节点中加一个渲染速率检查），让 `sampleRate` getter 与真实渲染速率一致。每个画像固定 | `…/webaudio/audio_context.cc`、`…/audio_context.h`、`…/base_audio_context.cc` | chromiumfish `webaudio.patch` + camoufox | **P1** | `baseLatency` 不是 `128/sampleRate` 的倍数 = 破绽。评审修正：伪装的速率必须是 OfflineAudioContext 真正渲染所用的速率，而不只是 getter 的值。 |
| **offline-audio-render-isolation**，**未实现** | OfflineAudioContext 的渲染输出（针对非 `getChannelData` 读取的 DynamicsCompressor 探测） | 在 `DoOfflineRendering` 中、复制到 `shared_render_target_` 之前，**使用与 audio-buffer-farble 相同的共享辅助/种子**运行 `IsolateAudioSamples(channel, frames_processed_, seed)`：把 `frames_processed_` 作为全局偏移传入。Win 构建：无条件启用，受音频级别控制。**仅作为 buffer-farble 未覆盖的读取的后备**；两者共享一个种子，所以总和永远不会偏离范围 | `…/webaudio/offline_audio_destination_handler.cc`、`…/offline_audio_context.cc` | chromiumfish `webaudio.patch`（`IsolateAudioSamples`） | **P2** | 单一共享种子消除了重复加噪的风险（评审）。**不要**照搬 chromiumfish 那种脆弱的、硬编码 Win 目标总和的增量吸收：只用统一的按种子乘法。 |

### 2.3 — fonts

| 补丁 | 伪装对象 | 技术 | 真实目标文件 | 参考来源 | 优先级 | 检测风险说明 |
|---|---|---|---|---|---|---|
| **font-allowlist-win-persona** *（是一个分布，而不是一个标准集合）* | 供 CSS 字体族探测的已安装字体列表：真实的 Win10/11 集合，**按画像从加权分布中抽取** | 引擎允许列表（仿照 Cromite `bromite_allowed_fonts.h`）：`kAllowedFontNames` 基础 + **按画像从种子中抽取的加权叠加变体：`stock`、`stock+Office（约 200 个字体）`、`stock+Adobe`、`stock+OEM`**，让整批实例呈现真实的字体数量熵，而不是一个过于干净的集群。基于 `--lang` + `IsFontAllowed()` 按区域划分的文字子列表。在 `FontCache::CreateTypeface`（Win 路径）中做门控；通过新增的 `skia::DWriteFontTypeface_GetGDIFamilyName` 解析真实 GDI 名称。`@font-face` 绕过 | `…/fonts/skia/font_cache_skia.cc`、`…/fonts/win/font_cache_skia_win.cc`、`…/fonts/font_cache.h`、`…/fonts/skia/code_browser_allowed_fonts.h`（新增）、`skia/ext/skia_utils_win.{cc,h}`、`…/platform/BUILD.gn` | Cromite `Fonts-fingerprinting-mitigation.patch` + chromiumfish `font-substitution.patch` | **P0** | 评审修正：*单一*的标准纯原装集合本身就是一个狭窄、可识别的群组（CreepJS 会对字体列表熵打分）。按画像的变体叠加恢复了真实世界的差异。DWrite 代理计数仍须与 CSS 探测计数一致地门控。 |
| **font-access-api-filter** | `queryLocalFonts()` 枚举 + DWrite 代理的字体族数量/名称 | 在浏览器端用**同一个按画像的允许列表变体**过滤枚举；钳制 `GetFamilyCount`/`GetFamilyNames`。丢弃不在允许列表中的 `FontMetadata`；屏蔽非画像的 PostScript/全名。返回顺序与真实 DWrite 枚举一致 | `content/browser/font_access/font_access_manager.cc`、`…/modules/font_access/font_access.cc`、`…/font_access/font_metadata.cc`、`content/browser/renderer_host/media/dwrite_font_proxy_impl_win.cc` | 扩展了 Cromite 的门控逻辑（code-browser 原创） | **P0** | 如果 `queryLocalFonts`/CSS 探测/DWrite 计数相差一个字体族 = 强信号。三者都来自**同一个**选定的按画像变体。 |
| **font-metrics-jitter-pertld** | `measureText()` 宽度、边界框、em 高度、基线、字形步进 | 在唯一的汇聚点 `harfbuzz_shaper.cc:288-295` 向 HarfBuzz `pos->x_advance` 加入按 eTLD+1 确定的亚像素偏移，增量 `≤0.1px`，由 `hash(eTLD+1 ⊕ session_token ⊕ glyph_id ⊕ family)` 得到。`measureText` 和布局都使用这些步进 → 一致 | `…/fonts/shaping/harfbuzz_shaper.cc`、`…/html/canvas/text_metrics.cc`、`…/fonts/simple_font_data.cc`、`…/fonts/font_metrics.h` | camoufox `anti-font-fingerprinting.patch`，改为按 eTLD+1 | **P0** | 抖动小且量化。**只作用于字形整形**，所以 `measureText`/`getClientRects`/`scrollWidth` 一致。种子不是全局的。（非文本矩形见 `element-rect-jitter`。） |
| **element-rect-jitter-pertld** *（新增：覆盖非文本的 ClientRects 面）* | **非文本元素**的 `getBoundingClientRect`/`getClientRects` 亚像素值 + CSS transform 精度 | 在布局→DOMRect 的边界（`layout_object.cc` 矩形映射 / `dom_rect_read_only.cc`）施加按 eTLD+1 确定的亚像素量化，使用与 font-metrics-jitter **相同的 token**，让文本和元素矩形彼此一致。增量 ≤0.05px，按站点稳定 | `…/layout/layout_object.cc`、`…/geometry/dom_rect_read_only.cc`、`…/dom/element.cc` | camoufox 矩形抖动的思路，改为按 eTLD+1（code-browser 原创扩展） | **P2** | 评审修正：字体抖动只覆盖了文本步进；指纹工具还会对非文本元素矩形 + transform 精度计算哈希。增量太大会破坏布局断言；保持 ≤0.05px 并与文本抖动共享种子。 |
| **font-fallback-mac-skip** | 从 CSS 层叠中移除 macOS/Linux 字体族名（Helvetica/Menlo/Apple\*/Hiragino\*/PingFang\*/DejaVu\*） | 在 `FontFallbackList::GetFontData` 循环中跳过拒绝列表中的字体族。`GetLastResortFallbackFont` 通过直接调用 `FontCache::GetFontData()` 绕过循环（不会 SIGSEGV）。激进的拒绝列表放在严格门控**之外**（来自 chromiumfish 崩溃的教训） | `…/fonts/font_fallback_list.cc`、`…/fonts/alternate_font_family.h`、`…/fonts/skia/code_browser_allowed_fonts.h` | chromiumfish `font-substitution.patch` | **P1** | 拒绝列表不完整 → 宿主操作系统的字体名泄露；拦得太多 → 最后回退字体饿死 → 崩溃。确认在 Win 上最后回退确实绕过了循环。 |
| **font-disable-local-src-match** | `@font-face src:local()` 侧信道 + Android 可下载字体匹配 | **按允许列表门控**（允许画像本地字体，拒绝其余），而不是整体禁用：让 `local()` 唯一字形查找（`kLocalUniqueFace`）经过 `IsFontAllowed()`；禁用 `AndroidDownloadableFontsMatching` | `…/fonts/win/font_cache_skia_win.cc`、`…/public/common/features.cc`、`…/runtime_enabled_features.json5` | Cromite 特性禁用 + camoufox `font-hijacker.patch` | **P1** | 整体禁用是可观测的（在 Win UA 下已知的本地字体无法解析）。优先按允许列表门控。 |
| **bundle-windows-metric-fonts** | 在非 Win 的构建/测试主机上，用磁盘上的文件支撑允许列表中的字体名，使度量与 Win 一致 | 在 third_party 下附带开源克隆字体（Arimo→Arial、Tinos→Times、Cousine→Courier、Carlito→Calibri、Caladea→Cambria、ComicRelief→Comic Sans、OpenSans）；注册它们，让字体名解析到度量各异的文件 | `third_party/code_browser_windows_fonts/`、`…/fonts/alternate_font_family.h`、`chrome/browser/BUILD.gn` | chromiumfish `lean-windows-fonts.patch` | **P2** | 在真实 Win 主机上它必须**不起作用**（优先使用操作系统字体），否则会替换掉真实的度量 = 破绽。仅作为测试一致性/交叉编译的安全网。 |

### 2.4 — navigator-ua-automation

| 补丁 | 伪装对象 | 技术 | 真实目标文件 | 参考来源 | 优先级 | 检测风险说明 |
|---|---|---|---|---|---|---|
| **navigator-ua-clienthints** | `navigator.userAgent`、UA 请求头、`platform`、`appVersion`、`userAgentData`（全套）、全部 11 个 `Sec-CH-UA*`，**高熵 `getHighEntropyValues` 的划分 + `Sec-CH-UA-Full-Version-List` 品牌列表的排列顺序** | 让每个值都通过读取 **`code-browser-persona-version-freeze`** 的 `fingerprinting::Current()`：`GetUserAgentBrandList`/`GetProductAndVersion`/`GetUnifiedPlatform`/`GetPlatformForUAMetadata`/`GetPlatformVersion`/`GetCpuArchitecture`/`GetCpuBitness`/`GetUserAgentMetadata` → 画像；`GetReducedNavigatorPlatform()` → 画像。**把 GREASE 品牌列表的排列固定为冻结的画像 Chrome 构建实际发布的顺序**（记录在 `kPersonaChromeBuilds` 中），并把低熵/高熵提示的划分固定为该构建的划分 | `components/embedder_support/user_agent_utils.cc`、`…/execution_context/navigator_base.cc`、`…/frame/navigator_id.cc`、`…/frame/navigator_ua_data.cc`、`services/network/public/cpp/client_hints.cc` | chromiumfish `navigator.patch` + camoufox `navigator-spoofing.patch` | **P0** | 致命破绽 = UA 与 CH 不一致、或 UA 与 `platform` 不一致：通过统一来源于冻结版本消除。评审修正：GREASE/完整版本列表的顺序以及高熵划分现在具体固定为某个真实构建的排列，而不是留作"风险"。 |
| **webdriver-automation-scrub** | `navigator.webdriver`→false；移除 `AutomationControlled` 自动启用、`Headless` UA 标记、自动化信息栏 | 移除 `runtime_features.cc` 中 4 处 `AutomationControlled`（`kEnableAutomation`/`kHeadless`/`kRemoteDebuggingPipe`/`--remote-debugging-port==0`）；消除 `probe::ApplyAutomationOverride` 的作用；删除 `product.insert(0,"Headless")`；屏蔽 `automation_infobar_delegate`；在 Linux 构建上重新启用 WebShare | `content/child/runtime_features.cc`、`…/frame/navigator.cc`、`components/embedder_support/user_agent_utils.cc`、`chrome/browser/ui/startup/automation_infobar_delegate.cc`、`chrome/renderer/chrome_content_renderer_client.cc` | BotBrowser `removeHeadless.diff` + chromiumfish `navigator.patch` + rebrowser/patchright | **P0** | `webdriver===false` 是必须的。**`cdc_` 不在引擎中**（只存在于 chromedriver）：没有可清理的。不要过度屏蔽，以免与干净的消费级 Chrome 产生差异。 |
| **hardware-concurrency-coherent** *（已合并：navigator HC == screen HC；唯一调用点的唯一负责者）* | `navigator.hardwareConcurrency`（+ Worker） | 把 `NavigatorConcurrentHardware::hardwareConcurrency()` 覆盖为 `Current().hardware_concurrency`。**一个补丁，一个调用点**（替换同一行上 adryfish `--fingerprint-hardware-concurrency` 的读取：不要叠加第二个写入者）。覆盖主线程 + worker + SW | `…/frame/navigator_concurrent_hardware.cc` | chromiumfish `fingerprint-profile.patch` + camoufox | **P0** | 评审修正：navigator 和 screen 两份规格都指向这一个位置：现在只有**一个**负责者。通过画像与内存/GPU 按档次关联。 |
| **device-memory-coherent** *（已合并：navigator == screen 的内存部分；单一来源）* | `navigator.deviceMemory`（+ Worker）+ `Sec-CH-Device-Memory` | 在 `CalculateAndSet…` 之前用画像设置 `ApproximatedDeviceMemory::physical_memory_mb_`，让 **JS 值和 CH 请求头来自同一来源而一致**（而不是两个 getter）。遵守 `kUpdatedDeviceMemoryLimitsFor2026`（2.0–32.0 GB 钳制）；值必须在钳制后保持不变 | `…/frame/navigator_device_memory.cc`、`…/common/device_memory/approximated_device_memory.cc` | chromiumfish `fingerprint-profile.patch` + Brave deviceMemory farbling | **P0** | 评审修正：三个潜在写入者（navigator、screen、adryfish 开关）合并为一个按档位取值的来源补丁。消除了 JS 与 CH 的分歧。 |
| **navigator-prototype-coherence** | Navigator/Element/window 原型形态 + 封闭 Shadow DOM | 在 `LocalWindowProxy::Initialize()` 中，只删除在 149 构建中存在、但在**冻结的画像 Chrome**（`code-browser-persona-version-freeze`）中不存在的属性：**与那个确切构建做 A/B diff，每次升级都重新验证**。恢复封闭 shadow 的语义，使 `attachShadow({mode:'closed'})` → `.shadowRoot===null` | `…/bindings/core/v8/local_window_proxy.cc`、`…/dom/events/event_target.idl`、`…/dom/element.cc`、`…/dom/element.idl` | chromiumfish `navigator.patch`（已 A/B 验证） | **P2** | 评审修正：A/B diff 的目标现在固定为 UA 所宣称的**同一个冻结版本**，所以裁剪后的形态绝不会因跨阶段漂移而变成"不像任何真实 Chrome"。删除尽量少，并且只作用于主世界。 |
| **permissions-api-state-coherence** *（新增）* | camera/mic/geolocation/notifications 的 `navigator.permissions.query()` 状态必须与伪装的媒体设备 + 地理位置一致 | 覆盖 `PermissionStatus` 的解析，让查询到的状态与实际权限状况一致：授权前 → camera/mic/geo 为 `prompt`（而不是 `granted`）；授权后 → `granted`。确保 Permissions API 不与设备列表/地理位置伪装相矛盾 | `…/permissions/permission_status.cc`、`…/modules/permissions/permissions.cc`、`content/browser/permissions/permission_controller_impl.cc` | code-browser 原创（堵住一个跨面一致性缺口） | **P1** | 评审修正（缺失的面）：站点会交叉检查 `permissions.query({name:'camera'})` 与 `enumerateDevices` 的标签以及 `getUserMedia` 的结果。如果设备显示了有内容的标签，而权限读出来是 `prompt`，这就是矛盾：本补丁让它们保持一致。 |

### 2.5 — screen-hardware

> **GPU 说明：** 屏幕领域不再写 WebGL 字符串。唯一的画像 GPU（Intel UHD 770 / ANGLE-D3D11）位于 `code-browser-persona-profile` 中；WebGL 字符串只由 `webgl-strings-coherent`（§2.1）负责。
> 屏幕补丁只为一致性检查而**读取** `Current().gpu`。

| 补丁 | 伪装对象 | 技术 | 真实目标文件 | 参考来源 | 优先级 | 检测风险说明 |
|---|---|---|---|---|---|---|
| **screen-display-spoof** | `screen.{width,height,availWidth,availHeight,availLeft,availTop,colorDepth,pixelDepth}` + Screen Details `{left,top}` | 在 `screen.cc` 中把 `GetRect(false/true)` + `colorDepth()/pixelDepth()` 替换为画像字段；`screen_detailed.cc` `left()/top()=0`（单屏）；`isExtended()=false` | `…/frame/screen.cc`、`…/frame/screen.h`、`…/screen_details/screen_detailed.cc` | chromiumfish `display.patch` + camoufox `screen-spoofing.patch` | **P0** | 保持 Brave 浏览器测试的不变量：`screen.width≥outerWidth`、`availWidth≥innerWidth`、`width-availWidth` 是合理的任务栏差值（约 40px）。 |
| **screeninfo-source-override** *（骨干：与叶子访问器同时或略早落地）* | 在唯一的上游源头覆盖 `display::ScreenInfo`（rect、available_rect、depth、DSF、is_extended）→ `screen.*`、CSS device-*、`outerWidth/Height`、Screen Details 全部一致 | 按 `Current()` 覆盖返回给 Blink 的 `ScreenInfo`（渲染端副本，IPC 之后）。一处覆盖传播到所有地方 | `ui/display/screen_info.h`、`…/css/media_values.cc`、`…/frame/local_dom_window.cc`、`content/renderer/render_widget` | chromiumfish `display.patch` + camoufox `GetDeviceSurfaceDimensions` | **P0** *（由 P1 提升；排在叶子补丁之前）* | 评审修正：骨干必须先于或伴随叶子补丁（`screen-display-spoof`、`media-query-device-coherence`），这样叶子补丁永远不会重复应用，也不会在阶段间隔中出现不一致。做对了 = 检测风险最低（一切都一致）。 |
| **media-query-device-coherence** | CSS 媒体特性：`device-width/height`、`resolution`/DPR、`color`、`dynamic-range`、`color-gamut`、`pointer`/`hover`、`prefers-*` | `CalculateDeviceWidth/Height` → `Current().screen_*`（**堵住已确认的 `media_values.cc:165-184` 泄露**，那里直接读取 `screen_info.rect`）；强制 `Primary/AvailablePointerType=kPointerFineType`、`HoverType=kHoverHoverType`；DPR/ColorBits(8)/Gamut(sRGB) 经由画像。**`prefers-color-scheme` 和 `prefers-reduced-motion` 按画像从加权分布中抽取（约 45% 深色、约 8% 减少动画），而不是固定为标准值** | `…/css/media_values.cc`、`…/media_values_cached.cc`、`…/media_values_dynamic.cc` | chromiumfish `display.patch`；`CalculateDeviceWidth/Height` 的修复是 code-browser 原创 | **P0** | `CalculateDeviceWidth/Height` 泄露是**本清单最重要的一项发现**（已确认）。评审修正：强制*每个*画像都用浅色/无偏好，会造成一个可关联的"零深色模式"群组：现在按画像加权，让整批实例的媒体特性向量与总体统计一致。 |
| **hardware-concurrency-memory-coherence** | *（并入 navigator 的 `hardware-concurrency-coherent` + `device-memory-coherent`，见 §2.4；这一行是档次关联规则，而不是第二个写入者）* | `FingerprintProfile` 从一个 `kHwTiers` 档次中抽取 `(核数、内存)`，让合并后的 navigator 补丁输出与档次相关的值。屏幕侧不写 navigator getter | `…/common/fingerprinting/fingerprint_profile.cc` | chromiumfish kHwTiers | **P0** | 评审修正：消除了重复写入者的冲突：屏幕贡献*分布约束*，navigator 负责 *getter*。Worker 报告相同的值（没有闪变）。 |

### 2.6 — tls-network

> **根据评审重新定位。** 已在原版 149 中确认：`kTlsMldsaSignatures` 和 `kTLSTrustAnchorIDs` **已经是 `FEATURE_DISABLED_BY_DEFAULT`**；`ssl_client_socket_impl.cc:794`
> 已经走经典的 `kVerifyPrefs[]`（没有 ML-DSA）分支，871 行的 Trust Anchor IDs 代码块也已经是死代码。所以原版 149 的 JA4 **已经与真实 Chrome 149 一致**。
> 因此这些是**以画像版本为键的回归守卫**，而不是主动的"翻转"：并且明确避免硬编码经典分支，因为那会与真实 149 能完成的、由服务器触发的后量子握手不同步。
> 真正的工程工作是**与 UA 生成器协调、可按版本选择的 group 表**（`code-browser-persona-version-freeze`）。

| 补丁 | 伪装对象 | 技术 | 真实目标文件 | 参考来源 | 优先级 | 检测风险说明 |
|---|---|---|---|---|---|---|
| **tls-sigalgs-version-guard** | `signature_algorithms` 扩展与画像版本一致 | **回归断言，而不是翻转：** 确认 adryfish 的移植没有打开 `kTlsMldsaSignatures`。如果画像宣称 ≤148，仅经典的分支（已是默认）就是正确的；如果画像宣称 149+，而真实 149 在触发型握手中*会*提供 ML-DSA，就把该特性保持为真实 149 的默认值，而不是硬编码经典分支。由冻结的画像版本驱动 | `net/base/features.cc`、`net/socket/ssl_client_socket_impl.cc` | （RESEARCH.md 中没有：已删除引用；已对照原版 149 验证） | **P1** *（由 P0 降级：作为"翻转"它是空操作）* | 评审修正："ML-DSA 的存在是 1 比特就能看出不是真 148 的破绽"这一说法是反的：原版 149 默认也不提供它。风险在于硬编码会*引入*不同步；这个守卫防止这一点。 |
| **tls-trust-anchor-ids-guard** | Trust Anchor IDs 扩展的一致性 | **回归断言：** 确认 `kTLSTrustAnchorIDs` 保持禁用，`ssl_client_socket_impl.cc:871` 处的 `SSL_set1_requested_trust_anchors` 代码块保持为死代码（它以 `ssl_config_.trust_anchor_ids.has_value()` 为条件，只有在被禁用的特性打开时才会填充）。原版中不需要删除；只需断言移植没有造成回归 | `net/socket/ssl_client_socket_impl.cc`、`net/ssl/ssl_config_service.cc`、`net/base/features.cc` | （已对照原版 149 验证） | **P1** *（由 P0 降级）* | 评审修正：原版 149 已经不发送这个扩展 → 已经与真实 149 一致。没有必要删除代码；唯一的失效模式是 adryfish 移植把它打开了，这个守卫能抓到。 |
| **tls-supported-groups-keyshare-version-table** *（真正的 TLS 工作）* | `supported_groups`（0x000a）+ `key_share`（0x0033）：曲线列表 + 后量子 group（X25519MLKEM768 与 Kyber768Draft00 0x6399） | 让 `kDefaultSSLSupportedGroups[]` **可按版本选择，由 `code-browser-persona-version-freeze` 驱动**，使 `{group_id, send_key_share}` 与所宣称的 Chrome 版本完全一致。较新的画像：MLKEM768；较旧的画像：Kyber768Draft00 或不带后量子 | `net/ssl/ssl_config_service.cc`、`net/socket/ssl_client_socket_impl.cc` | adryfish 网络一致性 + 来自画像的版本表 | **P0** | **硬性依赖冻结的画像版本**（评审：这里"独立子树、不依赖种子"的说法是错的）。后量子 group 与 UA 不一致 = 精确的 JA4 破绽。一张版本表，与 UA 生成器共享。 |
| **tls-cipher-grease-version-guard** | cipher_suites 顺序、GREASE 位置、仅 brotli 的 `compress_certificate`（0x001b）、ALPS 码点 | 验证/守卫 BoringSSL 默认值仍能复现**冻结的画像 Chrome**：从不设置 `disable-grease-tls`，没有 zstd/zlib 证书压缩，`SSL_set_alps_use_new_codepoint` 与画像版本一致。**提前到 P1，让版本一致性在其余补丁栈之前（而不是之后）就被强制执行** | `net/socket/ssl_client_socket_impl.cc`、`net/ssl/cert_compression.cc`、`net/base/features.cc` | 画像版本表 + 149 默认值验证 | **P1** *（由 P2 提升）* | 评审修正：一个用来抓 UA 与 TLS 版本漂移的 P2 守卫落地太晚。提升后，JA4 与 UA 的检查与 UA 生成器处在同一批次。 |
| **http2-settings-frame-pin** | H2 SETTINGS（即 H2 指纹）：取值 + 线上顺序、WINDOW_UPDATE 增量、伪首部顺序 | 锁定 `AddDefaultHttp2Settings`（ENABLE_PUSH=0、HEADER_TABLE_SIZE=65536、INITIAL_WINDOW_SIZE=6291456、MAX_HEADER_LIST_SIZE=262144）+ `kSpdySessionMaxRecvWindowSize=15MB`（增量=15663105）。保持 `enable_http2_settings_grease=false`。伪首部顺序 `:method,:authority,:scheme,:path` 不动 | `net/http/http_network_session.cc`、`…/http_network_session.h`、`net/spdy/spdy_session.cc`、`net/spdy/spdy_http_utils.cc` | BotBrowser ADVANCED_FEATURES + 149 验证 | **P0** | 原版 = Chrome。风险 = 下游补丁/代理重排 SETTINGS 或启用 H2 grease → 产生一个没有真实 Chrome 会产生的 H2 指纹。锁定并守卫。 |
| **udp-over-socks5-tunnel** *（经 SOCKS5 的 UDP 的**唯一**实现，见 §4 的统一说明）* | 浏览器**所有** UDP（STUN/TURN/媒体 + QUIC/H3）都经 SOCKS5 UDP ASSOCIATE 出站：外部看到的是代理出口 IP，而不是 VPS 的 IP | 新增 `net::Socks5UdpClientSocket`（RFC 1928 UDP ASSOCIATE；已确认原版 `socks5_client_socket.cc` 中没有）。通过 `SOCKSConnectJob` 建立 TCP 控制连接，解析 BND.ADDR/PORT，封装数据报。**统一的接线点：当代理 `is_socks5()` 且支持 UDP 时，在 `CreateDatagramClientSocket()` 分派处（`socket_manager.cc:315`）接入**；QUIC 通过 `quic_session_pool.cc`（与现有的 `quic_proxy_datagram_client_socket.cc` 并列）。受开关控制 + 自动检测并带回退（代理不支持 UDP 时禁用 QUIC + 强制 ICE 只用中继） | `net/socket/socks5_client_socket.cc`、`net/socket/socks_connect_job.cc`、`net/socket/udp_client_socket.cc`、`services/network/p2p/socket_udp.cc`、`services/network/p2p/socket_manager.cc`、`net/quic/quic_session_pool.cc` | BotBrowser ADVANCED_FEATURES（重新实现）；仿照 Chromium 自己的 `quic_proxy_datagram_client_socket.cc` | **P0** | **价值最高的差异点。** 评审修正：之前的两份规格（`udp-over-socks5-quic-stun-tunnel` + `udp-over-socks5-tunnel`）在接线点上不一致：**统一为 `CreateDatagramClientSocket` 分派处**。只实现一半 → QUIC 泄露真实出口（比直接禁用更糟）；需要做 RTT/抖动一致性测试。 |

### 2.7 — webrtc-proxy

| 补丁 | 伪装对象 | 技术 | 真实目标文件 | 参考来源 | 优先级 | 检测风险说明 |
|---|---|---|---|---|---|---|
| **webrtc-ip-handling-default-deny** | ICE 收集策略 → 强制为 `disable_non_proxied_udp`；永远不收集带真实 VPS/局域网 IP 的 host+srflx 候选 | 修改 `ToWebRTCIPHandlingPolicy()` 的兜底分支 → `kDisableNonProxiedUdp`（Cromite 的改动）；在 `peer_connection_dependency_factory.cc:1074-1095` 钳制 switch，使 `kDefault` 永远无法把 `enable_nonproxied_udp/multiple_routes` 设为 true。引擎常量 | `…/peerconnection/webrtc_ip_handling_policy.cc`、`…/peerconnection/peer_connection_dependency_factory.cc`、`chrome/browser/ui/browser_ui_prefs.cc`、`chrome/browser/renderer_preferences_util.cc` | Cromite `webRTC-do-not-expose-local-IP-addresses.patch` + chromiumfish | **P0** | **必须与 `mdns-local-ip-coherence` 在同一阶段发布**（评审）：默认拒绝且没有 TURN 时会得到零个候选 ≠ 真实 Chrome 的 `.local` host 候选，在间隔期内，这个异常的空集合本身就可被检测。 |
| **mdns-local-ip-coherence** *（提升为 P0：与默认拒绝一同发布）* | 本地 IP 的 host 候选 → 混淆后的 `<uuid>.local`（真实桌面 Chrome 的默认行为），而不是原始局域网 IP 或**缺失** | 强制启用 `kWebRtcHideLocalIpsWithMdns` + `MdnsResponderAdapter`，让 `allow_mdns_obfuscation` 无条件为 true；按 eTLD+1 确定的 `.local` UUID（按会话/站点稳定，不可跨站关联）；与默认拒绝协调，使恰好出现一个 mDNS host 候选 | `…/peerconnection/peer_connection_dependency_factory.cc`、`…/platform/p2p/mdns_responder_adapter.cc`、`…/platform/p2p/filtering_network_manager.cc` | 上游 `kWebRtcHideLocalIpsWithMdns` 加固为始终开启 + Brave 风格的带种子 UUID | **P0** *（由 P2 提升）* | 评审修正：在默认拒绝之后隔两个阶段才发布 mDNS，会在中间留下一个异常的空候选集合。一同发布时候选集合永远不为空：始终会发出一个合理的 `.local` host 候选。 |
| **socks5-credentialed-and-dns-in-proxy** | DNS 出站（socks5h：ATYP=域名，在隧道内解析）+ SOCKS5 用户名/密码（RFC 1929） | (1) socks5h 模式（转发主机名，抑制本地解析）；已解析 IP 的分支只用于被绕过的主机。(2) 在问候中提供方法 0x02（已确认目前在 255 行硬编码为 `{0x05,0x01,0x00}`）+ RFC 1929 子协商，凭据来自 `--proxy-server`。(3) 显式的环回/RFC1918 绕过，让本地服务在本地解析 | `net/socket/socks5_client_socket.cc`、`net/socket/socks_connect_job.cc`、`net/proxy_resolution/configured_proxy_resolution_service.cc`、`net/base/proxy_server.h`、`net/dns/host_resolver_manager.cc`、`net/dns/context_host_resolver.cc` | BotBrowser CLI_FLAGS + adryfish README 中的缺口 | **P0** | 低。socks5h + 带凭据的 SOCKS5 是标准做法，页面侧无法检测；消除了 ISP 侧的 DNS 泄露。保留显式的环回绕过。 |
| **ice-candidate-sdp-stats-spoof** | SDP `a=candidate`、`RTCIceCandidate.address`、foundation/relatedAddress、`RTCIceCandidateStats.address` 中残留的 IP/主机 | 在 `rtc_ice_candidate.cc` + `onicecandidate` 分派 + SDP 改写处拦截候选的输出；把 IP 替换为按 eTLD+1 的 farbling 种子值；在报告构建器中清理 `getStats()`。保留环回/mDNS（仿照 camoufox 的 `isSpecialIP`）。**三个面（SDP、`.address`、`getStats()`）用同一个值一致地改写** | `…/peerconnection/rtc_ice_candidate.cc`、`…/rtc_peer_connection.cc`、`…/rtc_session_description.cc`、`…/rtc_ice_candidate.idl` | camoufox `webrtc-ip-spoofing.patch`，从 Gecko 移植到 Blink | **P1** | 在默认拒绝 + mDNS 一同发布的情况下，它主要加固中继地址 + 统计信息。恒定/不合理的伪装 IP 本身就是破绽：三个面使用相同的按 eTLD+1 的值。 |

### 2.8 — geo-media-sensors

| 补丁 | 伪装对象 | 技术 | 真实目标文件 | 参考来源 | 优先级 | 检测风险说明 |
|---|---|---|---|---|---|---|
| **timezone-native-pin** | navigator/Date/Intl 时区 + ICU 国家代码：原生固定（不用 CDP 覆盖开关） | 把 `timezone_controller.cc` 中的 `GetCurrentTimezoneId()`/`host_timezone_id_` 替换为启动时的 `--code-browser-timezone`，让 `SetIcuTimeZoneAndNotifyV8` 把它当作真正的 ICU 默认值；在 `icu_util.cc:328` + 宿主侧 `timezone.cc` 中强制 ICU 采用。不会出现 `HasTimeZoneOverride()==true` 的破绽 | `…/core/timezone/timezone_controller.cc`、`base/i18n/icu_util.cc`、`base/i18n/timezone.cc` | BotBrowser `timezone.diff` + camoufox + CloakBrowser | **P0** | 价值高，只要一致风险就低。时区必须与 IP 地理位置 + `navigator.languages` 地区 + Intl 区域一致。避免 CDP 覆盖的特征。 |
| **locale-native-pin** | `navigator.language(s)`、Accept-Language、Intl/ICU 区域、日期/数字格式 | 通过 `SetICUDefaultLocale()` 设置 ICU 默认值；用 `--code-browser-locale` 驱动 `GetApplicationLocaleInternalNonMac()`/`GetAcceptLanguages()`；把 `navigator.languages` 构造为主语言 + 基础语言。Accept-Language 请求头与 `navigator.languages` 的顺序逐字节一致 | `base/i18n/rtl.cc`、`ui/base/l10n/l10n_util.cc`、`…/frame/navigator_language.cc` | camoufox `locale-spoofing.patch` + CloakBrowser | **P0** | 请求头与 JS 不一致 = 经典的模拟破绽。与时区 + 地理位置一致。 |
| **geolocation-coherent-spoof** *（受权限控制，不自动授权）* | `geolocation` 纬度/经度/精度 | 在设备服务的 `GeolocationImpl::SetOverride/OnLocationUpdate` 处注入（不走 CDP 路径）；**不要自动处理权限弹窗**：像真实桌面用户一样保持默认（拒绝/询问）；只有在确实获得授权时，才返回代理 IP 地理位置范围内、带按 eTLD+1 抖动的位置，并且在没有 GPS 的桌面上使用 **Wi-Fi/IP 级别的精度（约几十到几百米），绝不是 GPS 级别的 1 米** | `services/device/geolocation/geolocation_impl.cc`、`…/public/cpp/geolocation/geoposition.h`、`content/browser/geolocation/geolocation_service_impl.cc` | camoufox `geolocation-spoofing.patch` | **P1** | 评审修正：给每个站点自动授权地理位置本身就是行为破绽（真实桌面用户绝大多数会拒绝/忽略）。去掉了自动授权；与 `permissions-api-state-coherence` 协调，使 `permissions.query` 在真正授权之前读出 `prompt`。 |
| **media-devices-farble** *（标签受权限控制）* | `enumerateDevices()` 的数量、类型组合、标签、deviceId、groupId | 在 `MediaDevices::DevicesEnumerated()` 处合成一个一致的桌面配置（1 个麦克风、1 个摄像头、1–2 个扬声器）。**在 `getUserMedia` 授权之前标签为空（与真实 Chrome 一致）；只有在真正获得权限后，才填充 `Integrated Webcam (VID:PID)` 这类标签。** deviceId/groupId = 稳定的 HMAC(seed, kind, index)，每个站点恒定，每个会话轮换；group_id 像真实硬件一样把麦克风和扬声器配对 | `…/mediastream/media_devices.cc`、`content/browser/renderer_host/media/media_devices_manager.cc`、`media/capture/video/video_capture_device_descriptor.cc` | camoufox `media-device-spoofing.patch` + BotBrowser `video_capture_device_descriptor.cc.diff` | **P1** | 评审修正：在授权前填充标签，**恰恰就是**本补丁声称要修复的泄露：现在由权限状态控制。设备数量不为零（"普通用户"为零也可疑），ID 在会话内稳定。 |
| **speech-voices-spoof** *（保留"先为空、再填充"的异步竞态）* | `speechSynthesis.getVoices()`：与操作系统画像一致的完整语音列表（Win SAPI + Edge 语音，而不是 Linux espeak） | 拦截 `SpeechSynthesis::OnSetVoiceList()`（位于 `tts_win.cc` 之上的跨平台汇聚点），把 mojom 向量替换为画像表（`Microsoft David/Zira/Mark Desktop` + Edge 自然语音）。**复现真实 Chrome 的异步行为：第一次同步调用 `getVoices()` 返回空，然后触发 `voiceschanged` 事件并填充**：不要在第一次同步调用时就返回完整列表。标记 `localService=true`，按区域设置正确的默认语音 | `…/speech/speech_synthesis.cc`、`…/speech/speech_synthesis_voice.cc` | camoufox `speech-voices-spoofing.patch` + Brave 语音 farbling | **P1** | 评审修正：第一次同步调用就过早返回完整列表本身是破绽（真实 Chrome 先返回空，再触发 `voiceschanged`）。列表必须与冻结的画像 Chrome 的真实 Win 构建一致（名称/数量/顺序/语言）。 |
| **battery-keyboard-sensors-desktop** *（按画像的电池差异）* | `getBattery()`（插电台式机）、`keyboard.getLayoutMap()`、通用传感器缺失 | 移植 chromiumfish：KeyboardLayout 去掉服务 IPC，按区域使用固定映射；Sensor/DeviceMotion/Orientation 报告**没有可用传感器**（事件永不触发 / 构造被拒绝），而不是置零的读数。**BatteryManager：`charging=true`，但 `level` 按画像从加权分布中抽取（例如 0.78–1.0，分布真实），`dischargingTime=Infinity`，`chargingTime` 合理**：而**不是**每个画像都固定为 `level=1.0/chargingTime=0` | `…/battery/battery_manager.cc`、`…/keyboard/keyboard_layout.cc`、`…/sensor/sensor.cc`、`…/device_orientation/device_orientation_controller.cc` | chromiumfish `device-sensors.patch` + BotBrowser 传感器模拟 | **P2** | 评审修正：如果整批实例中**每台**机器都报告 `level=1.0/chargingTime=0`，就是一个可关联的群组。按画像的电池差异打破了这个群组。保留 `getBattery`（桌面 Chrome 有这个接口）。在"台式机"上伪造非空传感器 = 矛盾 → 传感器缺失。 |
| **network-info-coherence** | `navigator.connection.{effectiveType,rtt,downlink,downlinkMax,saveData,type}` + Sec-CH-* | 在 `network_information.cc` 中把 getter 覆盖为稳定的画像值（`type='wifi'`、`effectiveType='4g'`、取整的 rtt、合理的 downlink）；发出一致的 CH 请求头（ECT/RTT/Downlink）。rtt/downlink 带有真实的按会话差异，而不是一个常量整数 | `…/netinfo/network_information.cc` | BotBrowser `--bot-network-info-override` | **P2** | 取值对所声称的地理位置合理，并与 Sec-CH-RTT/Downlink/ECT 请求头一致（JS 与请求头不一致 = 破绽）。防止数据中心的 RTT 与消费级宽带画像矛盾。 |
| **math-libm-ulp-coherence** *（新增）* | 不同 libm 实现之间 `Math.sin/cos/tan/exp/log/atan2` 的 ULP 差异（经典的操作系统/架构破绽） | 让一小组超越函数运算经过**随构建一起打包的单一确定性实现**（或一个固定的正确舍入多项式），使 ULP 指纹与所声称的操作系统一致，而不论二进制交叉编译时链接的宿主 libm 是什么。只作用于 JS 可见的 `Math` 绑定，不影响内部布局计算 | `…/bindings/core/v8/…` Math 内建垫片、`v8/src/base/ieee754.cc`（打包的实现）、`…/platform/wtf/math_extras.h` | code-browser 原创（堵住一个经典的 libm 破绽） | **P2** | 评审修正（缺失的面）：Linux 交叉编译的 libm 产生的 ULP 模式与真实 Windows Chrome 不同：逐个运算的 `Math.*` ULP 探测会标记它。打包一个确定性实现，让 ULP 特征与操作系统一致。严格限定范围，避免性能/正确性回归。 |
| **timing-chrome-parity-assert** *（回归断言，不是主动补丁）* | `performance.now()`/事件时间戳 + 视频帧回调：与 Chrome 默认值完全一致（100µs/5µs） | **验证，而不是固定：** 原版 149 的 `time_clamper.h:23-24` 已经定义了 `kCoarseResolutionMicroseconds=100` / `kFineResolutionMicroseconds=5`。加一条回归断言，确认最终二进制仍报告这些值（视频 RVFC 中为 100µs）；**只有在 adryfish 移植使它们回退时才打补丁。** 拒绝任何 100ms/1ms 的 RFP 钳制 | `…/core/timing/time_clamper.h`、`…/video_rvfc/video_frame_callback_requester_impl.cc` | chromiumfish `timing-misc.patch`（降级为断言） | **P2** *（由 P0 降级）* | 评审修正：原版 149 已经是正确的值：把它作为主动的 P0 补丁覆盖在未改变的值上，会有未来升级时漂移的风险。它是对 adryfish 移植的回归检查，而不是 P0 的面补丁。交互式挑战 / 指纹工具的 `performance.now()%1` 分布依然能通过，因为值本来就是对的。 |

### 2.9 — degoogle-humanize

| 补丁 | 伪装对象 | 技术 | 真实目标文件 | 参考来源 | 优先级 | 检测风险说明 |
|---|---|---|---|---|---|---|
| **degoogle-kill-component-registrations** | 启动时残留的对 `update.googleapis.com` 的连接（Widevine、OptimizationHints、TrustTokenKeyCommitments、FirstPartySets） | 清空 `RegisterComponentsForUpdate` 的函数体（移除 `Register*Component(cus)` 调用），或用一个恒为 false 的开关包住；把 `kUpdaterJSONDefault/FallbackUrl` 指向 localhost 黑洞 | `chrome/browser/component_updater/registration.cc`、`components/component_updater/component_updater_url_constants.cc` | ungoogled 改写了主机名但没有阻止注册：code-browser 补上 | **P0** | 低。没有 JS 面。Widevine 在构建时打包（`enable_widevine=true`）：确认 DRM 视频能用打包的 CDM 播放。 |
| **degoogle-disable-optimization-guide** | 对 `optimizationguide-pa.googleapis.com`（GetHints/GetModels）的请求 | 把 `kOptimizationHints` 改为 `FEATURE_DISABLED_BY_DEFAULT`；短路获取器；确保已被干掉的组件不能重新启用 | `components/optimization_guide/core/optimization_guide_features.cc`、`…/optimization_guide_constants.cc`、`chrome/browser/component_updater/registration.cc` | 扩展 ungoogled `disable-ai.patch` | **P0** | 低。纯粹移除网络泄露。 |
| **verify-degoogle-gcm-disabled** | 确保 ungoogled `disable-gcm.patch` 存在：没有到 `mtalk.google.com:5228` 的 MCS 连接 | 确认 `disable-gcm.patch` 在应用系列中（清空 `GCMClientImpl::Start`、`InitializeMCSClient` 提前返回、去掉 `mcs_client_->Login`）。可选：不实例化 `GCMDriver`/`GCMProfileService` | `components/gcm_driver/gcm_client_impl.cc`、`google_apis/gcm/engine/gservices_settings.cc` | ungoogled `disable-gcm.patch` | **P0** | 无：只是验证/纳入一个久经考验的 ungoogled 补丁。 |
| **degoogle-disable-network-time** | 到 `clients2.google.com/time/1/current` 的后台时间同步 | 把非 Android 的 `kNetworkTimeServiceQuerying` 改为 `FEATURE_DISABLED_BY_DEFAULT`。强化时区一致性（时间来自与代理一致的系统时钟） | `components/network_time/network_time_tracker.cc` | code-browser 原创（ungoogled 的残留） | **P1** | 低。 |
| **degoogle-disable-captive-portal-and-variations** | `connectivitycheck.gstatic.com/generate_204` 探测 + variations/Finch 种子获取 | 禁用 captive_portal 特性 / 把该 URL 指向黑洞；禁用 VariationsService，使 `GetVariationsServerURL` 永不被调用 | `components/captive_portal/core/captive_portal_detector.cc`、`components/variations/service/variations_service.cc`、`components/variations/variations_switches.cc` | ungoogled `flags.gn`（部分）+ code-browser 原创 | **P1** | 低。关闭 variations = 可复现/确定性的构建。 |
| **humanize-browser-level-click** *（主要的人类点击路径）* | `Browser.humanizedClick`/`humanizedClickSelector` CDP 方法：不带 `kFromDebugger`、也不附加 Page 调试器的人类点击；跨源 OOPIF 正确 | 新的浏览器级 CDP。`HumanizedClickRunner` 状态机（`base::OneShotTimer`）：贝塞尔路径，然后 kMouseDown / 停留 40–110ms / kMouseUp。构造**带 kNoModifiers（没有 kFromDebugger）**的 `WebMouseEvent`，通过 `RenderWidgetHostInputEventRouter::RouteMouseEvent` 路由。**用按 eTLD+1 的种子参数化时长/σ/弯曲度**（而不是固定常量）。selector 变体通过隔离世界的 JS 解析中心点 | `…/protocol/browser_handler.cc`、`…/browser_handler.h`、`content/browser/devtools/protocol_config.json`、`…/devtools_protocol/domains/Browser.pdl` | chromiumfish `humanized-input.patch` + CloakBrowser 预设 | **P1** | `kNoModifiers` 是关键收益：`isTrusted===true`，没有调试器标记。**去掉** macOS 光标叠加层文件（目标是 Win）+ `agentRunTask`（超出范围）。按种子参数化的轨迹避免被确定性地画像。 |
| **humanize-cdp-mouse-bezier** *（直接 CDP `mouse.click` 的后备）* | 对 Playwright/Puppeteer `mouse.click()` 透明的人类化：弯曲/抖动/缓动的轨迹 | 在 `DispatchMouseEvent` 中，收到 `mousePressed` 时读取 `last_cursor_position_`，构造三次贝塞尔曲线（控制点在垂直方向 ±15%），EaseInOut smoothstep，Box-Muller 抖动（σ 来自种子，钳制在 2.0px），通过 `ForwardMouseEvent` 以约 120 次/秒采样约 0.5 秒。**时长/σ/弯曲度按 eTLD+1 由种子决定** | `content/browser/devtools/protocol/input_handler.cc`、`…/input_handler.h` | chromiumfish `humanized-input.patch` | **P1** | 这条路径通过 `CreateWebMouseEvent` 仍然带有 `kFromDebugger`：**优先使用 `humanize-browser-level-click`**；只为驱动标准 `Input.dispatchMouseEvent` 的客户端保留它。由种子参数化。 |
| **humanize-cdp-keyboard-timing** | CDP 键盘节奏：每个按键的高斯停留 + 间隔、词边界停顿 | 扩展 `DispatchKeyEvent`（或浏览器级的 `Input.humanizedType`）：通过 `OneShotTimer` 调度 keyDown/char/keyUp，高斯停留（约 60–120ms）+ 间隔（约 80–200ms），偶尔较长的停顿。复用 Box-Muller。**参数按 eTLD+1 由种子决定。** 不带 `kFromDebugger` 的路径 | `content/browser/devtools/protocol/input_handler.cc`、`…/input_handler.h` | chromiumfish `humanized-input.patch` + CloakBrowser/camoufox | **P2** | 固定的分布在长会话中可被画像：按 eTLD+1 由种子决定。 |
| **humanize-synthetic-gesture-unmark** | 从 SyntheticGesture 路径（滚动/触摸/指针动作）中移除 `kFromDebugger` | 去掉 `synthetic_mouse_driver.cc`（58、92、124 行）+ `synthetic_smooth_move_gesture.cc`（309 行）中的 `modifiers \|= kFromDebugger`（或用开关控制）。渲染端没有 `kFromDebugger` 的使用方；它不控制任何 CDP 回调确认 | `content/common/input/synthetic_mouse_driver.cc`、`…/synthetic_smooth_move_gesture.cc`、`content/browser/renderer_host/input/synthetic_gesture_target_aura.cc` | code-browser 原创 | **P2** | 在一条渲染端没有使用方的路径上纯粹移除标记。确认滚动手势完成的确认仍然会返回。 |

---

## 3. 构建顺序 / 分阶段

### P0 阶段：基础（统一种子 + 画像 + GPU 解析 + 一致性 + 版本冻结 + TLS group 表）。没有这些，其它都无法有意义地编译。

**P0a：统一的种子/画像引擎 + 审计门禁（必须最先落地，严格按顺序）：**
1. `code-browser-seed-switch` → 2. `code-browser-seed-forward`（涵盖 `persona-seed-plumbing`）→ 3. `code-browser-persona-profile`（涵盖 `persona-fingerprint-profile` + `fingerprint-profile-engine`，固定**唯一的画像 GPU**）→
4. `code-browser-persona-version-freeze` → 5. `code-browser-etld-token` → 6. `code-browser-mojom-token` → 7. `code-browser-session-cache`（== `farbling-seed-core`）→ 8. `code-browser-worker-seed`

这是一条**线性依赖链**，而且是**一个统一的引擎**，不是三个：会话 token（canvas/audio/字体噪声）和画像（UA/屏幕/硬件/GPU/版本元组）是同一个 `--code-browser-seed` 根的两个读取方。
**冻结的画像 Chrome 版本（#4）是一个 P0 产物**，由 UA/CH 生成器、TLS group 表、原型 A/B diff 和 JA4 守卫完全一致地使用：冻结一次，绝不重新推导。

**P0a 门禁：审计门禁在 adryfish 重放之后、任何面之前立即运行：**
- 重放 adryfish 142→149，然后落地 `code-browser-disable-global-fingerprint`，**并带一个构建时 `static_assert`：只要还有任何面引用 adryfish 的全局种子访问器，就让编译失败。**
  可跨站关联的超级 cookie 必须**在 P0 就不可能被发布**，而不是到 P1 再修补。

**P0b：P0 的面（依赖 session-cache #7 和/或画像 #3）：**
- `canvas2d-farble-perturb`、`webgl-strings-coherent` *（UNMASKED+GL_VERSION 的唯一负责者，读取唯一的画像 GPU）* → *依赖种子 + 画像*
- `audio-buffer-farble`、`audio-farbling-helper` *（整个音频路径共享一个种子）* → *依赖种子*，**未实现**
- `font-allowlist-win-persona` *（按画像的变体）*、`font-access-api-filter`、`font-metrics-jitter-pertld` → *抖动依赖种子；允许列表依赖画像 `--lang`*
- `navigator-ua-clienthints` *（读取冻结版本 + 固定 GREASE/完整版本列表顺序）*、`webdriver-automation-scrub`、`hardware-concurrency-coherent` *（合并后的唯一负责者）*、`device-memory-coherent` *（合并后的单一来源）* → *依赖画像*
- `screeninfo-source-override` *（骨干：在叶子补丁之前或同时落地）*，然后是 `screen-display-spoof`、`media-query-device-coherence` *（堵住 `CalculateDeviceWidth/Height` 泄露；按画像的 `prefers-*`）* → *依赖画像*
- `timezone-native-pin`、`locale-native-pin` → *启动配置*
- **TLS 子树（硬性依赖冻结的画像版本 #4）：** `tls-supported-groups-keyshare-version-table`（真正的工作）、`http2-settings-frame-pin`
- **WebRTC/代理：** `webrtc-ip-handling-default-deny` **+ `mdns-local-ip-coherence`（一同发布，同一阶段）**、`udp-over-socks5-tunnel` *（经 SOCKS5 的 UDP 的**唯一**实现）*、`socks5-credentialed-and-dns-in-proxy`
- **去 Google 的 P0：** `verify-degoogle-gcm-disabled`、`degoogle-kill-component-registrations`、`degoogle-disable-optimization-guide`

### P1 阶段：面与加固

`webgl-params-coherence` *（+ drawingBuffer/MSAA）* · `webgl-readpixels-farble` *（+ FLOAT/HALF_FLOAT epsilon）* · `webgpu-adapter-farble` · `audio-analyser-farble` *（共享音频种子；未实现）* ·
`audio-context-metadata-spoof` *（断言离线渲染速率；部分实现）* · `font-fallback-mac-skip` · `font-disable-local-src-match` · `permissions-api-state-coherence` ·
`tls-sigalgs-version-guard` *（回归守卫）* · `tls-trust-anchor-ids-guard` *（回归守卫）* · `tls-cipher-grease-version-guard` *（已提升）* · `ice-candidate-sdp-stats-spoof` ·
`geolocation-coherent-spoof` *（受权限控制，不自动授权）* · `media-devices-farble` *（标签受权限控制）* · `speech-voices-spoof` *（先为空再填充的异步行为）* ·
`degoogle-disable-network-time` · `degoogle-disable-captive-portal-and-variations` · `humanize-browser-level-click` *（主要）* · `humanize-cdp-mouse-bezier` *（后备）*

### P2 阶段：纵深防御与打磨

`gpu-strings-source-coherence` · `offline-audio-render-isolation` *（共享音频种子；仅作后备；未实现）* · `element-rect-jitter-pertld` · `bundle-windows-metric-fonts` ·
`navigator-prototype-coherence` *（与冻结版本做 A/B diff）* · `battery-keyboard-sensors-desktop` *（按画像的电池差异）* · `network-info-coherence` · `math-libm-ulp-coherence` ·
`timing-chrome-parity-assert` *（回归断言）* · `humanize-cdp-keyboard-timing` · `humanize-synthetic-gesture-unmark`

### 按依赖划分的补丁（显式列出）

> **硬性种子依赖（读取 `SessionCache`/按 eTLD+1 的 token）：** `canvas2d-farble-perturb`、`webgl-strings-coherent`（噪声模式扩展）、`webgl-readpixels-farble`、`webgpu-adapter-farble`（按站点维度）、
> `audio-buffer-farble`、`audio-analyser-farble`、`audio-farbling-helper`、`offline-audio-render-isolation`、`font-metrics-jitter-pertld`、`element-rect-jitter-pertld`、
> `media-devices-farble`（ID）、`geolocation-coherent-spoof`（抖动）、`ice-candidate-sdp-stats-spoof`、`mdns-local-ip-coherence`（UUID）、`humanize-*`（参数种子）。
> **画像依赖（读取 `fingerprinting::Current()`）：** navigator-ua-automation 和 screen-hardware 的全部补丁、`webgl-strings-coherent`（唯一的 GPU）、`webgl-params-coherence`、
> `audio-context-metadata-spoof`、`font-allowlist-win-persona`、`speech-voices-spoof`、`network-info-coherence`、`battery-keyboard-sensors-desktop`。
> **冻结版本依赖（读取 `code-browser-persona-version-freeze` #4）：** `navigator-ua-clienthints`（UA/CH + GREASE 顺序）、`tls-supported-groups-keyshare-version-table`、
> `tls-cipher-grease-version-guard`、`tls-sigalgs/trust-anchor-ids-guard`、`navigator-prototype-coherence`、`http2-settings-frame-pin`（验证）。
> **没有种子/画像依赖：** 所有去 Google 补丁、`webdriver-automation-scrub`、`humanize-synthetic-gesture-unmark`、`socks5-credentialed-and-dns-in-proxy`、`timing-chrome-parity-assert`、`math-libm-ulp-coherence`。

---

## 4. 与 adryfish 的组合

code-browser 以 **adryfish/fingerprint-chromium 142→149** 的移植为基础，然后在其上叠加按 eTLD+1 的引擎和各个面的补丁。总规则是：
**凡是 adryfish 已经涉及的面，我们把它的噪声升级为按 eTLD+1，而不是重复打补丁**：同一个 getter 上有两条相互竞争的伪装路径 = 必然不一致。
`code-browser-disable-global-fingerprint` 就是强制执行这一点的**构建时审计门禁**（一个编译错误，而不是之后某个阶段的审查）。

### adryfish **已经**覆盖的面 → 升级（不要重复打补丁）

| 指纹面 | adryfish 的覆盖 | code-browser 的行动 |
|---|---|---|
| **全局指纹种子** | `--fingerprint=<int32>` 单一全局种子；`--fingerprint-platform/-brand/-hardware-concurrency` | **把这个整数保留为会话 token。** 把 `FingerprintSeed()` 重定向到每个文档的 `SessionCache` 种子（`code-browser-disable-global-fingerprint`，有构建断言）。把 int32 扩展为 uint64（`code-browser-seed-switch`）。 |
| **hardwareConcurrency** | `navigator_concurrent_hardware.cc` 中的 `--fingerprint-hardware-concurrency` 叶子覆盖 | **`hardware-concurrency-coherent` 是这一个调用点的唯一负责者**：把读取开关替换为 `Current().hardware_concurrency`。navigator 和 screen 两份规格合并为这一个补丁（没有第二个写入者）。 |
| **deviceMemory** | adryfish 的指纹开关路径 | **`device-memory-coherent` 通过 `ApproximatedDeviceMemory` 统一来源**，让 JS 值和 CH 请求头一致。navigator + screen + adryfish 开关合并为一个按档位取值的来源补丁。 |
| **navigator.platform / UA platform** | `--fingerprint-platform` | 经由画像 `Current()`（冻结版本），使 UA/CH/platform 来源统一（`navigator-ua-clienthints`）。 |
| **WebGL 信息** | 149 基础中有 `kSpoofWebGLInfo` + `kSpoofWebGLRendererParam.Get()`（已在 webgl base 4104-4105 行确认）；`GL_RENDERER`→`"WebKit WebGL"` | **把现有钩子重新指向**唯一的画像 GPU（`webgl-strings-coherent`，唯一负责者）。canvas 领域的字符串补丁和以前屏幕领域的 `webgl-gpu-coherence` 是**一个补丁、一块 GPU、一个负责者**：它们不再都写这个 getter。 |
| **音频开关** | 一等公民的 `audio` `--disable-spoofing` 开关（Chrome 144+） | 把 code-browser 按 eTLD+1 的音频级别映射到这个开关上；用按 token 的微调替换全局种子的微调。buffer/analyser/离线共享一个种子。**未实现：** adryfish 的音频噪声被关闭，也不存在按 token 的音频噪声。 |
| **GPU vendor/renderer 开关** | `--fingerprint-gpu-vendor/-renderer` **在 Chrome 144 中被移除**（现在是 `--disable-spoofing=gpu`） | 不要复活这些开关：走 `kSpoofWebGLInfo`。 |

### code-browser **全新**增加的面（adryfish 没有覆盖）

| 指纹面 | 为什么是全新的 |
|---|---|
| **按 eTLD+1 推导**（`code-browser-etld-token`、`-mojom-token`、`-session-cache`、`-worker-seed`） | adryfish 只有全局种子：按站点的一致性引擎是新的（以 Brave 为模型）。 |
| **冻结的画像 Chrome 版本**（`code-browser-persona-version-freeze`） | adryfish 没有一个在 UA/TLS/原型/JA4 之间共享的单一版本产物。 |
| **Canvas 最低位扰动**（`canvas2d-farble-perturb`、`webgl-readpixels-farble`） | adryfish 没有做 Brave 风格、依赖内容的 HMAC+LFSR 扰动。 |
| **WebGL2 内联 `GL_VERSION`/`GL_SHADING_LANGUAGE_VERSION` 改写** | adryfish 的 WebGL 钩子只覆盖 UNMASKED；内联的后端版本字符串没有覆盖（现在在 `webgl-strings-coherent` 中）。 |
| **WebGPU 适配器 + GPU 进程源头字符串** | 较新的面，adryfish 没有覆盖。 |
| **音频 buffer/analyser/离线 farbling**，**未实现** | adryfish 只有粗粒度的开关。 |
| **字体允许列表（分布）+ 度量/矩形抖动 + Font Access 过滤** | 完全是新的（以 Cromite/Camoufox 为模型）。 |
| **TLS group 表 + H2 SETTINGS 固定** | adryfish 在概念上提到了网络一致性，但没有提供 group/H2 固定。 |
| **经 SOCKS5 的 UDP + WebRTC 泄露防护 + socks5h DNS + mDNS 一致性** | adryfish 的 README 指出其 SOCKS 不支持密码认证、也不支持 UDP：全部是新的。 |
| **Permissions API 一致性、math/libm ULP、地理位置/媒体的权限控制** | 评审发现的新的一致性面。 |
| **时区/区域/地理位置原生固定、媒体设备、语音、传感器、网络信息、原型一致性、自动化清理、去除 Google 残留、人类化输入** | 新的（以 BotBrowser/Camoufox/ungoogled 为模型）。 |

### 统一而不重复（只实现一次：根据评审已解决）

这些在各领域的 JSON 中被重复列出；每一项都是**一个唯一负责者的补丁**，在构建之前定稿：
- `farbling-seed-core`（canvas）**==** `code-browser-session-cache`（core）**==** `fingerprint-profile-engine` 的种子部分（screen）→ **一个种子引擎。**
- `persona-fingerprint-profile`（navigator）**==** `fingerprint-profile-engine` 的画像部分（screen）→ **一个 `code-browser-persona-profile`**（它还固定了**唯一的**画像 GPU）。
- `persona-seed-plumbing`（screen）**==** `code-browser-seed-forward`（core）→ **一个转发补丁。**
- `hardware-concurrency-coherent`（navigator）**==** `hardware-concurrency-memory-coherence` 的 HC 部分（screen）→ **`navigator_concurrent_hardware.cc` 只有一个负责者。**
- `device-memory-coherent`（navigator）**==** 内存部分（screen）→ **一个按档位取值的来源补丁。**
- `webgl-strings-farble`/`webgl-params-coherence`（canvas）**==** `webgl-gpu-coherence`（screen）→ **`webgl-strings-coherent` 是 UNMASKED/GL_VERSION getter 的唯一写入者，固定为唯一的画像 GPU。**
  屏幕领域读取 `Current().gpu`；它不写 getter。**这解决了 NVIDIA 与 Intel 的矛盾：只有一块 GPU，Intel UHD 770 / ANGLE-D3D11（无头时为 ANGLE-SwiftShader）。**
- `udp-over-socks5-quic-stun-tunnel`（tls-network）**==** `udp-over-socks5-tunnel`（webrtc）→ **一个 RFC 1928 UDP-ASSOCIATE 实现，一个接线点：`socket_manager.cc:315` 处的 `CreateDatagramClientSocket()` 分派。**

---

## 5. 覆盖矩阵

每个检测面 × 阶段 × 所参照的分支。**U** = 对 adryfish 基础的升级；**N** = code-browser 全新的补丁。

| 检测面 | P0 | P1 | P2 | 参照的分支 | adryfish |
|---|:---:|:---:|:---:|---|:---:|
| 按 eTLD+1 的种子引擎 | ● | | | Brave（`BraveSessionCache`） | U |
| 跨进程种子一致性 | ● | | | ChromiumFish（persona-seed） | U |
| 冻结的画像 Chrome 版本（1 个产物） | ● | | | code-browser 原创 | N |
| Worker/worklet 种子传播 | ● | | | Brave | N |
| Canvas 2D 读回（getImageData/toDataURL/toBlob） | ● | | | Brave（`PerturbPixels`） | N |
| OffscreenCanvas / worker 中的 canvas | ● | | | Brave | N |
| measureText / 文本度量 | ● | | | Brave + Camoufox | N |
| getBoundingClientRect / 非文本矩形 | | | ● | Camoufox（改为按 eTLD+1） | N |
| WebGL UNMASKED vendor/renderer（一块 GPU） | ● | | | Camoufox（一致的 Intel UHD 770） | U |
| WebGL2 内联 GL_VERSION/GLSL_VERSION 泄露 | ● | | | code-browser 原创（堵住后端泄露） | U |
| WebGL 数值参数限制 | | ● | | Camoufox + BotBrowser | N |
| WebGL drawingBuffer / MSAA 采样数 | | ● | | Camoufox + BotBrowser | N |
| WebGL 扩展列表 | ● | | | Brave（`WebGLFarbledExtensionHandler`） | N |
| WebGL readPixels（UNSIGNED_BYTE） | | ● | | Brave（扰动而不是屏蔽） | N |
| WebGL readPixels（FLOAT/HALF_FLOAT，epsilon） | | ● | | code-browser 原创（没有跳过路径） | N |
| WebGL contextAttributes / shaderPrecision | | ● | | BotBrowser + Camoufox | N |
| WebGPU GPUAdapterInfo（一块 GPU，真实字符串） | | ● | | Brave（`BraveScrubWebGpuAdapterInfo`） | N |
| GPU 进程字符串（chrome://gpu、GL_VERSION） | | | ● | 新颖（唯一的画像 GPU 记录） | N |
| renderer 字符串 ↔ readPixels 哈希一致性 | ● | | | code-browser 原创（渲染后端规则） | N |
| AudioBuffer getChannelData/copyFromChannel（未实现） | ● | | | Brave（`audio_buffer` 宏） | U |
| AnalyserNode 实时读取（×4，共享种子；未实现） | | ● | | Brave | N |
| AudioContext sampleRate（== 真实渲染速率） | | ● | | ChromiumFish + Camoufox | N |
| OfflineAudioContext 渲染隔离（共享种子；未实现） | | | ● | ChromiumFish（`IsolateAudioSamples`） | N |
| 字体列表（CSS 字体族探测，分布） | ● | | | Cromite + ChromiumFish | N |
| Font Access API（queryLocalFonts） | ● | | | Cromite（扩展） | N |
| 字体度量抖动（HarfBuzz 步进） | ● | | | Camoufox（改为按 eTLD+1） | N |
| Mac/Linux 字体名层叠泄露 | | ● | | ChromiumFish | N |
| @font-face src:local() 侧信道 | | ● | | Cromite + Camoufox | N |
| 打包的度量兼容字体（测试一致性） | | | ● | ChromiumFish（`lean-windows-fonts`） | N |
| navigator.userAgent / UA 请求头 | ● | | | ChromiumFish + Camoufox | U |
| userAgentData / Sec-CH-UA*（×11） | ● | | | ChromiumFish | U |
| getHighEntropyValues 划分 + 完整版本列表顺序 | ● | | | code-browser 原创（固定为真实构建） | N |
| navigator.platform / appVersion | ● | | | ChromiumFish + Camoufox | U |
| navigator.webdriver / AutomationControlled | ● | | | BotBrowser + ChromiumFish + patchright | N |
| Headless UA 标记 | ● | | | BotBrowser（`removeHeadless`） | N |
| 自动化信息栏 / WebShare 一致性 | ● | | | BotBrowser + ChromiumFish | N |
| cdc_ 全局变量 | — | — | — | （不在引擎中：只存在于 chromedriver） | — |
| navigator.hardwareConcurrency（+worker，1 个负责者） | ● | | | ChromiumFish + Camoufox | U |
| navigator.deviceMemory（+CH 请求头，1 个来源） | ● | | | ChromiumFish + Brave | U |
| Permissions API 状态一致性 | | ● | | code-browser 原创 | N |
| 原型形态 / 封闭 Shadow DOM（对照冻结版本） | | | ● | ChromiumFish（已 A/B 验证） | N |
| screen.width/height/avail*/colorDepth | ● | | | ChromiumFish + Camoufox | U |
| ScreenInfo 源头一致性（骨干，先于叶子） | ● | | | ChromiumFish + Camoufox | N |
| CSS @media device-width/height（泄露：最重要的发现） | ● | | | code-browser 原创 | N |
| CSS pointer/hover/resolution/color-gamut | ● | | | ChromiumFish | U |
| CSS prefers-*（按画像加权，不固定） | ● | | | code-browser 原创（群组修正） | N |
| outerWidth/Height / devicePixelRatio | ● | | | ChromiumFish（经由 ScreenInfo） | U |
| TLS signature_algorithms（版本守卫） | | ● | | 回归断言（已在原版 149 上验证） | N |
| TLS Trust Anchor IDs（版本守卫） | | ● | | 回归断言（已在原版 149 上验证） | N |
| TLS supported_groups / key_share（版本表） | ● | | | 画像版本表 | U |
| TLS cipher/GREASE/证书压缩/ALPS（守卫） | | ● | | 画像版本 + 149 验证 | U |
| HTTP/2 SETTINGS 指纹 + 伪首部顺序 | ● | | | BotBrowser + ChromiumFish | N |
| QUIC/H3 版本 + 传输参数 | ● | | | （锁定 149 默认值） | N |
| WebRTC ICE IP 处理（host/srflx 泄露） | ● | | | Cromite + ChromiumFish | N |
| mDNS .local host 候选（与拒绝一同发布） | ● | | | 加固的上游实现 + Brave 种子 | N |
| 经 SOCKS5 的 UDP（QUIC/STUN 隧道，1 个实现） | ● | | | BotBrowser（重新实现） | N |
| SOCKS5 凭据（RFC 1929） | ● | | | BotBrowser + adryfish 的缺口 | N |
| DNS 走代理（socks5h） | ● | | | BotBrowser | N |
| ICE 候选 / SDP / RTCStats IP（一致） | | ● | | Camoufox（Gecko→Blink） | N |
| 时区（navigator/Date/Intl/国家） | ● | | | BotBrowser + Camoufox + CloakBrowser | N |
| 区域（languages/Accept-Language/Intl） | ● | | | Camoufox + CloakBrowser | N |
| 地理位置（受权限控制，不自动授权） | | ● | | Camoufox | N |
| enumerateDevices（标签受权限控制） | | ● | | Camoufox + BotBrowser + Brave | N |
| speechSynthesis.getVoices()（保留异步竞态） | | ● | | Camoufox + Brave | N |
| getBattery（按画像的差异）/ keyboard / 传感器 | | | ● | ChromiumFish + BotBrowser | N |
| navigator.connection（网络信息 + CH） | | | ● | BotBrowser | N |
| Math/libm 超越函数 ULP（操作系统/架构破绽） | | | ● | code-browser 原创 | N |
| performance.now() / 计时精度（断言） | | | ● | ChromiumFish（回归断言，原版 149） | U |
| GCM / mtalk.google.com:5228 | ● | | | ungoogled（`disable-gcm`） | N |
| 组件更新器（update.googleapis.com） | ● | | | code-browser 原创 | N |
| Optimization guide 请求 | ● | | | 扩展 ungoogled 相关补丁 | N |
| 网络时间探测 | | ● | | code-browser 原创 | N |
| 强制门户检测 / variations 种子 | | ● | | ungoogled 部分 + code-browser 原创 | N |
| 浏览器级人类点击（isTrusted、OOPIF、带种子） | | ● | | ChromiumFish + CloakBrowser | N |
| CDP 鼠标输入（kFromDebugger / 轨迹，带种子） | | ● | | ChromiumFish（`humanized-input`） | N |
| CDP 键盘节奏（带种子） | | | ● | ChromiumFish + CloakBrowser + Camoufox | N |
| 合成手势的 kFromDebugger 标记 | | | ● | code-browser 原创 | N |

**各阶段合计：** P0 = 34 个面（统一种子/画像/版本 + GPU 一致性 + TLS group 表/H2 + WebRTC 拒绝 + mDNS + 去除 Google 泄露 + 自动化清理）· P1 = 24 个面 · P2 = 13 个面。

---

**构建必须满足的一致性不变量（验收门禁）：**
- **端到端只有一块 GPU：** WebGL UNMASKED renderer == WebGL2 `GL_VERSION` == WebGL 参数限制 == WebGPU 适配器 == `chrome://gpu` == readPixels 哈希集群 == 伪装的操作系统：
  全部描述同一块画像 GPU（Intel UHD 770 / ANGLE-D3D11，或无头运行时的 ANGLE-SwiftShader）。**renderer 字符串与读回哈希不能不一致。**
- `screen.width ≥ outerWidth ≥ innerWidth`；`screen.width − availWidth` = 合理的任务栏差值；`matchMedia('(device-width:${screen.width}px)')` 为 true（Brave `screen_farbling_browsertest`）；
  ScreenInfo 骨干与每个叶子访问器一致。
- **一个冻结版本：** `navigator.userAgent` 的 Chrome 版本 == `Sec-CH-UA` == 完整版本列表/GREASE 顺序 == TLS group 表 == 原型形态所声称的版本 == JA4 守卫：全部读取 `code-browser-persona-version-freeze`。
- 时区 == IP 地理位置所在城市 == `navigator.languages` 地区 == Intl 区域。
- `hardwareConcurrency` == `deviceMemory` == GPU 档次 == 屏幕档次，从同一个 `kHwTiers` 档次中抽取；worker 报告相同的值（没有闪变）。
- **权限一致性：** 授权前 `enumerateDevices` 标签为空；`permissions.query` 在真正授权前读出 `prompt`；地理位置从不自动授权，在桌面上也从不使用 GPS 级精度。
- **没有坍缩的群组：** 字体集、`prefers-color-scheme` 和电池电量按画像加权，而不是单一常量。
- 同一 eTLD+1 → 整个会话字节级稳定（没有闪变）；不同 eTLD+1 → 不可关联；音频离线 == 实时 == buffer（一个共享种子）。
- `performance.now()` 精度与真实 Chrome 149 逐字节一致（100µs/5µs，有回归断言）；`navigator.webdriver === false`；SOCKS5 隧道之外没有 UDP 出站。
- **构建时：** 只要有任何面引用 adryfish 全局种子访问器，编译就失败（超级 cookie 在 P0 中不可能存在）。

---

## 检测方评审后的调整

相比草案改了什么，以及为什么：

1. **解决了 GPU 身份的矛盾（最主要的修正）。** 草案在 §2.1 中宣称 "NVIDIA RTX 3060"，却在 §2.5/§4 中固定为 "Intel UHD 770"，同时又承认 readPixels 运行在真实的 SwiftShader/ANGLE 后端上：
   这必然导致 renderer 字符串与像素哈希不一致，也就是最强的 GPU 破绽。现在**只有一块画像 GPU**（真实 Windows 部署用 Intel UHD 770 / ANGLE-D3D11，无头运行时用 ANGLE-SwiftShader），
   只在 `code-browser-persona-profile` 中定义一次，由**唯一负责者**（`webgl-strings-coherent`）写入，并有明确的**渲染后端规则**，以及"renderer 字符串和读回哈希来自同一块 GPU"的验收门禁。

2. **把 TLS 部分从空操作的"翻转"重新定位为以版本为键的守卫。** 已确认 `kTlsMldsaSignatures` 和 `kTLSTrustAnchorIDs` **在原版 149 中已经是 `FEATURE_DISABLED_BY_DEFAULT`**，
   所以原版 JA4 已经与真实 149 一致，"1 比特就能看出不是真 148"的说法是反的。sigalgs/trust-anchor 补丁变成了 **P1 回归断言**（确认移植没有打开它们；**不要**硬编码经典分支，
   那会与真实 149 能完成的、由服务器触发的后量子握手不同步）。真正的工作，即**与 UA 生成器协调、可按版本选择的 `supported_groups`/`key_share` 表**，仍是 P0；
   `tls-cipher-grease-version-guard` 从 P2 提升到 P1，让版本一致性尽早得到强制执行。

3. **把 `timing-chrome-parity` 降级为回归断言。** 原版 149 的 `time_clamper.h` 已经定义了 `100µs/5µs`；在未改变的值上发布一个主动补丁，会有未来升级时漂移的风险。
   现在它是一个 P2 断言，确认二进制仍报告原版的值（只有在 adryfish 移植使它们回退时才打补丁）。

4. **把审计门禁提升到 P0，并加上构建时断言。** `code-browser-disable-global-fingerprint` 原来是 P1/被推迟的，而 P0 的面却在读取种子：这样的阶段顺序可能会在 P0 中发布可跨站关联的超级 cookie。
   现在它在 P0a、紧接着 adryfish 重放之后落地，并带有一个 `static_assert`：只要还有任何面引用全局种子访问器，就**让编译失败**。

5. **在构建之前统一了重复的补丁（而不是留作一条协调说明）。** 一个种子引擎、一个画像（现在由它负责唯一的 GPU）、`navigator_concurrent_hardware.cc` 只有一个负责者、一个 `deviceMemory` 按档位取值的来源、
   一个 WebGL UNMASKED 写入者，以及**一个**经 SOCKS5 的 UDP 实现，带有唯一商定的接线点（`socket_manager.cc:315` 处的 `CreateDatagramClientSocket`）：解决了草案中两份相互冲突的文件列表。

6. **加入了 WebGL2 内联 `GL_VERSION`/`GL_SHADING_LANGUAGE_VERSION` 泄露。** 已确认 `webgl2_rendering_context_base.cc:4789` 内联读取真实的后端版本字符串
   （UNMASKED 会正确地在 4987 行回落到 base，所以草案在那里的担心是错位的）。`webgl-strings-coherent` 现在也覆盖这些内联版本字符串。

7. **让依赖权限的面与真实 Chrome 一致地受控。** `media-devices-farble` 现在**在 `getUserMedia` 之前返回空标签**（填充标签恰恰就是它声称要修复的泄露）；
   `geolocation-coherent-spoof` **不再自动授权**弹窗，在桌面上也从不使用 GPS 级精度；新增 `permissions-api-state-coherence`，让 `permissions.query` 与设备/地理位置的状况一致；
   `speech-voices-spoof` 保留了 Chrome **先为空、再触发 `voiceschanged`** 的异步竞态，而不是在第一次同步调用时就返回完整列表。

8. **打破了可关联的单一常量群组。** 字体允许列表变成了**按画像的加权分布**（stock / +Office / +Adobe / +OEM），而不是一个过于干净的标准集合；
   `prefers-color-scheme`/`prefers-reduced-motion` 按画像抽取（约 45% 深色），而不是固定值；电池 `level` 带有按画像的差异，而不是整批实例都为 `1.0`。

9. **补充了缺失的面。** `element-rect-jitter-pertld`（非文本的 `getBoundingClientRect`/transform 精度，与文本抖动共享种子）、`webgl-readpixels-farble` 的 FLOAT/HALF_FLOAT epsilon 路径（不跳过）、
   WebGL `drawingBuffer`/MSAA 参数、`math-libm-ulp-coherence`（超越函数 ULP 暴露操作系统）、固定为真实构建的 `getHighEntropyValues` 划分 + 完整版本列表/GREASE 顺序、
   OfflineAudioContext **渲染速率**断言（而不只是 getter），以及上面的 `permissions-api` 一致性。

10. **修正了跨阶段的顺序。** 把**画像 Chrome 版本固定为一个冻结的 P0 产物**（`code-browser-persona-version-freeze`），由 UA/CH、TLS、原型 diff 和 JA4 守卫完全一致地使用：消除了跨阶段的版本漂移；
    让 `screeninfo-source-override`（骨干）在叶子屏幕访问器**之前或同时**落地；并且**在 P0 中把 `mdns-local-ip-coherence` 与 `webrtc-ip-handling-default-deny` 一同发布**，
    让候选集合在阶段之间永远不会异常地为空。
