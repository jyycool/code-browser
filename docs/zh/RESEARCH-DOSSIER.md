# clearcote：完整研究档案

*一个 100% 开源、可复现的反检测 / 指纹加固 Chromium。目标：Windows x64，在 Linux 机器上交叉编译。本文汇总了迄今为止的全部研究。*

- **仓库：** github.com/clearcotelabs/clearcote-browser
- **基础：** ungoogled-chromium 149.0.7827.114（去 Google 化）+ adryfish/fingerprint-chromium 补丁（引擎级伪装）
- **构建主机：** 一台专用 Linux 机器（8 vCPU / 32 GB 内存 + 16 GB 交换 / 约 640 GB 磁盘，Ubuntu 22.04），交叉编译 Windows 二进制
- **配套文档：** `RESEARCH.md`（全局综述）、`PATCHES.md`（文件级隐身补丁清单）

---

## 0. 执行摘要

clearcote 建立在与商业反检测 Chromium 分支完全相同的基础之上，但以 **100% 开源、可复现**的方式发布：没有专有二进制。这个基础是：

```
Chromium (Google)
        │
ungoogled-chromium  ── de-Google: strips Google services/telemetry, build wiring
        │
adryfish/fingerprint-chromium  ── C++ source patches: canvas/WebGL/audio/fonts/WebRTC/UA spoofing
        │
clearcote-native upgrades  ── per-eTLD+1 farbling coherence, TLS group-table version pinning,
                              QUIC/STUN-over-SOCKS5, full de-Google, engine-level humanize
```

研究中最重要的一条设计洞见：**好的指纹既不是随机的也不是静态的，而是按 eTLD+1 确定、并且内部自洽的。**
除了 Brave，每个隐身分支都弄错了这一点（它们使用一个全局种子，而这本身就是一个可跨站关联的超级 cookie）。clearcote 把 Brave 的 farbling 模型作为核心。

---

## 1. 基础的发现

商业分支（CloakBrowser、ChromiumFish）宣传"42/49/57 个源码级 C++ 补丁"，但发布的是**闭源二进制**：你能读到它们改了*什么*（公开的 `.patch` 描述），却看不到完整构建。追溯它们实际基于什么：

- **CloakBrowser**：打过补丁的 Chromium，闭源二进制。README 声称 42→57 个补丁、人类化、geoip、持久化配置、TLS 匹配。
- **ChromiumFish**（arman-bd）：打过补丁的 Chromium，闭源二进制，但公开了部分示例补丁并固定了 `UPSTREAM_REVISION`。公开的 TLS + 画像种子补丁中最好的。
- **两者都在模仿的开源基础** = **`adryfish/fingerprint-chromium`**（一个中国项目），"一个基于 Ungoogled Chromium 的指纹浏览器"。这才是 clearcote 真正的起点。

### adryfish 的延迟开源策略（关键的操作事实）
adryfish 的 **main 分支没有补丁**。源码以 **git 标签**的形式发布，比二进制**晚约 1 个月**。可用的源码标签：`129, 130, 131, 132, 133, 134, 135, 136, 138, 139, 142, 144`。
**最新公开的源码是 `142.0.7444.175`**：144 的二进制已发布，但源码还没有。每个标签都是**完整的 ungoogled-chromium 源码树**，而不是独立的 `.patch` 文件，
所以移植方法是 *diff(adryfish-142 源码树 vs 原版 142) → 重放到 149 上*。

**后果：** 补丁移植是 **142 → 149（7 个大版本）**，而不是 144→149。选项：现在从 142 移植，或者等 144 源码以缩短跨度。

---

## 2. 参考项目全景（研究了 16 个仓库）

全部克隆到机器上的 `~/research/` 下。

