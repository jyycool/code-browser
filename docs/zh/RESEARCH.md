# Clearcote：研究与构建蓝图

*如何构建一个全新的、100% 开源、真正优于同类的反检测 Chromium。*

综合自克隆到研究机（`~/research/`）上的 16 个参考项目：
CloakBrowser · ChromiumFish · BotBrowser · Camoufox · adryfish/fingerprint-chromium ·
ungoogled-chromium-149 · brave-core · cromite · undetectable-fingerprint-browser ·
kameleo · invisible_playwright · rebrowser-patches · patchright · nodriver ·
SeleniumBase · undetected-chromedriver。

---

## 1. 一张表看全局

| 项目 | 引擎 | 方式 | 开源？ | 值得借鉴的一点 |
|---|---|---|:-:|---|
| **brave-core** | Chromium | 按站点 **farbling**（确定性随机化） | ✅ 完全 | *正确的*随机化模型：按 eTLD+1、按会话的种子 |
| **cromite** | Chromium | 把 Brave farbling 移植到 ungoogled 风格的基础上 | ✅ 完全 | clearcote 需要的移植模式 + 学术论文 |
| **adryfish/fingerprint-chromium** | Chromium | 种子 → 指纹，基于 ungoogled | ⚠️ 延迟发布（按标签） | clearcote 所基于的确切基础 |
| **CloakBrowser** | Chromium | 源码补丁 + 人类化 + geoip | ❌ 二进制闭源 | 人类化预设、geoip、持久化配置的用户体验 |
| **ChromiumFish** | Chromium | 引擎补丁 + 画像种子 + **TLS 固定** | ⚠️ 只有补丁 | 把 TLS sigalgs/JA3 固定到所宣称的 UA；canvas 桥 |
| **BotBrowser** | Chromium | 加密的设备**档案**，按上下文 | ❌ 引擎闭源 | 按上下文的指纹、经 SOCKS5 的 UDP、端口保护 |
| **Camoufox** | Firefox | C++ 伪装，覆盖面最广 | ✅ 完全 | 最完整的*指纹面清单* + MaskConfig 设计 |
| **invisible_playwright** | Firefox | C++ Gecko 伪装 | ✅ | 对 Firefox 方案的交叉验证 |
| **kameleo** | 两者 | 引擎级遮蔽，商业 | ❌ | 双引擎架构的思路 |
| **undetectable-fingerprint-browser** | Chromium | 开源的 Multilogin 替代品 | ✅ | 直接同类；配置管理器的用户体验 |
| **rebrowser-patches** | — | 针对 PW/Pptr 的 CDP 泄露补丁 | ✅ | 也需要在引擎内修复的 CDP 泄露清单 |
| **patchright** | — | 打过补丁的 Playwright | ✅ | `chrome.runtime` 的真实感、CDP 抑制 |
| **nodriver** | — | 无 WebDriver 的直接 CDP | ✅ | 基准测试零拦截；值得模仿的自动化传输方式 |
| **SeleniumBase / undetected-chromedriver** | — | 经典的标志/痕迹清理 | ✅ | 基础的检测向量 |

**两大阵营：** *引擎级分支*（表格上半部分，clearcote 所属的类别）和*客户端/CDP 补丁*（下半部分）。
Clearcote 是引擎分支，所以上面几行是蓝图，下面几行是**你还必须在引擎内消除的检测向量目录**。

---

## 2. 大家共有的论点，以及多数人忽略的洞见

**共有论点：** 在 C++ 引擎中伪装，绝不用注入的 JS。JS 垫片恰好会在指纹审计工具检查的地方留下篡改痕迹。adryfish（clearcote 的基础）已经这样做了。

**更深的洞见，只有 Brave 完全做对了：** 好的指纹既不是*随机的*也不是*静态的*，而是**按站点确定、并且内部自洽的**。

Brave 的 farbling 从 `(session_token × eTLD+1)` 种子推导出每一个半识别性的值，因此：
- 同一站点整个会话看到**相同**的值（会话内没有闪变 = 不会被检测），
- 不同站点看到**不同**的值（无法跨站关联），
- 下一个会话 → 全新的值（无法跨会话关联）。

`brave-core` 中的证据：专门的 `components/brave_shields/content/browser/brave_farbling_service.cc`，以及逐个面的覆盖：
canvas、audio、webgl、**webgpu**、screen、plugins、useragent、languages、hardwareConcurrency、deviceMemory、
speech-synthesis、USB、enumerateDevices（见 `browser/farbling/*_browsertest.cc`）。

> **对 clearcote 而言：** 采用 Brave 的*模型*（按 eTLD+1 的确定性种子），而不只是逐个面加噪。这是相对 adryfish、CloakBrowser
> 和 ChromiumFish 最大的一项正确性提升，它们都使用单一全局种子（每个站点看到相同的 canvas → 可跨站关联）。

---

## 3. 检测面矩阵（clearcote 必须覆盖的）

✅ = 基础已覆盖 · ➕ = clearcote 必须新增/升级 · ★ = 差异化机会

