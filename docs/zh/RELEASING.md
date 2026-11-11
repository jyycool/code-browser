# 发布 Clearcote：常设操作手册

**这是发布 Clearcote 版本的标准流程。每次都要从头到尾照做。** 它的存在是为了让每个发布的构建都*可复现、带校验和、并用固定密钥做 GPG 签名*：
用户必须始终能够在不信任我们的前提下证明，他们下载的东西正是我们构建的，并且没有被篡改。

如果你偏离了流程，要在发布说明中写明原因。不要悄悄跳过任何一步，尤其是验证或签名步骤。

> **不要把基础设施信息放进这个仓库。** 构建主机地址、个人文件路径和个人邮箱绝不能提交。本手册使用占位符（`$BOX`、`$STAGE`）；在你的 shell 中设置它们，而不是写进文件。

---

## 0. 原则（不可妥协）

1. **每个产物都要签名并带校验和。** 没有 `SHA256SUMS.txt` + GPG 分离签名 + 附带的公钥，就不发布。这是整个项目的意义所在（见 [VERIFY.md](VERIFY.md)）。
2. **信任锚定在固定的密钥上，而不是发布本身。** 签名密钥指纹 `CA96F185 F96A 693A EDB3 AC1F CB00 D851 B7A8 6B0F` 通过**带外**方式公布在
   [README.md](../../README.md) 和 [VERIFY.md](VERIFY.md) 中，并且在各个版本之间不会改变。验证的含义是：导入密钥，**确认它的指纹等于这个固定值**，
   然后检查签名；绝不信任仅仅附在某个发布上的任意密钥。除非 README **和** VERIFY.md 都载有这个指纹和 `gpg --verify` 步骤，否则发布被阻塞。
   *（否则，控制了发布页面的攻击者可以把 zip、签名和密钥一起替换，所有检查依然通过，GPG 这一层相比单纯的校验和就毫无增益。）*
3. **在每个边界都做验证。** 在构建主机上（移动任何东西之前）、传输到本地之后（重新计算哈希）、发布之后（`gh api`），以及以干净环境用户的身份做一次。
   已签名的 `SHA256SUMS.txt` 是唯一可信来源。
4. **可复现、可审计，但不要夸大。** 构建可以从固定的 `UPSTREAM_REVISION` + 可读的补丁集 + 公开的 `config/args.gn` 重新构建出来。
   Chromium 交叉构建**目前还不是逐位确定的**，所以把保证表述为"每处修改都是可审计的补丁，配置是公开的"，而不是"重新构建后哈希一致"。
   哈希一致/来源证明的承诺留到确定性构建落地时再做（ROADMAP 第 4 阶段）。
5. **在验证之前都是预发布。** 任何尚未在真实 Windows 上通过线上检测站点验证的构建，都是 `--prerelease`，并写明注意事项。没有例外。
6. **如实说明注意事项，以实际产物为准。** 发布说明必须写明*尚未*完成的事（§9）。只有当**实际构建产物的 `args.gn`**（而不是仓库中的参考配置）证明某条注意事项不再适用时，才能删掉它。
7. **品牌名是 `clearcote`。** 对外的名称、产物名、SDK 导入名和文档都写 *clearcote*（组织 `clearcotelabs`，仓库 `clearcote-browser`）。
   "clearcoat" 只是构建主机上的内部代号，绝不能出现在发布产物的*文件名*中。（注意：当前签名密钥的 UID 仍是 "clearcoat release signing"，见 §6；
   它会在 `gpg --verify` 时打印出来。改用以 `clearcote` 命名的密钥已作为清理事项跟踪。）

---

## 1. 各种东西在哪里（私密信息在 shell 中设置）

每次发布时在环境中设置这些，**绝不提交**：

```bash
export BOX=user@your-build-host      # the Linux build/signing host (private; keep its address out of the repo)
```
```powershell
$STAGE = "C:\clearcote\release"        # local staging dir for the artifacts (your machine; not committed)
```