| 仓库 | 引擎 | 方式 | 开源？ | 对 clearcote 的关键启示 |
|---|---|---|---|---|
| **brave-core** | Chromium | 按站点 **farbling** | ✅ 完全 | 正确的随机化模型：按 eTLD+1 确定 |
| **cromite** | Chromium | 在 ungoogled 风格基础上实现 Brave farbling | ✅ 完全 | 确切的移植模式 + 学术指纹论文 |
| **fingerprint-chromium**（adryfish） | Chromium | 在 ungoogled 上 种子→指纹 | ⚠️ 标签 | clearcote 的基础伪装层 |
| **ungoogled-chromium-149** | Chromium | 去 Google 化 + 构建接线 | ✅ 完全 | 基础（149.0.7827.114） |
| **CloakBrowser** | Chromium | 补丁 + 人类化 + geoip | ❌ 二进制 | 人类化预设、geoip、持久化配置的用户体验 |
| **chromiumfish** | Chromium | 引擎补丁 + 画像 + TLS | ⚠️ 补丁 | TLS 固定、画像种子的管线、canvas 桥 |
| **BotBrowser** | Chromium | 加密的设备档案，按上下文 | ❌ 引擎 | 按上下文的指纹、经 SOCKS5 的 UDP、端口保护 |
| **camoufox** | Firefox | C++ 伪装，覆盖面最广 | ✅ 完全 | 最完整的指纹面清单 + MaskConfig |
| **invisible_playwright** | Firefox | C++ Gecko 伪装 | ✅ | 对 Firefox 方案的交叉验证 |
| **kameleo** | 两者 | 引擎级遮蔽（商业） | ❌ | 双引擎架构的思路 |
| **undetectable-fingerprint-browser** | Chromium | 开源的 Multilogin 替代品 | ✅ | 直接的开源同类；配置管理器的用户体验 |
| **rebrowser-patches** | — | CDP 泄露补丁（PW/Pptr） | ✅ | 也需要在引擎内修复的 CDP 泄露清单 |
| **patchright-python** | — | 打过补丁的 Playwright | ✅ | `chrome.runtime` 的真实感、CDP 抑制 |
| **nodriver** | — | 无 WebDriver 的直接 CDP | ✅ | 基准测试零拦截；值得模仿的传输方式 |
| **SeleniumBase** | — | 自动化框架 + 规避 | ✅ | 基础的检测向量 |
| **undetected-chromedriver** | — | 标志/痕迹清理 | ✅ | 经典的检测向量 |

**两大阵营：** *引擎级分支*（clearcote 所属的类别，上面几行 = 蓝图）和*客户端/CDP 补丁*（下面几行 = 需要在引擎内消除的检测向量目录）。

---

## 3. 核心论点：引擎级 + 按 eTLD+1 的一致性

### 3.1 在引擎层面做，绝不用 JavaScript
所有严肃的分支都同意：在 C++ 引擎中伪装，绝不通过注入 JS。JS 垫片（`playwright-stealth`、`puppeteer-extra`、`undetected-chromedriver`）
恰好会在指纹审计工具检查的地方留下篡改痕迹，而且每次 Chrome 更新都会坏。adryfish（clearcote 的基础）已经在 C++ 层面打补丁。

### 3.2 按 eTLD+1 的确定性一致（关键升级）
Brave 的 **farbling** 从 `(session_token × eTLD+1)` 种子推导出每一个半识别性的值，因此：
- 同一站点 → 整个会话**相同**的值（没有会话内闪变的破绽），
- 不同站点 → **不同**的值（无法跨站关联），
- 下一个会话 → 全新的画像。

`brave-core` 中的证据：专门的 `components/brave_shields/content/browser/brave_farbling_service.cc`，以及 `browser/farbling/` 下逐个面的浏览器测试：
canvas、audio、webgl、**webgpu**、screen、plugins、useragent、languages、hardwareConcurrency、deviceMemory、speech-synthesis、USB、enumerateDevices。

**为什么重要：** CloakBrowser / ChromiumFish / adryfish 都使用**单一全局 `--fingerprint` 种子** → 每个站点看到相同的 canvas → 可跨站关联。
采用 Brave 的按 eTLD+1 模型是 clearcote 最大的一项正确性优势，而*隐身*领域里还没有人这样做。

### 3.3 内部（纵向）一致性
每个指纹面都必须描述**同一台合理的真实机器**，而且这台机器必须与二进制**实际使用的渲染后端**一致。一个 WebGL renderer 字符串不能与矛盾的 `MAX_TEXTURE_SIZE`、
不符合分布的 `hardwareConcurrency + deviceMemory`、纽约时区下的柏林地理位置共存，更不能与最强的 GPU 破绽共存：一个来自与 renderer 字符串所声称的不同 GPU 的 `readPixels` 哈希。
各个面要**先按档次（tier）**从精选的真实设备分布中抽取，绝不各自独立随机。