| 指纹面 | adryfish 基础 | 最佳参考实现 | Clearcote 的行动 |
|---|:-:|---|---|
| UA + 完整 Client Hints | ✅ | Camoufox navigator | ✅ 保留 |
| navigator.webdriver / cdc_ 清理 | ✅ | BotBrowser `removeHeadless.diff` | ✅ 保留 + 审计 |
| Canvas 2D | ✅ 加噪 | Brave 按站点 farble | ➕ 改为按 eTLD+1 |
| WebGL 参数/vendor/renderer | ✅ | Brave + Camoufox MaskConfig | ➕ 按站点 + 自洽的 GPU |
| **WebGPU** | ⚠️ | Brave `webgpu_farbling` | ➕ 常被遗漏的面 |
| AudioContext | ✅ | Brave webaudio farble | ➕ 按站点 |
| 字体（列表 + 度量） | ⚠️ 部分 | Camoufox font-hijacker；Cromite 字体缓解 | ➕ 列表 + Skia/HarfBuzz 度量 |
| 屏幕 / 显示 / DPR / 任务栏 | ✅ | ChromiumFish display | ✅ 保留 |
| 硬件（核数/内存）**相互关联** | ✅ 值 | ChromiumFish fingerprint-profile | ➕ 强制一致性 |
| 时区 + 区域（来自代理 IP） | ✅ | CloakBrowser geoip | ✅ 保留，原生开关 |
| 地理位置（与时区一致） | ✅ | Camoufox | ✅ 保留 |
| **TLS / JA3 / JA4 / sigalgs** | ❌ | **ChromiumFish tls-fingerprint** | ➕ **第一优先级** |
| WebRTC IP 泄露 | ✅ | Camoufox webrtc-ip | ✅ 保留 |
| **经代理的 QUIC/STUN（UDP/SOCKS5）** | ❌ | **BotBrowser** | ★ 少见、价值高 |
| 媒体设备枚举 | ⚠️ | BotBrowser `video_capture…diff`；Camoufox | ➕ 新增 |
| 语音 / voices | ❌ | Camoufox + Brave | ➕ 新增 |
| 设备传感器 | ❌ | ChromiumFish device-sensors | ➕ 新增 |
| 计时（`performance.now` 量化） | ❌ | ChromiumFish timing-misc | ➕ 新增 |
| 封闭 Shadow DOM 访问（自动化） | ✅ | adryfish FakeShadowRoot | ✅ 保留 |
| 端口扫描保护（localhost） | ❌ | BotBrowser port-protection | ★ 差异化 |
| **去除 Google 遥测（5228 端口 GCM）** | 部分 | （ChromiumFish 在自己的审计中*没通过*这一项） | ★ 在隐私上胜过它们 |

---

## 4. 同类的不足 → clearcote 的机会

1. **全局种子，而不是按站点。** CloakBrowser/ChromiumFish/adryfish 对所有站点使用同一个种子 → 可跨站关联。
   **Brave 风格的按 eTLD+1 farbling 能解决这个问题，而*隐身*领域里还没有人照搬它。**
2. **新基础版本上的 TLS 不一致。** 基于 Chromium 149 构建、却伪装成更旧的 UA，会在 TLS 层泄露
   （149 新增了 ML-DSA sigalgs `0x904-0x906`；一家主要的反机器人服务会标记"UA 148 + TLS 149"）。adryfish 没有处理这一点，ChromiumFish 的补丁就是修复方案。
3. **代理周边的网络泄露。** 大多数分支只遮蔽了 WebRTC IP；QUIC/STUN 依然绕过 SOCKS5。只有 BotBrowser 做了经 SOCKS5 的 UDP 隧道，而它是闭源/付费的。
4. **并非真正私密。** ChromiumFish *自己*的审计（在你的本地文件中）发现它会联系 Google（组件更新器 + :5228 上的 GCM）。
   对一个"100% 开源"的项目来说，真正去 Google 化的构建是一个实在的、可检验的差异点。
5. **规模。** 每个身份一个进程很浪费。BotBrowser 的按上下文指纹（共享 GPU/网络进程、毫秒级切换、约节省 29% 内存）是可扩展性的前沿，而且是闭源的。
6. **闭源二进制。** CloakBrowser、ChromiumFish、BotBrowser、Kameleo 都发布无法阅读的二进制。**Clearcote 逐字节可复现 + 完全开源，本身就是信任上的差异点。**

---

## 5. 提议的 clearcote 架构

```
                 ungoogled-chromium 149   (de-Google base, build wiring)
                          │
        ┌─────────────────┼──────────────────────────────────┐
        │                 │                                   │
  adryfish patches   Brave farbling model            clearcote-native patches
  (ported 142→149)   (per-eTLD+1 seed engine)         (TLS pin, QUIC/SOCKS5,
  canvas/webgl/audio  applied to every surface         timing, sensors, media,
  /ua/fonts/webrtc    instead of single global seed     port-protect, full de-Google)
        │                 │                                   │
        └─────────────────┴──────────────────────────────────┘
                          │
              thin SDK over Playwright/Puppeteer
              (fetch→verify→cache→launch; nodriver-style transport option)
                          │
              per-context fingerprint (stretch goal)
```

