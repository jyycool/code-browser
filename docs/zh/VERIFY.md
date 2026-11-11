# 验证 Clearcote：不要轻信，去验证

Clearcote 的核心意义在于：关于它里面有什么，你不必相信任何人的说法。本页说明如何亲自确认一个 Clearcote 发布版本
正是它所声称的那样，没有多出任何东西。

## 一句话说明信任模型

**开源源码输入 → 可复现构建 → 带校验和、可证明来源的产物输出。** 没有任何一步需要靠信任。

| 层级 | 如何验证 |
|---|---|
| 上游 Chromium | 固定在 `UPSTREAM_REVISION` 中的确切版本；源码包下载时会校验哈希。 |
| 去 Google 化 | 来自上游 [ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium)，它本身开源且经过广泛审计。 |
| Clearcote 的修改 | 每处修改都是 [`patches/`](../../patches) 中的纯文本补丁。去读、去 diff、去质疑。 |
| 二进制 | 发布时附带 SHA-256 校验和，以及（计划中的）构建溯源/证明。 |

## 1. 验证 GPG 签名：先做这一步

校验和只能证明下载内容自身一致；如果攻击者控制了发布页面并同时改写了校验和，它什么也证明不了。
真正的信任锚是 GPG 签名，你要用**项目固定的签名密钥**去验证它。该密钥的指纹公布在这里（以及 [README](../../README.md) 中），
并且在各个版本之间**不会改变**：

```
CA96 F185 F96A 693A EDB3  AC1F CB00 D851 B7A8 6B0F
```

```bash
# 1. confirm the key you're about to trust IS the pinned one — compare this fingerprint to the value above
gpg --with-fingerprint --show-keys clearcote-signing-key.asc
gpg --import clearcote-signing-key.asc

# 2. verify the signed checksum file is authentic
gpg --verify SHA256SUMS.txt.asc SHA256SUMS.txt        # expect: Good signature
```

首次导入时会打印 `WARNING: This key is not certified with a trusted signature`，这是**正常的**（你还没有亲自认证这个密钥）。
能证明完整性的是：**指纹与上面固定的值一致**，*并且*签名结果为 **Good**。如果指纹不同，请视为发布已被篡改，**不要运行它。**

## 2. 核对公布的校验和

签名验证通过后，确认你的下载与已签名的校验和一致。Windows 产物是 `.zip`；Linux 产物是 `.tar.xz`：

```bash
# Windows
sha256sum -c clearcote-<version>-windows-x64.zip.sha256
# Linux
sha256sum -c clearcote-<version>-linux-x64.tar.xz.sha256
# macOS (arm64) — on macOS use `shasum -a 256 -c`, there is no `sha256sum`
shasum -a 256 -c clearcote-<version>-macos-arm64.zip.sha256
```

也可以对照已签名的汇总列表核对包内的二进制：

```bash
# Windows — compare to the chrome.exe line in SHA256SUMS.txt
unzip -p clearcote-<version>-windows-x64.zip chrome.exe | sha256sum
# Linux — compare to the chrome line in SHA256SUMS.txt
tar -xJOf clearcote-<version>-linux-x64.tar.xz chrome | sha256sum
# macOS — compare to the "Chromium Framework" line in SHA256SUMS.txt
unzip -p clearcote-<version>-macos-arm64.zip \
  "Chromium.app/Contents/Frameworks/Chromium Framework.framework/Versions/<version>/Chromium Framework" \
  | shasum -a 256
```

如果哈希与 `SHA256SUMS.txt`（你已在第 1 步验证过它的真实性）不一致，**不要运行它。**

## 2a. 仅限 macOS：清除隔离标记

macOS 构建**没有使用 Apple Developer ID 签名，也没有经过公证（notarize）**。在 macOS 上下载的任何文件都会带上
`com.apple.quarantine` 属性，而 Gatekeeper 会拒绝启动带有该属性、未签名且未公证的应用包，通常提示应用"已损坏"，
但实际上并没有损坏。

**先验证 GPG 签名和校验和（第 1、2 步），再清除标记：**

```bash
xattr -dr com.apple.quarantine Chromium.app
```

顺序很重要。隔离标记并不是你在绕过的安全检查，它只是记录了文件来自网络。你真正的保证是：用固定密钥签名的
`SHA256SUMS.txt`，加上你下载的应用包的哈希。在验证这两者之前清除标记，就等于在运行一个未经验证的二进制。

为什么不签名：Apple 代码签名和公证需要加入 Apple Developer Program，而公证意味着把每个构建上传给 Apple 检查。
对一个去 Google 化、可独立验证的浏览器来说，这是有意的取舍：上面的 GPG 链条就是完整性保证，它不依赖于信任 Apple 或我们。

## 3. 阅读补丁

Clearcote 的身份/隐私行为完全由 [`patches/`](../../patches) 中的补丁集加上游 ungoogled 补丁决定。
它们是针对固定 Chromium 版本的 unified diff。没有任何编译进去的行为是在那里看不到的。如果有不清楚的地方，请提 issue：清晰本身就是一项功能。

## 4. 自己重新构建

最彻底的验证是复现。按 [BUILDING.md](BUILDING.md) 操作，使用相同的固定版本、[`patches/`](../../patches) 中的补丁集
和公开的 [`config/args.gn`](../../config/args.gn)，然后把你的构建与发布的构建比较。

坦白说明：Chromium 交叉构建**目前还不是逐位确定的**（嵌入的构建路径、时间戳、链接器/PGO 的不确定性），
所以字节完全相同的哈希匹配是*目标*，今天还无法保证。你现在能够完全审计的是：每处修改都是可读的补丁，
构建配置是公开的，没有任何编译进去的东西是隐藏的。可复现/可证明来源的构建记录在 [路线图](../../ROADMAP.md) 的第 4 阶段。
如果你的构建出现了补丁和配置无法解释的差异，那是我们想听到的 bug。

## 5. （计划中）验证构建溯源

未来的版本会发布构建溯源/证明，让你可以确认某个产物是由公开 CI 从这份确切的源码构建出来的，而不是手工拼装的。
功能落地后，验证命令会放在这里。见 [路线图](../../ROADMAP.md) 第 4 阶段。

## 这里所说的"没有可疑的东西"是什么意思

- **源码树中没有不透明的二进制。** 仓库里只有源码和可读的补丁。
- **没有静默的网络请求。** 去 Google 化的基础移除了 Google 的遥测/更新信标；任何网络行为都可以在补丁和上游中审计。
- **没有"相信这个 .exe 就行"。** 如果我们无法告诉你如何复现它，我们就不发布它。

发现有对不上的地方？请[提交 issue](https://github.com/clearcotelabs/clearcote-browser/issues)。可验证性只有在有人真正去检查时才有效，而我们希望你去检查。