---

## 4. 检测面矩阵

✅ adryfish 基础已覆盖 · ➕ clearcote 新增/升级 · ★ 差异化

| 指纹面 | adryfish 基础 | 最佳参考 | clearcote 的行动 |
|---|:-:|---|---|
| UA + 完整 Client Hints | ✅ | Camoufox navigator | 保留，强制一致 |
| navigator.webdriver / cdc_ 清理 | ✅ | BotBrowser removeHeadless | 保留 + 审计 |
| Canvas 2D | ✅ 加噪 | Brave 按站点 farble | ➕ 按 eTLD+1 |
| WebGL 参数/vendor/renderer | ✅ | Brave + Camoufox | ➕ 按站点 + 自洽的 GPU |
| **WebGPU** | ⚠️ | Brave webgpu | ➕ 常被遗漏 |
| AudioContext | ✅ | Brave webaudio | ➕ 按站点 |
| 字体（列表 + 度量） | ⚠️ | Camoufox font-hijacker；Cromite | ➕ 列表 + 度量抖动 |
| 屏幕/显示/DPR | ✅ | ChromiumFish display | 保留 |
| 硬件（核数/内存）相互关联 | ✅ 值 | ChromiumFish fingerprint-profile | ➕ 强制一致性 |
| 时区 + 区域（原生） | ✅ | CloakBrowser geoip | 保留 |
| **TLS / JA3 / JA4** | ❌ | ChromiumFish tls-fingerprint | ➕ **按版本的 group 表** |
| WebRTC IP | ✅ | Camoufox webrtc-ip | 保留 |
| **经 SOCKS5 的 QUIC/STUN** | ❌ | BotBrowser | ★ 少见、价值高 |
| 媒体设备 | ⚠️ | BotBrowser；Camoufox | ➕ 新增，受权限控制 |
| 语音/voices | ❌ | Camoufox + Brave | ➕ 新增，注意异步竞态 |
| 地理位置 | ✅ | Camoufox | 保留，不自动授权 |
| 设备传感器 | ❌ | ChromiumFish device-sensors | ➕ 新增 |
| 计时（performance.now） | ❌ | ChromiumFish timing-misc | ➕ 回归断言 |
| 封闭 Shadow DOM | ✅ | adryfish FakeShadowRoot | 保留 |
| 端口扫描保护 | ❌ | BotBrowser | ★ 差异化 |
| **去除 Google 遥测（GCM :5228）** | 部分 | （ChromiumFish 没通过自己的审计） | ★ 在隐私上胜过它们 |

---

## 5. 各分支的深入发现

### 5.1 Brave（farbling 的黄金标准）
专门的 farbling 服务 + 逐个面的浏览器测试；按 eTLD+1、按会话的确定性种子。"随机化，而不是屏蔽"的标准开源实现。clearcote 的 L0 种子引擎照搬的就是这个模型。

### 5.2 ChromiumFish（公开的 TLS + 画像实现中最好的）
- `persona-seed.patch`：展示了确切的管线：`--persona-seed` 通过 `render_process_host_impl.cc` 中的 `kSwitchNames[]` 转发给每个渲染进程，由 `fingerprint_profile.cc DeriveFromSeed` 读取。
- `tls-fingerprint.patch`：找到的最有启发性的网络补丁（见 §6）。
- **Canvas Bridge**：一个*可选*的渲染服务，运行在真实的 Windows GPU 上；无头的 Linux 浏览器把 canvas/WebGL 读取路由给它，以获得真实硬件的结果。
  这是对"SwiftShader 会暴露你"最有力的回答。其它项目都没有。
- 固定 `UPSTREAM_REVISION` 以实现可复现。
- **它自己公开的审计发现它会联系 Google**（组件更新器 + 5228 端口上的 GCM 推送）：这是 clearcote 可以胜过的真实隐私缺口。

### 5.3 BotBrowser（值得借鉴的另一种模型）
大部分是专有的（只开源了 GUI 启动器 + 示例补丁：`webglAttrs.diff`、`timezone.diff`、`removeHeadless.diff`、`video_capture_device_descriptor.cc.diff`）。它公开的架构文档揭示了：
- **按上下文的指纹**：每个 `BrowserContext` 拥有独立身份，不需要新进程，毫秒级切换，约节省 29% 内存。可扩展性的前沿。
- **经 SOCKS5 的 UDP**：让 QUIC/STUN 通过代理隧道传输，不会绕开代理泄露（DNS 也走代理）。大多数分支只遮蔽 WebRTC IP；这是它们忽视的一个真实缺口。
- **档案是采集来的真实设备包**（加密的 `.enc`），而不是从种子合成：天然自洽，代价是需要一个档案库。
- 端口保护（防御对 localhost 服务的扫描）。

