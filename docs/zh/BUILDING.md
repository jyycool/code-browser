# 从源码构建 CodeBrowser

CodeBrowser 的设计目标是：任何拥有一台性能足够的 Linux 机器的人都能重新构建它。本指南在 Linux 主机上复现已发布的
**Windows x64**（交叉编译）和 **Linux x64**（原生编译）二进制，不需要 Windows 机器。最简单的方式是下面固定版本的
**[Docker 构建](#容器方式推荐所有人使用相同环境)**。**你应当能够自己产出一个二进制，并确认它与发布版本一致**
（见文末关于可复现性的说明）。

> CodeBrowser = Chromium → ungoogled-chromium（去 Google 化）→ Windows 叠加层 + CodeBrowser 指纹补丁 → 交叉构建。每一层都是开源且固定版本的。

## 固定版本（本次发布的构建来源）

| 组件 | 固定版本 |
|---|---|
| Chromium | `151.0.7922.108`（见 [`UPSTREAM_REVISION`](../../UPSTREAM_REVISION)） |
| ungoogled-chromium | 标签 `151.0.7922.108-1`（提交 `ecbcc4c1413c961e37d4224f787fecb8534b1505`） |
| ungoogled-chromium-windows | 标签 `151.0.7922.108-1.1`（提交 `0314145a88835602a48d656fd9836e5f5644721c`） |
| 工具链 | Chromium 源码树内的 clang/lld（Windows 目标使用 clang-cl + lld-link） |
| 构建类型 | 自 Chromium 151 起为 **official**（`is_official_build=true`：ThinLTO + PGO，不编译 DCHECK） |
| PGO 配置文件 | 该版本 Chromium 自带的：`chrome/build/win64.pgo.txt` / `linux.pgo.txt` 中写明了文件名（Linux 的包含在源码包中；Windows 的由第 04 阶段下载） |
| Windows SDK / CRT | Microsoft SDK `10.0.26100` + CRT，在 Linux 上通过 [xwin](https://github.com/Jake-Shadle/xwin) `0.9.0` 获取 |

## 前置条件

- 64 位 Linux 主机。**约 32 GB 内存**（Windows 目标的 official ThinLTO 链接峰值约 31 GB；大的交换文件有帮助）、
  **约 120 GB 空闲磁盘**、多核 CPU，以及**很长的时间**：自 151 起构建为 official 类型，Windows 交叉 ThinLTO 构建在 8 核上约需 12 小时。
- `git`、`python3`、`curl`、`ninja`、`zip`，以及 **`ciopfs`**（大小写不敏感的 FUSE 文件系统，用于 MSVC 头文件）。
  Chromium 其余的系统构建依赖由 `scripts/02` 通过 `build/install-build-deps.py` 安装（Debian/Ubuntu；以 root 或 sudo 运行；
  其它发行版请安装对应的包）。
- 不需要系统 MSVC，也不需要 Windows 机器：工具链由 Microsoft 可再分发的 SDK 包通过 `xwin` 组装而成
  （xwin 下载时你需要接受 Microsoft 的许可协议；CodeBrowser 不附带其中任何文件）。

## 容器方式（推荐：所有人使用相同环境）

最可复现的方式是在固定版本的 [`Dockerfile`](../../Dockerfile) 中构建，这样操作系统和工具与我们构建时完全相同。
你只需要 Docker（加上足够的内存、磁盘和时间）：

```bash
git clone https://github.com/jyycool/code-browser.git && cd code-browser-browser
docker build -t code-browser-build .                                    # the build environment (fast)

# then build a target — many hours (official ThinLTO); ~32 GB RAM, ~120 GB disk. Artifacts land in ./out:
docker run --rm -v "$PWD/out:/code-browser-build/dist" code-browser-build linux     # -> chrome tar.xz
docker run --rm -v "$PWD/out:/code-browser-build/dist" code-browser-build windows   # -> chrome.exe zip

# verify against the release (see docs/zh/VERIFY.md):
sha256sum -c out/code-browser-151.0.7922.108-linux-x64.tar.xz.sha256
gpg --verify out/SHA256SUMS.txt.asc out/SHA256SUMS.txt   # against the release's SHA256SUMS.txt.asc
```

## 快速方式（脚本化，在裸 Linux 主机上）

```bash
git clone https://github.com/jyycool/code-browser.git
cd code-browser-browser
WORK=~/code-browser-build ./build.sh linux       # or: ./build.sh windows   (default is windows)
```

[`build.sh`](../../build.sh) 接收目标操作系统（`windows` | `linux`），按顺序运行下面各阶段，把打包好的压缩包放到 `$WORK/dist`。
每个阶段都读取 `$TARGET`，所以你也可以在 [`scripts/`](../../scripts) 中单独运行它们：

| 阶段 | 脚本 | 作用 |
|---|---|---|
| 00 | `scripts/00-fetch-source.sh` | 克隆固定版本的 ungoogled 工具，获取并解压 Chromium 151，清理二进制文件 |
| 01 | `scripts/01-apply-patches.sh` | 应用补丁系列（ungoogled 基础 + windows 叠加层 + CodeBrowser 补丁集）。**两个目标使用同一棵源码树**：自 150 起，同一棵打过补丁的源码树同时构建 Windows 和 Linux 二进制 |
| 02 | `scripts/02-host-toolchain.sh` | 获取 clang/rust/sysroot/node；从源码树内的源码构建 `gn`（两个目标都需要） |
| 03 | `scripts/03-windows-sdk.sh` | **仅 Windows**：用 xwin 组装 `package_from_installed` 风格的 Windows SDK/CRT sysroot |
| 04 | `scripts/04-configure-build.sh` | 获取 Windows PGO 配置文件（仅 Windows），复制 `config/args.gn`（Win）或 `config/args.linux.gn`（Linux），`gn gen`，`ninja`（Linux 还会构建 `chrome_sandbox` + `chrome_crashpad_handler`） |
| 05 | `scripts/05-package.sh` | Windows → zip + VC++ DLL；Linux → 确定性的 `tar.xz`（+ `chrome-sandbox`）。生成 `.sha256` + `SHA256SUMS.txt` → `$WORK/dist` |

## 1. 源码

`scripts/00-fetch-source.sh` 检出固定版本的 `ungoogled-chromium` 和 `ungoogled-chromium-windows` 标签，
然后用 ungoogled 的 `downloads.py` 获取并解压确切的 Chromium 151 源码包（下载约 1.5 GB → 解压后约 10 GB），并清理非源码的二进制文件。

## 2. 补丁

身份/隐私行为**完全由补丁集决定**，去读它，它*就是*产品本身。补丁系列依次为：

1. **ungoogled-chromium 基础补丁**：移除 Google 集成/遥测（`utils/patches.py apply`）。
2. **ungoogled-chromium-windows 叠加层**：Windows 专用补丁。Linux 目标也会应用：发布的 Linux 二进制由同一棵源码树构建，
   并且 `905-rc-invoked-guard` 依赖叠加层中的 `chrome_command_ids.h`。
3. **CodeBrowser 指纹补丁**：引擎级的 canvas/WebGL/audio/UA/字体等伪装，位于 [`patches/`](../../patches)，列在 `patches/series` 中。
   见 [PATCHES.md](PATCHES.md)。

`scripts/01-apply-patches.sh` 使用 ungoogled 的补丁工具应用它们。每个补丁都是针对固定版本的纯 unified diff。

> **域名替换**（ungoogled 的 URL 改写加固）在这一阶段**不**应用：它会改写 Google 的下载 URL，导致第 02 阶段获取工具链失败。
> 自 Chromium 151 起，发布的二进制是从*应用了*域名替换的源码树构建的，所以 `scripts/04-configure-build.sh`
> 在第 02 阶段之后、`gn gen` 之前应用它（在 CodeBrowser 补丁之后应用与在之前应用得到的源码树相同）。
> 重新运行第 02 阶段会撤销它；第 04 阶段会再次应用。

## 3. 主机工具链

`scripts/02-host-toolchain.sh` 安装系统构建依赖（`install-build-deps.py`），如果已应用 ungoogled 域名替换则先撤销
（它会破坏工具链下载 URL），然后获取 Chromium 的 clang/lld（同一个编译器可以交叉编译 Windows 目标）、Rust、amd64 sysroot
以及主机上的 `node`。接着从源码树内的源码构建 `gn`：depot_tools 预编译的 `gn` 以 root 身份无法引导它的 Python，
所以我们用源码树中的 clang 引导，找到产出的二进制，并复制到 `$WORK/bin/gn`。

## 4. Windows SDK 工具链（在 Linux 上）

`scripts/03-windows-sdk.sh` 下载 `xwin` 并展开 Microsoft 的 Windows SDK + CRT，然后把这个扁平的内容映射成 Chromium
期望的 `package_from_installed.py` 目录结构：

- xwin `crt/{include,lib/x86_64}` → `VC/Tools/MSVC/<ver>/{include,lib/x64}`
- xwin `sdk/{include,lib}/…` → `Windows Kits/10/{Include,Lib}/<sdkver>/…`
- 合成的 `Windows Kits/10/bin/SetEnv.x64.json`（交叉构建读取的 INCLUDE/LIB/PATH）
- SDK 的 **`Include`** 目录通过 **`ciopfs`** 大小写不敏感挂载提供（Lib 目录不需要：xwin 已经为库文件生成了各种大小写的符号链接）

构建时使用 **`DEPOT_TOOLS_WIN_TOOLCHAIN=1`**（不是 0），并让 `GYP_MSVS_OVERRIDE_PATH` 指向这个合成的目录树。

## 5. 配置与构建

`scripts/04-configure-build.sh` 把 [`config/args.gn`](../../config/args.gn)（或 [`config/args.linux.gn`](../../config/args.linux.gn)）
复制到 `out/Default`，运行 `gn gen` 和 `ninja -C out/Default chrome`。该配置就是发布版本使用的确切 `args.gn`
（去 Google 化、`proprietary_codecs=true`，并且自 Chromium 151 起为 **official** 构建：`is_official_build=true`、
`dcheck_always_on=false`、ThinLTO + PGO）。

**PGO 配置文件。** `chrome_pgo_phase=2` 需要 `pgo_data_path` 所指定的配置文件。Linux 的在源码包里，Windows 的不在；
第 04 阶段会在 `gn gen` 之前下载它（并检查 `pgo_data_path` 与源码树期望的文件名一致）。手动下载（在 `build/src` 中）：

```bash
curl -fL -o chrome/build/pgo_profiles/$(cat chrome/build/win64.pgo.txt) \
  https://storage.googleapis.com/chromium-optimization-profiles/pgo_profiles/$(cat chrome/build/win64.pgo.txt)
```

（`tools/update_pgo_profiles.py` 做的是同样的事，但需要 `vpython3`。）

**开销与限制。** Windows 交叉 ThinLTO 构建在 8 核上约需 12 小时，链接时需要约 31 GB 内存。**不要**在 `args.gn` 中设置
`concurrent_links`：开启 ThinLTO 时 gn 会对它报断言错误。有两个非默认选项让 official 构建在这里能够成功：
Windows 上的 `enable_resource_allowlist_generation=false`（默认值需要 MSVC 的 `undname`，Linux 交叉构建没有它，
构建会在约 99% 时于 `//chrome:resource_allowlist` 失败；`llvm-undname` 不能替代，它的输出不同），
以及 Linux 上的 `is_cfi=false` / `use_cfi_icall=false`（official Linux x64 默认开启 CFI，遇到间接调用类型不匹配会中止）。
Linux 上的 `angle_enable_hlsl=true` 是 `966-angle-hlsl-dialect-optin` 所需要的。

## 6. 打包与验证

`scripts/05-package.sh` 把运行时文件（chrome.exe、chrome.dll、pak、ICU、locales、ANGLE/SwiftShader DLL）打成 zip，
并捆绑五个 VC++ 运行时 DLL，使其能在干净的 Windows 机器上启动。然后按 [RELEASING.md](RELEASING.md) **签名并发布**，
按 [VERIFY.md](VERIFY.md) 验证下载。

## 坑点（交叉构建经验总结）

这些问题我们都踩过；脚本已经处理了，但你应该知道它们的存在：

- **域名替换与工具链获取冲突**：它会改写 `tools/clang/scripts/update.py` 中的 `commondatastorage.googleapis.com`；
  在获取 clang/rust 之前要撤销（或推迟）它。（已处理：第 02 阶段在任何域名替换之前运行。）
- **depot_tools 的 `gn` 以 root 身份无法引导 Python**：第 02 阶段在 `PATH` 中放入源码树的 clang，
  用 `tools/gn/bootstrap/bootstrap.py` 构建 `gn`（不带 `-o`，以免 `gn` 二进制覆盖目标目录），然后找到产出的二进制并复制到 `$WORK/bin/gn`。
- **仅 Windows 的 `checkout_win` 子依赖**：`downloads.py` 只解压基础源码包，所以 `third_party/microsoft_webauthn/src`
  和 `third_party/microsoft_dxheaders/src` 缺失，导致链接失败。第 00 阶段按 DEPS 中固定的版本克隆它们。
- **MSVC 头文件大小写**：SDK 头文件互相 `#include` 时大小写不一致；第 03 阶段通过 **`ciopfs`** 大小写不敏感挂载提供
  SDK 的 `Include` 目录，使它们能被解析（Lib 目录不需要）。
- **域名替换与工具链获取冲突**：它会改写 Google 下载 URL；第 02 阶段在获取 clang/rust 之前撤销它（如果已应用）。
- **打开文件数限制**：链接步骤需要很高的上限；`ulimit -n 1048576`（第 04 阶段已处理）。
- **主机 `node`**：通常由 gclient runhooks 拉取；由于我们不运行 gclient，所以直接获取它（它是 shell 脚本，不是 Python）。
- **Rust std**：`rust_sysroot_absolute=""` 会从源码构建 std，而不是依赖预编译的绝对路径 sysroot。
- 遇到过的更深层的个别问题（过时的 UIA 头文件、缺失的 `CLSID`、被清理掉的 MIDL `.tlb`、库文件名的精确大小写）及完整经过，
  见 [RESEARCH-DOSSIER.md](RESEARCH-DOSSIER.md) §8。

## 可复现性（如实说明范围）

相同的固定版本 + 相同的补丁集 + 相同的 `config/args.gn` → 功能上完全相同的构建。在 [`Dockerfile`](../../Dockerfile) 中构建
消除了最大的偏差来源：构建*环境*（操作系统、libc、工具版本）与我们的完全一致，这就是推荐使用容器的原因。
即便如此，Chromium 构建**目前还不是逐位确定的**（嵌入的构建路径、时间戳、链接器/PGO 的不确定性），
所以字节完全相同的哈希匹配是*目标*，今天还无法保证。你现在能够完全审计的是：每处修改都是可读的补丁、配置是公开的、
整个工具链都已固定版本。完全可复现/可证明来源的构建记录在 [ROADMAP.md](../../ROADMAP.md) 第 4 阶段。见 [VERIFY.md](VERIFY.md)。