| 东西 | 位置 |
|---|---|
| 构建主机 | `$BOX`（基于密钥的 SSH） |
| 构建树（主机） | `~/clearcoat/build/src`，输出在 `out/Default` |
| 分发/暂存目录（主机） | `~/clearcoat/dist/` |
| VC++ 运行时 DLL（主机） | `~/clearcoat/dist/vcredist/` |
| GPG 签名密钥 | ed25519，指纹 `CA96F185F96A693AEDB3AC1FCB00D851B7A86B0F`，**没有密码**，在主机的密钥环中 |
| 本地暂存（Windows） | `$STAGE` |
| 仓库克隆（Windows） | 一个新的临时目录，每次发布重新克隆（§11） |
| `gh` CLI | GitHub CLI，以仓库**管理员**身份认证 |
| 仓库 | `clearcotelabs/clearcote-browser`，默认分支 `main` |

> 私钥**只存在于构建主机上**并且没有密码，所以可以非交互地签名。把这台主机视为签名机构。绝不要把私钥复制出去，也绝不要打印它。
>
> 保持 `dist/` 整洁：删除任何以**代号命名**的残留文件（`clearcoat-signing-key.asc`、旧的 `clearcoat-*.zip`），以免之后的通配 `scp`/上传意外带上以 `clearcoat` 命名的文件。

---

## 2. 版本号与标签

- 标签格式：`vMAJOR.MINOR.PATCH`，未经验证时带 `-pre.N` 后缀，例如 `v0.1.0-pre.1`……构建通过 Windows 验证（§13）后改为 `v0.1.0`。
- **Chromium 版本号**写在*产物*文件名中；标签跟踪的是 Clearcote 自己的发布线。
- **一个标签 = 一组不可变的产物。** 要修复已发布的版本，就发布一个**新的** `-pre.N+1`；绝不要重新指向一个别人可能已经拉取过的现有标签（§14）。

---

## 3. 产物命名（必须与 VERIFY.md 一致）

对于 Chromium 版本 `$V`（例如 `151.0.7922.108`）和平台 `$PLAT`（例如 `windows-x64`）：

```
clearcote-$V-$PLAT.zip            # the build
clearcote-$V-$PLAT.zip.sha256     # per-artifact checksum (sha256sum -c compatible)
clearcote-$V-$PLAT.zip.sha256.asc # GPG detached sig of the above
SHA256SUMS.txt                    # aggregate: zip + chrome.exe + chrome.dll
SHA256SUMS.txt.asc                # GPG detached sig of SHA256SUMS.txt
clearcote-signing-key.asc         # ASCII-armored public signing key (convenience copy; trust the pinned fingerprint, §0.2)
```

[VERIFY.md](VERIFY.md) 向用户说明的是 `clearcote-<version>-<platform>.zip` + `.sha256`：发布的文件名**必须**与之一致，否则验证说明就失效了。

---

## 4. 构建并暂存产物

完整步骤：[BUILDING.md](BUILDING.md)；交叉构建的深层坑点：[RESEARCH-DOSSIER.md](RESEARCH-DOSSIER.md)。在构建主机上：ungoogled-chromium `$V` → 清理 →
应用 ungoogled 补丁 → 应用 Clearcote 补丁 → 复制 `config/args.gn` → `gn gen out/Default` → **`ninja -C out/Default chrome`**
（与 BUILDING.md/AGENTS.md 使用同一个 `out/Default`；不要用 `out/Release`，那里只放源码树内的 `gn`）。

预检：

- [ ] `cat <repo>/UPSTREAM_REVISION` 等于 `$V`（仓库根目录的这个文件是权威的固定版本）。
- [ ] `config/args.gn`（以及 `config/args.linux.gn`）与产物实际使用的参数一致：与构建的 `out/Default/args.gn` 比较（忽略顺序和注释）。
  自 Chromium 151 起两者都是 **official**（`is_official_build = true`、`dcheck_always_on = false`、`chrome_pgo_phase = 2`）；
  `pgo_data_path` 必须指向该版本 `chrome/build/win64.pgo.txt` / `linux.pgo.txt` 中写明的配置文件。为了"可以重新构建"的说法成立（§0.4），它们必须保持一致。