### 5.4 Camoufox（指纹面广度的参考）
Firefox 分支，但拥有**最完整的开源伪装面清单**：反字体指纹、audio-context + audio-fingerprint-manager、fingerprint-injection、font-hijacker、
font-list + system-ui-font、geolocation、locale、media-device、navigator、screen、timezone、voice/speech-voices、webgl、webrtc-ip、shadow-root-bypass。
配置结构 `additions/camoucfg/MaskConfig.hpp`（`webGl:parameters`、`voices`、`humanize:minTime/maxTime`、带 `precision` 的范围）是 clearcote 配置的好模型。

### 5.5 Cromite
ungoogled 风格的 Chromium，以独立补丁的形式引入源自 Brave 的指纹缓解措施（`build/patches/*fingerprint*`、`Multiple-fingerprinting-mitigations.patch`），
证明了 clearcote 需要的"把 Brave 移植到 ungoogled 上"的模式是可行的。它还附带了 `docs/Papers/`：支撑这一切的学术指纹文献。

---

## 6. TLS 指纹：研究最多的子系统（附一处更正）

ChromiumFish 的 `tls-fingerprint.patch` 修改了 `net/base/features.cc`（`kTlsMldsaSignatures`）和 `net/socket/ssl_client_socket_impl.cc`。
RESEARCH.md 最初的说法是："149 新增了 ML-DSA sigalgs `0x904–0x906`；禁用它们，让 ClientHello 与更旧的 Chrome 一致。"

**有依据的更正（已对照原版 149 源码树验证）：** `kTlsMldsaSignatures` **和** `kTLSTrustAnchorIDs` 在**原版 149 中已经是 `FEATURE_DISABLED_BY_DEFAULT`**。
所以原版 149 构建的 JA4 已经与真实的 Chrome 149 一致："1 比特就能看出不是真 148"的说法是反的。clearcote 真正需要做的 TLS 工作是：
- 一个**可按版本选择、与 UA 生成器协调的 `supported_groups` / `key_share` 表**（让 ClientHello 与*所宣称的* Chrome 版本一致），以及
- **回归断言**，确保 adryfish 的移植没有意外打开后量子 sigalgs（**不要**硬编码经典分支：那会与真实 149 能完成的、由服务器触发的后量子握手不同步）。

这种更正只能来自阅读真实的源码，而不是营销材料。

---

## 7. 隐身补丁架构（PATCHES.md 摘要）

10 个领域中的 66 个候选补丁，组织为 **3 层**：

- **L0：farbling 核心 + 画像引擎**（P0）：`--clearcote-seed` 根 → 按 eTLD+1 的 token → `FingerprintProfile` 画像结构（UA/屏幕/硬件/GPU 从真实集群中先按档次抽取）。
  两个读取方，一个根。一切都通过 `SessionCache::From(context)` / `fingerprinting::Current()` 解析。
- **L1：adryfish 142→149 基础移植**：基础伪装；它的单一全局种子被**升级为按 eTLD+1**，而不是重复打补丁。一个带**构建时 `static_assert`** 的审计门禁，
  只要还有任何面读取全局种子就让编译失败。
- **L2：逐个面的补丁**：canvas/webgl/webgpu/audio/fonts/navigator/screen/TLS/webrtc/geo-media/sensors/timing/de-google/humanize。

### 三条不可妥协的规则
1. **绝不留空，绝不置零**：置零的 `readPixels` / 空的 `getVoices()` 比真实值更容易暴露；要一致地扰动。
2. **绝不直接读取全局种子**：由构建时断言强制执行。
3. **绝不让一个常量把整批实例归为一类**：字体集、`prefers-color-scheme`、电池电量按画像抽取（共享的常量就是一个可关联的群组）。

