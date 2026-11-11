# 升级 code-browser：Chromium 149 → 150，标准方案

> **状态（151）：** 开源构建升级到 Chromium 151（`151.0.7922.108`，`v0.1.0-pre.25`）。对用户的变化：构建现在是 **official** 类型
> （`is_official_build=true`、ThinLTO + PGO，二进制约小 30%），并且不再编译 DCHECK，所以 150 构建中 DCHECK 一类的崩溃
> （"page crashed!" / `STATUS_BREAKPOINT`，issue #20 和 #24）消失了；在没有 `CAP_SYS_NICE` 的容器中以 root 运行也不再在启动时中止。
> `fakeShadowRoot` 不再暴露在 `Element.prototype` 上（`960`）。自 150 以来新增的引擎工作：带认证的 SOCKS5 与 SOCKS5 UDP ASSOCIATE
> （`963`、`973`、`978`、`984`）、GPU/WebGL/WebGPU 画像一致性（`965`–`970`、`976`、`982`、`983`、`985`）、窗口/屏幕/DPR 一致性
> （`961`、`962`、`972`、`975`）、画像校验器与第 2 版画像结构（`974`、`977`、`980`、`981`），以及可移植的配置密钥（`964`）。
> `951` 已删除（死代码，不在 151 源码树中）；仅 macOS 的 `956`–`958` 留在 `patches/macos-150/` 中，随 150 macOS 构建使用。
> 这次升级的教训：official 构建比旧配置开销大得多（Windows 交叉 ThinLTO 在 8 核上约 12 小时，链接时约 31 GB 内存；
> 开启 ThinLTO 时绝不要设置 `concurrent_links`）；必须下载 Windows PGO 配置文件（`scripts/04-configure-build.sh`）；
> 并且这个构建必须关掉两个 official 默认项（Windows 交叉构建上的 `enable_resource_allowlist_generation`，以及 Linux 上的 CFI），
> 见 [BUILDING.md §5](BUILDING.md#5-配置与构建)。ungoogled-chromium-windows 叠加层必须在域名替换之前应用。

> **状态：** 已完成。开源构建已于 2026-09-28 升级到 Chromium 150（`150.0.7871.114`，`v0.1.0-pre.23`）。保留本文作为下一次升级（N → N+1）的模板。
> 这次的教训：用**同一棵**打过补丁的源码树同时构建 Windows 和 Linux 二进制（包括叠加层，见 `scripts/01-apply-patches.sh`）；
> 不要往兜底的 `950-misc-REVIEW` 补丁里塞任何东西；发布之前，把全新的上游 + `patches/series` 应用结果与构建所用的源码树做字节级比较：
> 那些在源码树中改了、却从未被收进补丁的修改，正是这项检查能发现的。

`$BOX` = 构建主机（SSH）。所有构建工作只在 `$BOX` 上进行；`gh`/`git push`/发布在本地 Windows PC 上运行。仓库克隆路径记为 `/tmp/ccrepo`；
构建树为 `~/code-browser/build/src`。本方案适用于任何大版本升级（N → N+1）。

---

## 1. 摘要 / 关键路径

决定一切的少数几件事：

1. **等待 ungoogled-150 基础标签出现。** 截至 2026-06-17 还**没有**（最新是 `149.0.7827.114-1`）。Chrome 150 稳定版目标日期是 2026-06-30；
   预计 ungoogled 的 `150.*` 标签在 2026 年 7 月上中旬发布。**不要针对还在变化的 Dev 版本开始正式移植。**（见 §2。）
2. **拿到 150 源码树后，首先重新验证补丁 `900-windows-build-fixes`。** 这里出问题会阻塞*整个*交叉构建：在动任何源码指纹补丁之前，
   先修好工具链/`.rc`/UIA-CLSID 相关的 hunk。
3. **重新移植 6 个高脆弱性补丁**（`010` UA、`040` 字体、`050` clientRects、`060` canvas、`070` webgl-gpu，以及 `100` webrtc）：人力/agent 的时间主要花在这里。
4. **在现有的 `out/Default` 中做一次后台的 `ninja -k 0` 构建**（增量，绝不清空重建）。
5. **验证指纹防御确实仍然有效**（而不只是"能编译"）：Skia Graphite 是这次升级中头号的静默失效风险。

**现实的时间分配：**
- **无法避免的机器时间：** 完整获取并解压 150 源码（约 1.5 GB → 约 10 GB）+ 第一次完整构建 = 数小时到约 2 天的 ninja 墙钟时间。
  这是固定成本；用不会阻塞它的工作与之并行。
- **人力/agent 投入：** 移植补丁 + 解决 reject。采用并行的"每个 reject 一个 agent"方式（142→149 就是这样做的），预算约 **0.5–1.5 天**的实际工作，
  主要花在 6 个高脆弱性补丁 + 手动更新 `fingerprint_data.h` 中的版本号 + Graphite 重新验证上。

结论：墙钟时间上最长的是构建；*注意力*上最长的是移植。尽早在后台启动完整构建，在它运行时并行移植。

---

## 2. 前置条件与是否开工

| 依赖 | 状态（2026-06-17） | 决定 |
|---|---|---|
| **ungoogled-chromium 150 标签** | 没有（最新 `149.0.7827.114-1`） | **门槛。** 见下面的决策树。 |
| **ungoogled-chromium-windows 150 叠加层** | 没有（最新 `149.0.7827.114-1.1`） | 在核心标签之后数小时到数天内发布。固定 `UGW_TAG` 之前确认它已存在。 |
| **adryfish 150** | 死路（停在 144） | **忽略。** 不要等它。基于 149 的 code-browser 补丁栈就是权威基础；从 code-browser 向前移植 `142→150`，而不是从 adryfish。 |
| **Chromium 150 源码包** | M150 分支 = **7846**；Dev 是 `150.0.7846.4`；稳定版会是 `150.0.7846.NN` | ungoogled 标签发布后，从它的 `chromium_version.txt` + `downloads.ini` 获取确切版本/哈希，而**不是**从 chromiumdash 猜。 |
| **Windows SDK 10.0.26100 / xwin 工具链** | 已在 `$BOX` 上 | **复用。** 与 Chromium 版本解耦。只有 150 强制要求时才叠加更新的头文件（149 已经需要一个 `UIAutomationCore.h` 叠加，需重新检查）。 |

**是否开工的决策树：**

- **如果 ungoogled-150 标签已存在** → 开工。从它的 `chromium_version.txt` 取得确切的稳定版版本号，进入 §4。
- **如果还不存在，且升级不紧急** → **等待。** 对着 Dev 做 diff 是浪费精力（锚点会在你脚下移动）。每周查看一次 [标签页](https://github.com/ungoogled-software/ungoogled-chromium/tags) 和 150 的跟踪 issue。
- **如果还不存在，但必须现在推进** → **自己移植 ungoogled 的差异**：直接拿上游 Chromium `150.0.7846.NN -lite` 源码包，手动应用 ungoogled `master` 分支的补丁集（去 Google 化），
  然后是 windows 叠加层，然后是 code-browser。工作量更大，而且你要自己承担 ungoogled 变基的风险：只有在进度确实要求时才这样做。

> 节奏提示：这是**最后一次从容的（约 4 周）升级**。从 M153（约 2026-09-08）起，Chrome 改为**两周**一个里程碑。考虑现在就把重新移植脚本化。

---

## 3. 版本固定清单（每一处要更新的"149"）

**加粗**的是承重的固定项：它们真正决定源码 / 是信任锚点。其余是文档/外观上的，但为了正确性也必须更新。

**源码选择（承重）：**
- [ ] **`scripts/00-fetch-source.sh` `UG_TAG`** `149.0.7827.114-1` → `150.0.7846.NN-1` ← *真正决定 Chromium 版本*
- [ ] **`scripts/00-fetch-source.sh` `UGW_TAG`** `149.0.7827.114-1.1` → `150.0.7846.NN-1.1`（确认叠加层标签存在）
- [ ] **`scripts/00-fetch-source.sh` 子依赖** 重新阅读 150 的 `DEPS`：`microsoft_webauthn` + `microsoft_dxheaders` → 更新两个 SHA
- [ ] `UPSTREAM_REVISION` `149.0.7827.114` → `150.0.7846.NN`（文档上的唯一来源）

**内容正确性（容易忘，漏了能被检测到）：**
- [ ] **`components/ungoogled/fingerprint_data.h`** 手动更新硬编码的 `149.0.7827.*` Chromium 以及 Edge/Opera/Vivaldi 版本 → 150 的发布版本号。
  *过时 = 伪装的 UA/UA-CH 内部不一致 = 可被检测。*（这是补丁 `001` 的内容，而不是 reject。）
- [ ] `config/args.gn`：没有版本字符串，但要**与 150 的 ungoogled `flags.gn` 做 diff**，修复任何被 gn 拒绝/改名的参数
  （`v8_drumbrake_bounds_checks`、`dawn_use_built_dxc`、`blink_symbol_level`、`chrome_pgo_phase`……）

**产物 / 发布（从 150 的 zip 重新计算，不要猜哈希）：**
- [ ] `scripts/05-package.sh` 默认 `V` `149.0.7827.114` → 新版本（或在命令行传 `V=`）；更新 manifest 注释
- [ ] **`sdk/node/src/release.ts`** `tag`、`version`/`asset`/`url`，**从 150 产物重新计算 `sha256`（zip）+ `exeSha256`（chrome.exe）+ `size`**
- [ ] `sdk/node/package.json` `version` → 升级（与 Chromium 版本无关）
- [ ] **`sdk/python/code_browser/release.py`** `tag`/`version`/`asset`/`url`，**重新计算 `sha256`/`exe_sha256`/`size`**，与 node 逐字节一致
- [ ] `sdk/python/pyproject.toml` `version` → 升级

**文档 / 外观：**
- [ ] `docs/en/BUILDING.md` 三处固定版本 + ungoogled 提交 SHA、正文
- [ ] `docs/en/RELEASING.md` 示例值；**修复 `149.*.manifest` 的 grep 守卫**
- [ ] `README.md`：徽章 `Chromium-149`→`150`、状态/标签、审计表中的 Build/UA/UA-CH（重新运行 CreepJS 审计）、产物名。
  *注意 UA-CH 的次版本号 ≠ 构建补丁号：从真实的 150 二进制刷新。*
- [ ] `scripts/creepjs_audit.py` 硬编码的 `Build 149.0.7827.114` → 改为从 `chrome/VERSION`/`UPSTREAM_REVISION` 读取，而不是硬编码
- [ ] `build.sh` 阶段标题 `149`→`150`（外观）
- [ ] `docs/en/PATCHES.md`、`RESEARCH-DOSSIER.md`、`RESEARCH.md`、`patches/README.md`：对照 150 源码树重新验证回归断言
  （TLS 特性默认值、`time_clamper.h`、`ssl_client_socket_impl.cc` 行号）；`149`→`150`，移植目标变为 `142→150`

---

## 4. 逐步升级

全部在 `$BOX` 上、在现有的 `~/code-browser/build` 树中进行（增量：**不要**删掉 `out/Default`）。

1. **固定源码**：确认 150 标签已上线后，更新 `UG_TAG`/`UGW_TAG`/子依赖 SHA（§3）。
2. **获取 + 解压（`00-fetch-source.sh`）**：克隆/检出 ungoogled-150 + windows-150 叠加层；用 `downloads.py retrieve+unpack` 把确切的 150 源码包解压到 `build/src`；
   用 `pruning.list` 运行 `prune_binaries.py`；按 150 固定的 SHA `fetch_dep` 两个 Windows 子依赖。
3. **恢复 MIDL `.tlb` 文件**：清理会删除 `third_party/win_build_output` 下约 48 个已检入的 `.tlb`；**重新推导 150 的文件集**（可能会变），并从 150 源码包恢复。
   交叉编译的 MIDL 无法重新生成它们。
4. **应用补丁层（`01-apply-patches.sh`）**：(1) ungoogled 基础，(2) windows 叠加层，(3) code-browser `patches/` 系列。预计第 3 层会有 reject → §5。
5. **复用工具链，不要重新获取。** 保留 `~/code-browser/wintoolchain`（MSVC + SDK 10.0.26100、`SetEnv.x64.json`、ciopfs include 挂载）、winsdk、主机 sysroot、主机 node。
   **只需重新检查：** 150 是否需要更新的 SDK 头文件叠加？（149 需要 `UIAutomationCore.h` + 一个手动定义的 CLSID。）
6. **让新的源码树内工具链随 150 一起到来（`02-host-toolchain.sh`）**：clang/lld、Rust、gn 由 150 检出固定，并会自动重新获取。
   **更新 `clang_rt.builtins` 的放置路径**：clang 的主版本目录很可能随 150 的 clang 升级而变化 → 把 `clang_rt.builtins-x86_64.lib`
   放到 `third_party/llvm-build/Release+Asserts/lib/clang/<NEW_N>/lib/windows/`。
7. **配置（`04-configure-build.sh`）**：`ulimit -n 1048576`；PATH 中放源码树的 clang/lld；`DEPOT_TOOLS_WIN_TOOLCHAIN=1`（**不是** 0）、`GYP_MSVS_OVERRIDE_PATH`、
   `WINDOWSSDKDIR`、`GYP_MSVS_VERSION=2026`、`WDK_DIR=`；复制已验证的 `args.gn`；`gn gen out/Default`（在这里修复参数漂移错误，§3）。
8. **构建**：§6（单次后台 `ninja -k 0`）。
9. **验证**：§7。不要仅凭编译通过就发布。
10. **打包（`05-package.sh`）**：确认自动推导的 `150.0.7846.NN.manifest` 确实在 zip 中（`*.manifest` 通配与版本无关，这很好）。
11. **重新发布 + 升级 SDK**：§8。

---

## 5. 高效的补丁移植策略

**顺序：先碰风险最高的，让 reject 尽早暴露并能并行处理：**

1. **`900-windows-build-fixes`（构建阻塞，高）**：在其它一切之前验证。重新移植 `tool_wrapper.py` 的 `ExecRcWrapper` 重写、`is_win` 下
   `clang_lib("compiler_builtins")` 的 `libname="builtins"`、`.rc` 中的 `BUILDFLAG()` 守卫。**注意 UIA-CLSID 可能从缺失符号变成*重复*符号**：
   如果 150 提高了 SDK 下限，并自行定义了 `CLSID_CUIAutomationClientInfoSource`。
2. **已知的反复出问题的点（先查，开销低）：** `090-timezone`（`timezone_controller.cc`：WTF `String::FromUtf8` 有改名历史；重新检查是否又改名 +
   `SetIcuTimeZoneAndNotifyV8` 签名 + 惰性时区初始化的门控）和 `030-hardware-concurrency`（旧的 `std::stoull` 崩溃，已改为 `base::StringToUint`，确认修复仍在）。
3. **6 个高脆弱性补丁：** `010-user-agent`、`040-fonts`、`050-shadow-dom`、`060-canvas`、`070-webgl-gpu`、`100-webrtc-leak`。
4. **在这组补丁内按依赖排序：** **`060` 在 `070` 之前**（060 的 `ShuffleSubchannelColorData` 增加了一个 `uint64_t` 种子参数，070 的 ReadPixels 会用到它：签名耦合）。

**操作方法：**

- **使用 `git apply --3way` / `patch --merge`**，让冲突以文件内的 `<<<<<<<` 标记出现，而不是孤零零的 `.rej`：在上下文中解决快得多。142→149 就是这样做的。
- **并行的"每个 reject 一个 agent"：** 为每个被拒绝的 hunk/文件分配一个 agent。它们独立工作；你只需串行处理耦合的几对（080→050、060→070）以及共享的 `fingerprint_data.h`。
- **在完整重新链接之前，逐个编译检查改动过的编译单元：** `ninja -C out/Default path/to/file.o`，这样类型/API 改名错误在**几秒内**暴露，
  而不是在数小时的链接之后。优先编译高风险的 `.o`：`webgl_rendering_context_base.o`、`static_bitmap_image.o`、`html_canvas_element.o`、
  `user_agent_utils.o`、`user_agent_metadata.o`、`font_cache.o`、`stun_port.o`。

**预先处理已知的 API 变动（主动修，不要等报错）：**

- **Skia Graphite/Dawn** 是风险最高的面。`060`/`070` 的 canvas+WebGL 读回是针对旧的 **Ganesh** 编写的；在 Graphite 下重新验证绘制/读回路径：
  *构建干净并不意味着噪声注入仍然生效。*
- **`base` span 辅助函数**（`base::byte_span_from_ref`、span API）经常变动：很可能在 `farble_seed.cc`（`001`）中出错。
- **`010` 结构体字段：** `blink::UserAgentBrandList` / `UserAgentMetadata`（`brand_version_list`、`brand_full_version_list`、`full_version`、
  `platform_version`、`architecture`）；UA 模板 + `Sec-CH-UA` 品牌版本 → **150**。
- **`040` `FontFaceSet` IDL** 在 150 中有变化（去掉了 `[LegacyNoInterfaceObject]` → 全局构造函数）；重新检查字体枚举的挂钩点。
  还有 `FontFaceCreationParams` / `GetOrCreateFontPlatformData` 的变动。
- **`060` 路径：** Skia（`SkImages::RasterFromData`、`PaintImage::GetNextContentId`）+ `partition_alloc::MaxDirectMapped()` 的 include 路径（已经移动过一次，很可能还会再动）。
- **`100` webrtc** 是一个*单独滚动*的依赖：升级到 150 会拉入不同的 libwebrtc 版本；`AddAddress(...)` 参数列表 + `IceCandidateType::kSrflx`/`ICE_TYPE_PREFERENCE_SRFLX`
  以及 `P2PPortAllocator::Config` 字段（`enable_multiple_routes`、`enable_nonproxied_udp`）都可能独立变化。`110`（`v8/src/inspector`）同理：
  这里的一个静默签名变化会重新暴露 `Runtime.enable` 自动化特征（是正确性回归，而不是编译回归）。
- **存储/配额说明：** 150 把 IndexedDB 重写到了 SQLite 上。目前不在 code-browser 补丁栈中，但如果任何补丁扩展到存储/配额面（例如存储配额伪装），预计会有冲突。

---

## 6. 高效构建

- **一次后台构建，`-k 0`：** 在 `$BOX` 上以后台方式运行 `ninja -C out/Default -k 0 chrome`（例如 `setsid`/`nohup`/`tmux`）。`-k 0` 会越过第一个错误继续，
  让**所有**编译失败在一轮中暴露，而不是每次重建只暴露一个：在大量 reject 的移植之后非常宝贵。
- **只做增量。** 在**现有的** `out/Default` 上重新移植。迭代过程中绝不做一次约 2 天的清空重建（项目规则）。
- **一个 ninja、一个输出目录、不并发。** 协调规则：绝不在多个会话/主机上并发运行 code-browser 构建。一个输出目录、一个 ninja、后台构建。
- **启动前提高文件描述符上限：** 对 ciopfs 和 ninja 都执行 `ulimit -n 1048576`，否则深层的 WinRT include 链 × 并行任务会超过 1024 → "Too many open files"。
- **如果有 ccache/reclient 就保留：** 未改动的编译单元（源码树的绝大部分）会命中缓存；只有重新移植的文件需要重新编译。
- **用不阻塞的工作与长时间构建并行：** 第一次完整构建运行期间，做 §3 中文档/SDK 的版本更新、起草发布说明、预先准备验证脚本。不要闲等 ninja。
- **先用 `ninja <file.o>` 排查**（见 §5），这样你永远不会把链接时间花在一个编译不过的编译单元上。

---

## 7. 验证门禁（发布前全部必须通过）

构建干净是**必要但不充分**的：Skia Graphite 可能静默地让 canvas/WebGL 噪声失效。在新构建的 150 二进制上运行：

- [ ] **`validate_fp.py` → 6/6**：核心指纹开关全部生效。
- [ ] **`validate_full.py`**：代理出口 + **WebRTC IP 一致性**（srflx 被改写为代理出口、host 候选被屏蔽：确认它一致地报告代理 IP，而绝不只是"已禁用"）。
- [ ] **`release_verify.py`**：用 CreepJS + browserleaks + browserscan 审计 150 二进制。
- [ ] **交互式挑战抽查**：真实世界的挑战能够通过。
- [ ] **针对 Graphite 的手动复查：** canvas `toDataURL`/`getImageData`、WebGL `readPixels`、`UNMASKED_VENDOR/RENDERER` 以及字体枚举，
  在 Graphite 绘制路径下都表现出按 eTLD+1 的扰动。**如果噪声没有生效，说明补丁编译了但防御已经失效：针对 Graphite 路径重新移植，不要发布。**
- [ ] **UA/UA-CH 一致性：** 伪装的 Chrome/Edge/Opera/Vivaldi 版本内部一致，并且处处都显示 **150**（交叉检查 `fingerprint_data.h` 的更新已生效）。

> 按项目规则：绝不为了让 reject 或失败的检查消失而丢弃隐身/反指纹补丁。去修好它。

---

## 8. 发布与回滚

1. **构建产物**，通过 `05-package.sh` 打包（确认 zip 中有 `150.*.manifest`）。
2. **从*实际的* 150 zip 重新计算信任锚点：** `sha256`（zip）、`exeSha256`/`exe_sha256`（其中的 chrome.exe）、`size`。绝不要猜。
3. **更新两个 SDK**（`release.ts` + `release.py`）的 `tag`/`version`/`asset`/`url`/哈希；升级 SDK 包版本（`package.json` / `pyproject.toml`）。保持 node 和 python 逐字节一致。
4. **端到端遵循 `docs/zh/RELEASING.md`**；为 150 发布 **`v0.1.x-pre.N`**。发布标签与 Chromium 版本互不相关。
5. **在本地 Windows PC 上**运行 `gh`/`git push`/上传发布。`$BOX` 上没有 `gh`/token。提交/PR 中**不要加自己的 `Co-Authored-By` 尾注**。
6. **更新网站**（`site/`）：`llms.txt` + `llms-full.txt` + `app/` 文档，以及仓库 README/文档，写明 150 的特性：既给 LLM/agent，也给人看。
7. **回滚：** **保留上一个（149）发布。** 如果 150 出现回归（尤其是漏过验证的 Graphite 指纹泄露），把 SDK 固定回 `149.0.7827.114` 产物 + 它的标签：
   这是 `release.ts`/`release.py` 中的一行回退。不要删除 149 的产物。

---

## 9. 省时技巧与坑点（不要再踩）

**交叉构建的坑（都与版本相关，在 150 上重新确认）：**
- **SxS manifest：** `chrome.exe` 需要 zip 根目录下有 `<完整版本号>.manifest`，否则会以 "side-by-side configuration is incorrect" 退出
  （通过 Playwright 表现为 `spawn UNKNOWN`）。`05-package.sh` 的 `*.manifest` 通配没问题；**修复 `RELEASING.md` 中硬编码的 `149.*.manifest` grep 守卫**，并重新确认文件存在。
- **ciopfs 大小写不敏感的 Include 挂载：** 必须在整个构建期间保持挂载，否则找不到 `windows.h`。挂载路径 `Include/10.0.26100.0`：如果 150 强制要求更新的 SDK，路径会变。
- **`DEPOT_TOOLS_WIN_TOOLCHAIN=1`（不是 0）：** 违反直觉；`=0` 会走 `vcvarsall.bat`（在 Linux 上不可能）。这是整个交叉构建的关键。
- **`ulimit -n 1048576`**：对 ciopfs 和 ninja 都要设。
- 清理之后要**恢复 MIDL `.tlb`**：重新推导 150 的文件集。
- **`rc.py`：** 叠加层的 `windows-disable-rcpy.patch` 是给*原生*构建用的；交叉构建需要 `rc.py` + 预编译的 Linux `rc`（由 `900` 重新指向）。如果 150 的叠加层改了它，需要重新移植。
- **`clang_rt.builtins` 放置路径**：clang 主版本目录会随 150 的 clang 升级而变化；更新放置目录，否则 fp16 内建函数（`__truncsfhf2`）无法解析。
- **`UIAutomationCore.h` / CLSID**：重新确认 150 是否仍需要该叠加 + 手动定义的 CLSID；注意是否会变成重复符号。
- **在 `args.gn` 中保留：** `rust_sysroot_absolute=""`（从源码构建 std）、`fatal_linker_warnings=false`（容忍 LNK4099）。
- **不要在获取工具链之前运行 `domain_substitution`**：它会改写 Google 下载 URL，破坏 clang/rust/sysroot 的获取（`02` 会先撤销它）。
- **gn 必须在源码树内引导**（depot_tools 预编译的 gn 拒绝以 root 引导）：`02` 会处理；自动使用 150 的 gn 源码。
- **大小写精确的 `.lib` 符号链接**：重新扫描 150 的 `.rsp` 集合；为 xwin 没有做大小写折叠的库添加符号链接（"could not open Foo.lib"）。
- **`args.gn` 参数漂移**：gn 遇到未知参数会直接报错；`gn gen` 之前与 150 的 `flags.gn` 做 diff。

**不要做的事：**
- 迭代过程中不要清空重建（那是约 2 天的路径；用增量 ninja）。
- 不要在多个会话或主机上并发运行 ninja / 使用第二个输出目录。
- 不要对着 Chromium Dev 开始移植：等 ungoogled 150 标签（§2）。
- 不要等 adryfish：它已经不再跟进当前版本；把基于 149 的 code-browser 向前移植。
- 不要重新获取 Windows SDK/MSVC 工具链：复用它；只有源码树内的 clang/rust/gn 会随检出更新。
- 不要仅凭编译干净就发布：Skia Graphite 可能静默地让 canvas/WebGL/字体噪声失效；要验证防御本身，而不只是构建。
- 不要为了清掉一个 reject 而丢弃任何隐身/反指纹补丁。
- 不要猜 SDK 哈希：从构建出来的 150 zip 重新计算。
- 不要把基础设施信息（构建主机地址 / 个人路径 / 个人邮箱）泄露到任何公开仓库、提交或发布中。