- [ ] `out/Default/chrome.exe` 和 `chrome.dll` 是新构建的。

**把构建暂存为代号命名的 zip**（这是 §5 需要的输入；如果缺失或过时就在这里生成）。照着已知正确的压缩包内容来做（对现有发布 zip 运行 `unzip -l` 确认；约 700 个条目）：

```bash
ssh "$BOX" 'bash -s' <<'EOF'
set -e
cd ~/clearcoat/build/src/out/Default
zip -r ~/clearcoat/dist/clearcoat-win-x64.zip \
    chrome.exe chrome.dll chrome_elf.dll chrome_wer.dll \
    *.manifest \
    *.pak *.bin *.dat *.json locales \
    libEGL.dll libGLESv2.dll d3dcompiler_47.dll \
    vk_swiftshader.dll vulkan-1.dll VkICD_mock_icd.dll VkLayer_khronos_validation.dll
echo "staged:"; unzip -l ~/clearcoat/dist/clearcoat-win-x64.zip | tail -1
EOF
```

> 包含构建产出的**完整运行时文件集**（pak、ICU `icudtl.dat`、快照 blob、整个 `locales/` 目录、ANGLE + SwiftShader/Vulkan DLL）。
> 如果已有构建/打包辅助工具生成这个 zip，就用它，只需验证内容。

---

## 4a. 补丁完整性门禁：必须执行（阻塞打包、签名和发布）

Clearcote *就是*它的补丁集，而丢失的隐身补丁会**静默放行**：浏览器依然能启动，只是不那么隐身了。所以在打包或签名任何东西之前，
要证明**每个补丁都确实存在于构建该二进制的源码树中，并且已编译进二进制本身。** 这就是标准；见 [PATCH-INTEGRITY.md](PATCH-INTEGRITY.md)。
在你的 Clearcote 仓库检出目录（产出这次构建的 `patches/` 所在的那个）中，针对构建树和新构建的 `chrome.dll` 运行：

```bash
# $SRC = the build tree (e.g. ~/clearcote-build/build/src on the build host)
python3 scripts/verify_patches.py \
  --tree "$SRC" --target windows \
  --binary "$SRC/out/Default/chrome.dll"
```

**验收：** 退出码 0，*"every checked layer is clean."* 在此之前**不要**进入 §5（打包）、§6（签名）或 §10（发布）。

- **第 1 层（源码）**证明已提交的 `patches/` 能复现构建所用的源码树，所以第三方从仓库重新构建会得到*这个*二进制（§0.4）。如果失败，说明源码树已偏离已提交的补丁集：
  运行 `gen_patches.sh`（§11.0），并在**继续之前**提交刷新后的 `patches/`，然后重新运行本门禁。绝不要为了通过而跳过补丁。
- **第 2 层（二进制）**证明每个补丁的代码都在 `chrome.dll` 中。如果失败，说明产物过时或构建有误（增量构建没有重新编译某个被改动的文件，或用错了 `out/` 目录）：
  重新构建（`ninja -C out/Default chrome`），重新暂存（§4），然后重新运行。

> 同一个门禁也会在构建时自动运行于 [`scripts/01-apply-patches.sh`](../../scripts/01-apply-patches.sh)
> （第 1 层，在应用补丁后立即运行：静默的 reject 会在编译之前中止），以及 CI 中
> （[`.github/workflows/patch-integrity.yml`](../../.github/workflows/patch-integrity.yml)：每次 push 运行第 0 层；
> 针对固定版本发布二进制的第 2 层是发布后的按需检查）。这里 §4a 的运行是人工把关的发布检查点，把两者都绑定到你即将签名的那个确切产物上。

---

## 5. 重新打包为公开名称 + 捆绑 VC++ 运行时（很容易忘）