### 来自对抗性检测方评审的主要修正
- **一个画像 GPU**，与实际渲染后端一致：真实 Windows 部署用 Intel UHD 770 / ANGLE-D3D11，无头用 ANGLE-SwiftShader，
  让 renderer 字符串与 readPixels 哈希始终一致（解决了草案中一个会*增加*可检测性的矛盾）。
- **受权限控制的面**模仿真实 Chrome：在 `getUserMedia` 之前媒体标签为空，地理位置不自动授权，`speechSynthesis` 保留"先为空、再触发 `voiceschanged`"的异步竞态。
- 补充了缺失的面：`getBoundingClientRect`/transform 精度抖动、WebGL FLOAT readPixels 的 epsilon、`getHighEntropyValues` 的顺序、超越函数 ULP 暴露操作系统、OfflineAudioContext 渲染速率。

### 分阶段
P0 = 种子 + 画像 + GPU 解析 + 一致性 + 版本冻结 + TLS group 表 + 审计门禁。P1 = 逐个面的 farbling。P2 = 纵深防御 + 打磨。

（包含真实 Chromium 149 目标路径的完整文件级细节见 `PATCHES.md`。）

---

## 8. 构建基础设施与交叉编译历程

### 8.1 目标与方法
- **目标：Windows x64。** **方法：在 Linux 机器上交叉编译**（与用户商定；排除了本地 PC：只有 VS 2019/2017 + 旧 SDK + 24 GB 空闲空间，而且用户要求所有构建工作都通过 SSH 进行）。
- 通过 ungoogled 的 `downloads.py retrieve/unpack` 获取基础 Chromium 149.0.7827.114。

### 8.2 源码准备（已完成）
1. 配置机器：16 GB 交换空间（Chromium 链接很吃内存）、build-essential、depot_tools。
2. 下载并校验哈希 Chromium 149 源码（1.5 GB lite 源码包 → 解压后 9.7 GB）。
3. `prune_binaries.py` → `patches.py apply`（111 个 ungoogled 补丁）→ `domain_substitution.py` → 得到位于 `~/clearcoat/build/src` 的原版 ungoogled-149 源码树（7.9 GB）。

### 8.3 遇到并解决的工具链坑（Linux 主机）
- **域名替换破坏了工具链下载 URL。** ungoogled 会混淆源码中的 Google 域名，包括 `tools/clang/scripts/update.py` 中的
  （`commondatastorage.googleapis.com` → `commondatastorage.9oo91eapis.qjz9zk`）。修复：撤销域名替换，用真实 URL 获取工具链（clang/rust/sysroot），然后构建。
  （之后在去 Google 加固阶段再重新应用域名替换。）
- **depot_tools 以 root 身份无法引导它自带的 Python**（"Running depot tools as root is sad"；`python3_bin_reldir.txt` 从未生成）→ 它的 `gn`/`ninja` 包装脚本失效。
  修复：从源码树内的源码构建 `gn`（`tools/gn/bootstrap/bootstrap.py`）+ 从 apt 安装真正的 `ninja` + 把源码树的 clang 放进 PATH（否则找不到 `clang++`）。
- **`bootstrap.py -o out/Default` 会覆盖该目录**：`-o` 是 gn *二进制*的输出路径，不是构建目录；它覆盖了 `out/Default/`（以及 `args.gn`）。
  修复：使用它留在 `out/Release/gn_build/gn` 的 gn 二进制，重新创建 `out/Default/` + `args.gn`，然后 `gn gen`。
- Linux 构建的 **`gn gen` 成功了**；第一次 `ninja chrome` 随后暴露出缺少 **node** 二进制（一个通常由 DEPS 获取的主机工具），通过
  `third_party/node/update_node_binaries` 获取（node v24.12.0）。（之后因转向 Windows，Linux 构建暂时搁置，但 node 是*主机*构建工具，Windows 交叉构建也需要它。）

### 8.4 Windows 交叉编译方案（进行中）
在 Linux 上为 Windows 交叉编译 Chromium 使用 **clang-cl + lld-link**（源码树中已有），但需要 **MSVC + Windows SDK** 的头文件/库。
Chromium 的官方方式是从一台 Windows 机器打包它们（`package_from_installed.py`），这被排除了（只能用 SSH，本地 PC 不够用）。

**方案：`xwin`**：直接从微软的 CDN 下载官方的 Windows 11 SDK + CRT（需接受许可协议）到 Linux 机器上，不需要 Windows 机器。**已完成：630 MB 的 SDK/CRT 已展开到 `~/clearcoat/winsdk`。**