**设计规则（取各家之长）：**
- 仓库结构 = **ChromiumFish**（`patches/` + `assets/` + `apply.sh` + 固定的 `UPSTREAM_REVISION`）。
- 指纹面清单 = **Camoufox**（最广）；配置结构 = Camoufox `MaskConfig.hpp`（`webGl:parameters`、`voices`、`humanize:minTime/maxTime`、带 `precision` 的范围）。
- 随机化语义 = **Brave** farbling（按 eTLD+1 确定）。
- 网络 = **BotBrowser**（DNS 走代理、经 SOCKS5 的 UDP、WebRTC SDP/ICE 过滤）。
- TLS = **ChromiumFish**（把 sigalgs/cipher/GREASE/groups 固定到所宣称的 UA）。
- 人类化 = 引擎级输入（ChromiumFish）优于客户端（CloakBrowser），但提供 CloakBrowser 的两个预设（`default`/`careful`）。
- 自动化传输 = 提供 **nodriver 风格**的无 WebDriver 路径，以获得最低的 CDP 特征。

---

## 6. 具体的构建计划

1. **打好基础：** 原版 Chromium 149 → 应用 ungoogled-149（已在机器上）→ 确认 `chrome --version` 显示 ungoogled。
2. **把指纹补丁从 `142` 移植到 `149`**（adryfish 144 的源码尚未发布；142 是最新可用的标签）。把 adryfish-142 源码树与原版 142 做 diff，
   重放到 149 上，解决 reject，修复 API 变化，编译。*（先摸底：试运行应用补丁，统计 reject 数量。）*
3. **按优先级叠加升级：**
   1. **TLS 固定**（ChromiumFish 的思路）：投入产出比最高，基于 149 时是必需的。
   2. **按 eTLD+1 的 farbling 种子**（Brave 模型），覆盖 canvas/webgl/webgpu/audio。
   3. **经 SOCKS5 的 QUIC/STUN** + DNS 走代理。
   4. 计时、设备传感器、媒体设备、语音（补齐 adryfish 的缺口）。
   5. **完全去 Google 化**：关掉组件更新器 + :5228 上的 GCM（在 ChromiumFish 被审计出的弱点上胜过它）。
   6. 端口保护。
4. **SDK：** 基于 Playwright 的轻量 Python+JS 封装（`executablePath=…`），负责获取/校验（SHA-256）/缓存。可选 nodriver 风格的传输方式。
5. **延伸目标：** 按上下文的指纹（BotBrowser 模型），用于扩展规模。
6. **验证：** 对照 CreepJS、BrowserScan、Pixelscan、线上反机器人服务，以及与所宣称版本的真实 Chrome 做 JA3/JA4 字节级 diff。

---

## 7. clearcote *更好*在哪里（卖点）

| 维度 | 同类现状 | Clearcote |
|---|---|---|
| 跨站可关联性 | 单一全局种子（可关联） | **按 eTLD+1 farbling（不可关联）** |
| TLS 一致性 | adryfish 忽略了 | **固定到所宣称的 UA** |
| 代理泄露面 | 只有 WebRTC | **+ 经 SOCKS5 的 QUIC/STUN/DNS** |
| "隐私"浏览器的隐私性 | 会联系 Google（ChromiumFish） | **完全去 Google 化、可验证** |
| 信任 | 闭源二进制 | **100% 开源 + 可复现构建** |
| 规模 | 每个身份一个进程 | **按上下文指纹（延伸目标）** |

一句话论点：**以 adryfish 的开源 Chromium 为基础，赋予它 Brave 按站点随机化的正确性、ChromiumFish 的 TLS 严谨性、
以及 BotBrowser 的网络泄露覆盖，做成一个 100% 开源、可复现的单一构建。**

---

## 8. 风险 / 未决问题

- **142→149 的补丁变动**跨越 7 个大版本；涉及指纹的文件变动很大。缓解办法是逐步移植并固定上游版本。
- **adryfish 源码滞后**：也许值得等 144 的源码以缩短跨度，而不是现在就从 142 开始。
- **farbling 的集成成本**：Brave 的 farbling 与 Brave Shields/偏好设置紧密耦合；只把种子 + 逐个面的逻辑抽取到 ungoogled 上并不简单（Cromite 证明了这是可行的）。
- **构建资源**：在 8 vCPU/32 GB 的机器上完整构建 Chromium 很慢，但配合 640 GB 磁盘是可行的；第一次构建是最耗时的环节。
- **维护**：每个 Chrome 大版本都要重复移植。为此预留预算；尽可能自动化 diff/apply。

---

## 附录：机器上已有的延伸阅读
`~/research/cromite/docs/Papers/` 包含指纹识别方面的学术文献
（大规模指纹分析、反追踪对策比较、新兴指纹技术的自动发现），也就是上面每一个补丁背后的理论。