原版 Chromium 构建**不**包含 MSVC 运行时。没有它，`chrome.exe` 在干净的 Windows 10/11 机器上无法启动。这五个 DLL **必须**放在 zip 根目录，与 `chrome.exe` 并列：

```
concrt140.dll  msvcp140.dll  ucrtbase.dll  vcruntime140.dll  vcruntime140_1.dll
```

```bash
ssh "$BOX" 'bash -s' <<'EOF'
set -e
cd ~/clearcoat/dist
V=151.0.7922.108            # <-- set to this release's Chromium version
PLAT=windows-x64
ASSET=clearcote-${V}-${PLAT}.zip

test -f clearcoat-win-x64.zip || { echo 'staged build zip not found — run the §4 staging step'; exit 1; }
cp -f clearcoat-win-x64.zip "$ASSET"          # internal codename -> public name

# add the VC++ 2015-2022 runtime at the archive root (-j junks paths)
zip -j "$ASSET" vcredist/concrt140.dll vcredist/msvcp140.dll vcredist/ucrtbase.dll \
                vcredist/vcruntime140.dll vcredist/vcruntime140_1.dll

# sanity: confirm all five are present
unzip -l "$ASSET" | grep -iE "msvcp140|vcruntime140|vcruntime140_1|concrt140|ucrtbase"
EOF
```

> **在确认五个 VC++ DLL *以及* SxS `*.manifest` 都存在之前，绝不要发布 zip**：`unzip -l "$ASSET" | grep -iE "msvcp140|vcruntime140|vcruntime140_1|concrt140|ucrtbase|\.manifest"`
> 应当列出全部六项。`<version>.manifest` 与这些 DLL 同样必不可少：没有它，`chrome.exe` 会以 *"the side-by-side configuration is incorrect"* 失败
> （通过 Playwright 表现为 `spawn UNKNOWN`）。在干净的 Windows 虚拟机上确认 `chrome.exe` 真的能启动。

---

## 6. 校验和 + 签名（在构建主机上）

```bash
ssh "$BOX" 'bash -s' <<'EOF'
set -e
cd ~/clearcoat/dist
V=151.0.7922.108; PLAT=windows-x64
ASSET=clearcote-${V}-${PLAT}.zip
FPR=CA96F185F96A693AEDB3AC1FCB00D851B7A86B0F

# hash the zip; hash the two key binaries (extracted names, unchanged by repackaging)
ZIPHASH=$(sha256sum "$ASSET" | awk '{print $1}')
EXEHASH=$(unzip -p "$ASSET" chrome.exe | sha256sum | awk '{print $1}')
DLLHASH=$(unzip -p "$ASSET" chrome.dll | sha256sum | awk '{print $1}')

printf '%s  %s\n%s  chrome.exe\n%s  chrome.dll\n' \
  "$ZIPHASH" "$ASSET" "$EXEHASH" "$DLLHASH" > SHA256SUMS.txt
printf '%s  %s\n' "$ZIPHASH" "$ASSET" > "${ASSET}.sha256"

# GPG detached signatures (key has NO passphrase -> loopback + empty passphrase)
SIGN() { gpg --batch --yes --pinentry-mode loopback --passphrase "" \
             --local-user "$FPR" --armor --detach-sign -o "$2" "$1"; }
rm -f SHA256SUMS.txt.asc "${ASSET}.sha256.asc"
SIGN SHA256SUMS.txt        SHA256SUMS.txt.asc
SIGN "${ASSET}.sha256"     "${ASSET}.sha256.asc"

# export the public key under the PUBLIC name, and remove any codename-named copy
gpg --armor --export "$FPR" > clearcote-signing-key.asc
rm -f clearcoat-signing-key.asc

echo "ZIPHASH=$ZIPHASH"
EOF
```

> 密钥的 UID 目前在 `gpg --verify` 时打印为 **`clearcoat release signing …`**：现阶段这是预期的（它是 UID，不是产物名）。
> 在*稳定版*发布之前，改用以 `clearcote` 命名的密钥并重新签名，让代号不再出现在用户面前（§0.7）。