**剩余的接线工作：** Chromium（`DEPOT_TOOLS_WIN_TOOLCHAIN=0` 时）读取 `GYP_MSVS_OVERRIDE_PATH` + `WINDOWSSDKDIR`，并在交叉构建时从
`win_sdk/bin/SetEnv.x64.json`（通常由 `package_from_installed.py` 生成）加载 include/lib 路径。xwin 的扁平 sysroot 必须映射成 `package_from_installed` 风格的目录结构：
- xwin `crt/{include,lib/x86_64}` → `VC/Tools/MSVC/<ver>/{include,lib/x64}`
- xwin `sdk/{include,lib}/...` → `win_sdk/{Include,Lib}/<sdkver>/...`
- 合成 `win_sdk/bin/SetEnv.x64.json`（INCLUDE = VC include + sdk um/shared/ucrt/winrt；LIB = VC lib/x64 + sdk um/x64 + ucrt/x64）。
然后设置环境变量，并在 `args.gn` 中设置 `target_os="win"` `target_cpu="x64"` → `gn gen` → `ninja chrome` → `chrome.exe`。
（`rc.exe`/`midl` 由 Chromium 已检入的 `third_party/win_build_output` + 预编译的 linux `rc` 处理。）

### 8.5 当前的 `args.gn`（Linux 基线；Windows 另加 target_os/cpu）
```
# ungoogled flags.gn (de-Google) + enable_widevine=false
is_debug=false
symbol_level=0
blink_symbol_level=0
is_official_build=false   # → switch to true for stealth-grade release (true-to-Chrome optimization)
is_component_build=false
use_remoteexec=false
target_cpu="x64"
proprietary_codecs=true
ffmpeg_branding="Chrome"
# Windows cross adds: target_os="win"
```

---

## 9. 未决事项与下一步

1. **移植来源：** 现在从 142 开始，还是等 144 源码（跨度更短）。
2. **发布构建：** 生产环境改为 `is_official_build=true`（与真实 Chrome 的优化一致 → 更好的 TLS/行为一致性）。
3. **GPU 画像的部署目标：** 真实 Windows 主机（ANGLE-D3D11 / Intel UHD 770）还是无头（ANGLE-SwiftShader）：按部署场景选择。
4. **紧接着的下一步：** 完成 xwin→gn 的 Windows 接线 → 第一次 `chrome.exe` 交叉构建 → 确认 Playwright 能通过 `executablePath` 驱动它（硬性的即插即用要求）→
   然后叠加 adryfish 142→149 → 然后是 PATCHES.md 的 P0。

### 必须达到的最终状态：Playwright 即插即用（硬性要求）
clearcote 必须像 CloakBrowser 一样工作：一个返回标准 Playwright `Browser` 的 `launch()`，外加原始的 `chromium.launch(executablePath=...)`。
Python + JS SDK 负责获取 → 校验（SHA-256）→ 缓存 → 启动。可复现构建 + Sigstore/cosign 来源证明 = "100% 开源 + 可验证"的信任差异点。

---

## 10. 机器上的文件清单

```
~/research/                 16 reference repos (brave-core, cromite, fingerprint-chromium,
                            ungoogled-chromium-149, CloakBrowser, chromiumfish, BotBrowser,
                            camoufox, invisible_playwright, kameleo,
                            undetectable-fingerprint-browser, rebrowser-patches,
                            patchright-python, nodriver, SeleniumBase, undetected-chromedriver)
~/clearcoat/build/src       vanilla ungoogled-149 source tree (pruned, patched)
~/clearcoat/build/src/out/Release/gn_build/gn   in-tree-built gn binary
~/clearcoat/winsdk          xwin: Windows 11 SDK + CRT (630 MB)
~/clearcoat/bin/            gn, xwin
~/clearcoat/logs/           build/toolchain logs + status files
~/clearcoat/*.sh            prepare/toolchain build scripts
~/depot_tools/              depot_tools (gn/ninja wrappers unusable as root; use in-tree gn)
```

---

*配套文档：`RESEARCH.md`（全局综述）· `PATCHES.md`（文件级隐身补丁清单，66 个补丁，真实的 Chromium 149 目标路径）。*