---

## 7. 在构建主机上验证（移动任何东西之前）

```bash
ssh "$BOX" 'cd ~/clearcoat/dist && \
  gpg --verify SHA256SUMS.txt.asc SHA256SUMS.txt && \
  sha256sum -c clearcote-*-windows-x64.zip.sha256'
```

**验收：** `Good signature`，**并且**签名密钥的指纹等于固定值 `CA96F185…B7A86B0F`（在主机上它显示为 `[ultimate]`，因为密钥就在密钥环里：这个信任标记*不是*证明，指纹一致才是）。
校验和必须报告 `OK`。任一项失败就停下：不要传输或发布。

---

## 8. 传输到本地并再次验证

在 `$STAGE` 的上级目录中运行，让目标路径是**相对**路径：`scp` 会因为冒号把 `C:\...` 目标当成远程主机。末尾的通配会把 zip 及其 `.sha256`/`.asc` 一起取回。

```bash
# ensure the local dest dir exists first (scp errors "not a directory" otherwise)
mkdir -p release
scp -o StrictHostKeyChecking=no \
  "$BOX:~/clearcoat/dist/clearcote-151.0.7922.108-windows-x64.zip*" \
  "$BOX:~/clearcoat/dist/SHA256SUMS.txt*" \
  "$BOX:~/clearcoat/dist/clearcote-signing-key.asc" \
  release/
```

> 通配符由**远程** shell 展开。在 OpenSSH 9+（基于 SFTP 的 scp）上这可能失败：如果失败，加 `-O` 强制使用旧协议：`scp -O -o ... "$BOX:...zip*" release/`。

然后确认传输结果与已签名的值逐字节一致（PowerShell）：

```powershell
$z = "$STAGE\clearcote-151.0.7922.108-windows-x64.zip"
(Get-FileHash $z -Algorithm SHA256).Hash.ToLower()   # must equal ZIPHASH / the zip line in SHA256SUMS.txt
```

如果不一致，重新传输。绝不要上传哈希与已签名校验和不一致的本地文件。

---

## 9. 撰写发布说明

在 `$STAGE` 中创建 `RELEASE_NOTES.md`。它**必须**包含：下载表格、验证代码块（GPG + 校验和命令 + 实际哈希）、可用的快速上手示例，以及注意事项清单。
通过写入确切的 `ZIPHASH`，**把发布说明绑定到这次构建**。

标准的快速上手示例（与 README 保持逐字节一致：Python `executable_path`、snake_case；以 `clearcote` 命名的路径）：

```python
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(
        executable_path=r"C:\clearcote\chrome.exe",
        args=["--fingerprint=seed-123", "--fingerprint-platform=windows"],
    )
    b.new_page().goto("https://abrahamjuliot.github.io/creepjs/")
```

**必须包含的注意事项清单**：只要某项仍然成立就要写上；只有当**实际产物的 `args.gn`**（在构建中 grep `is_official_build`/`proprietary_codecs`）证明它不再成立时，才能删掉：

- [ ] **预发布 / 未经隐身验证**：在真实 Windows 上通过 §13 验证后删除。
- [ ] **单一全局种子（可跨站关联）**：按 eTLD+1 的 farbling 上线后删除。
- [ ] **`proprietary_codecs=true`** 的再分发注意事项：只要启用了 H.264/AAC 就保留。

---

## 10. 发布 GitHub release

构建一个完整的 PowerShell **参数数组并用 splat 展开**：不要对原生 exe 使用反引号续行（反引号后多一个空格会静默截断参数列表）。

```powershell
$gh   = "gh"                              # GitHub CLI on PATH (or its full path)
$git  = "git"
$repo = "$env:TEMP\clearcote-pub"         # the fresh clone (§11)
$tag  = "v0.1.0-pre.1"
$V    = "151.0.7922.108"

# pre-publish: main must be at the intended release commit (tags are immutable, §2)
& $git -C $repo fetch --quiet
& $git -C $repo rev-parse origin/main      # confirm == the commit you intend to tag; if not, fix main first, don't publish

$assets = @(
 "$STAGE\clearcote-$V-windows-x64.zip",
 "$STAGE\clearcote-$V-windows-x64.zip.sha256",
 "$STAGE\clearcote-$V-windows-x64.zip.sha256.asc",
 "$STAGE\SHA256SUMS.txt",
 "$STAGE\SHA256SUMS.txt.asc",
 "$STAGE\clearcote-signing-key.asc"
)
$ghArgs  = @('release','create',$tag,'--repo','clearcotelabs/clearcote-browser')
$ghArgs += $assets
$ghArgs += @('--title', "Clearcote Browser $tag (Chromium $V, Windows x64)")
$ghArgs += @('--notes-file', "$STAGE\RELEASE_NOTES.md", '--prerelease')
& $gh @ghArgs
```

> 只有经过验证的稳定版才去掉 `--prerelease`。`gh release create` 会在 `main` 当前的 HEAD 上创建标签：这就是发布前那条 `rev-parse` 检查的意义。

发布后修改说明：`& $gh release edit $tag --repo clearcotelabs/clearcote-browser --notes-file "$STAGE\RELEASE_NOTES.md"`。

---

## 11. 更新仓库，让这次构建可见

```powershell
# fresh clone (avoid Remove-Item -Recurse on protected paths)
& $gh repo clone clearcotelabs/clearcote-browser "$env:TEMP\clearcote-pub"

# one-time, in this clone: keep commits on the public handle only — no personal email
& $git -C $repo config user.name  pim97
& $git -C $repo config user.email pim97@users.noreply.github.com
```

### 11.0 重新生成并提交补丁集（必须执行：仓库必须能构建出这个确切的二进制）

每次发布都**必须**刷新 `patches/`，让第三方能从源码重新构建出已发布的二进制。已提交的补丁集会**漂移**：两次发布之间构建树会被修改却没有重新收录，
所以**始终要重新生成；绝不要假设 `patches/` 是最新的。** 在构建主机上：

```bash
ssh "$BOX" 'cd ~/clearcoat && bash gen_patches.sh'   # diffs tree vs pristine baseline, groups, self-validates
```

`gen_patches.sh` 会重建一个原始的 `151 → 清理 → ungoogled → windows 叠加层` 基线，把构建树与之做 diff（排除获取的工具链**以及** `*.cfbak*`/`*.bak`/`*.orig`/`*.rej`），
把每个改动的文件归入恰好一个按关注点划分的补丁，写出 `series`，然后**自检每个补丁都能零 reject 地重新应用**并做泄露扫描。
**验收：** `VALIDATION fail=0`，`950-misc-REVIEW` 中不留任何东西（为任何新文件添加 `group_for` 映射后重新运行），并且 `leak scan clean`。
然后把 `out_patches_full/*.patch` + `series` 复制覆盖到 `patches/`，更新 `patches/README.md` 中的补丁系列表（新增行 + 修订描述），
并与下面的 README 横幅**在同一次推送中**提交。因为每个源文件只属于一个补丁，逐补丁零 reject 就等于按顺序干净地应用，
所以把补丁系列应用到全新基线上就能复现这次构建的源码树。重新生成之后，**重新运行 §4a 补丁完整性门禁**：此时第 1 层必须干净
（刷新后的 `patches/` 能在构建树上反向应用），这是"已提交的补丁集能复现这个二进制"的可机器检验的证明。
`gen_patches.sh` 针对*原始*基线验证重新应用；§4a 门禁针对*实际构建树* + *实际二进制*验证：两者都要保留。

1. **原地更新 README 中已有的状态横幅**（README 已经有一个 `> [!NOTE]` 横幅）：把标签和发布链接改为这次发布；不要再加第二个横幅。
2. 提交并推送（一行，不用反引号，消息中带 `$tag`，不要 `Co-Authored-By: Claude`）：

```powershell
& $git -C $repo add README.md
& $git -C $repo commit -m "docs: announce $tag"
& $git -C $repo push
```

3. 仓库元数据（参数数组 + splat；**每次大版本升级都要更新描述中的 Chromium 版本**）：

```powershell
$desc = "Open-source anti-detect Chromium <MAJOR> with engine-level fingerprint spoofing - de-Googled, drop-in Playwright, Windows x64, fully buildable and verifiable from source."
$editArgs  = @('repo','edit','clearcotelabs/clearcote-browser','--description',$desc)
$editArgs += @('--homepage','https://github.com/clearcotelabs/clearcote-browser')
foreach ($t in 'anti-detect-browser','chromium','fingerprint','playwright','ungoogled-chromium','web-scraping','stealth-browser','anti-fingerprinting') { $editArgs += @('--add-topic', $t) }
& $gh @editArgs
```

> `docs/en/RELEASING.md`（及本中文版 `docs/zh/RELEASING.md`）被 `CONTRIBUTING.md` 链接、并列在 `AGENTS.md` 中：保持这些指向完整，让这份手册始终可以被找到。

---

## 12. 发布后验证

```powershell
# comma-free jq only (a jq expr with top-level commas gets mis-split by the shell)
& $gh api repos/clearcotelabs/clearcote-browser/releases/tags/v0.1.0-pre.1 --jq '.assets[].name'
& $gh api repos/clearcotelabs/clearcote-browser/releases/tags/v0.1.0-pre.1 --jq '.prerelease'
```

确认 **6** 个产物都在，并且 `prerelease` 为 `true`（在验证之前）。然后**以用户的身份做一次干净环境验证**：把产物下载到一个临时目录并执行：

```bash
gpg --with-fingerprint --show-keys clearcote-signing-key.asc   # fingerprint must equal CA96F185…6B0F
gpg --import clearcote-signing-key.asc
gpg --verify SHA256SUMS.txt.asc SHA256SUMS.txt                  # Good signature (a "not certified" WARNING is expected)
sha256sum -c clearcote-151.0.7922.108-windows-x64.zip.sha256    # OK
unzip -p clearcote-151.0.7922.108-windows-x64.zip chrome.exe | sha256sum   # matches chrome.exe in SHA256SUMS.txt
```

然后在真实 Windows 上对发布的二进制运行**隐身一致性门禁**：它断言画像/加噪层不会暴露自己（文本度量在 1/512 网格上、主线程 == Worker、BCR == Range、
渲染字节不随源变化、WebGPU vendor 与 WebGL 一致）。它必须报告**没有违反约定**（没有 REQUIRED 检查失败 = 没有回归；没有新通过却未被提升的 `KNOWN_GAP`）。
见 [docs/zh/STEALTH-COHERENCE.md](STEALTH-COHERENCE.md)。

```powershell
py -3 -m pip install playwright
py -3 scripts\stealth_coherence.py --binary "$STAGE\chrome.exe"   # exit 0 = OK; or run the "Stealth coherence" GH workflow on the pinned release
```

最后，在项目的私有构建笔记（不在本仓库中）里更新标签、新的 zip 哈希以及任何变化。

---

## 13. 从预发布晋级为稳定版

只有在以下**全部**满足时，才去掉 `-pre.N` 后缀和 `--prerelease`：

- [ ] 已按 §§4–8 构建、签名并验证。
- [ ] **在真实 Windows 上**用 CreepJS / BrowserScan / Pixelscan **验证过**：相同种子 ⇒ 指纹稳定，不同种子结果不同，`navigator.webdriver=false`，canvas/WebGL/audio 随种子变化。
- [ ] **隐身一致性门禁通过**（`scripts/stealth_coherence.py`，或 "Stealth coherence" 工作流）：没有 REQUIRED 检查回归，并且任何现在通过的 `KNOWN_GAP` 都已提升为 `REQUIRED`。
  见 [docs/zh/STEALTH-COHERENCE.md](STEALTH-COHERENCE.md)。
- [ ] `config/args.gn` / `config/args.linux.gn` 与发布的二进制一致（§4）。
- [ ] 签名密钥已更换为以 `clearcote` 命名的 UID（§6），使验证输出符合品牌。
- [ ] 当初决定"预发布"的那些注意事项（§9）确实已解决，或已被明确接受。

---

## 14. 修复 / 撤回有问题的发布

- **产物有问题，标签尚未被广泛拉取：** `gh release delete <tag> --cleanup-tag`，修复后重新发布。只能在刚发布之后这样做。
- **已经流传出去了：** **不要**改写它。发布一个取而代之的 `-pre.N+1`（或补丁版），必要时把有问题的那个标为草稿 / 在其正文中注明问题。不可变的标签让信任模型保持完整。

---

## 环境坑点速查（Windows / PowerShell 5.1）

- **向原生 exe 传递多个参数时，用数组 + `@splat`，绝不要用反引号续行**：反引号后多一个空格会静默截断参数列表。对 `gh` *和* `git` 都适用。
- **`scp` 到 `C:\...` 目标会失败**：冒号会被当作远程主机。在上级目录中运行，使用一个**相对**目标路径，且该目录必须已存在。在 OpenSSH 9+ 上，如果远程通配不展开，加 `-O`。
- **带顶层逗号的 `gh ... --jq` 会被错误拆分**（"accepts 1 arg(s), received N"）：使用**不含逗号**的 jq 表达式，或者每个字段调用一次 `gh`。
- **对 `C:\Program...` 下的路径执行 `Remove-Item -Recurse -Force` 会被沙箱阻止**：改为克隆到一个新的临时目录，而不是强制删除。
- **GPG 签名是非交互的**，因为密钥没有密码：`--batch --pinentry-mode loopback --passphrase ""`。如果改用带密码的密钥，这些签名命令必须相应修改。
- **绝不要提交基础设施信息**：构建主机地址、个人路径、个人邮箱。使用 `$BOX`/`$STAGE` 占位符和 `pim97@users.noreply.github.com` 提交身份。

---

## 一屏清单

```
[ ] <repo>/UPSTREAM_REVISION == release Chromium version
[ ] config/args.gn + args.linux.gn match the artifacts' actual args.gn (official, PGO profile name)
[ ] built in out/Default; staged into clearcoat-win-x64.zip (full runtime, ~700 entries)
[ ] PATCH-INTEGRITY GATE green (§4a): verify_patches.py --tree (Layer 1) + --binary (Layer 2) exit 0 — BLOCKS publish
[ ] repackaged to clearcote-$V-windows-x64.zip WITH the 5 VC++ runtime DLLs (unzip -l | grep)
[ ] SHA256SUMS.txt (zip+exe+dll) + per-asset .sha256 generated
[ ] both signed; clearcote-signing-key.asc exported; codename leftovers removed from dist/
[ ] gpg --verify OK + fingerprint == CA96F185…6B0F + sha256sum -c OK  (ON THE HOST)
[ ] scp to local (dest dir exists); Get-FileHash matches signed value
[ ] RELEASE_NOTES.md written incl. caveats checklist + correct hashes + pinned ZIPHASH
[ ] README & VERIFY.md carry the pinned fingerprint + gpg --verify steps
[ ] commit identity is pim97 <pim97@users.noreply.github.com> (no personal email)
[ ] main at intended commit (git rev-parse origin/main)
[ ] gh release create (@splat args) --prerelease
[ ] patches/ REGENERATED (gen_patches.sh: VALIDATION fail=0, no 950-misc-REVIEW, leak-clean) + patches/README.md series table updated + committed
[ ] README banner updated in place + pushed; repo description/topics set
[ ] 6 assets + prerelease=true confirmed via gh api
[ ] clean-room user verify (fingerprint check, gpg --verify, sha256sum -c, inner exe hash)
[ ] no infrastructure (host address / personal path / personal email) committed anywhere
```
