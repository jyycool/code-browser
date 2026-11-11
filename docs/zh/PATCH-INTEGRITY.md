# 补丁完整性：发布门禁标准

**Clearcote *就是*它的补丁集。** 每一项隐身行为都位于 [`../patches/`](../../patches) 中，应用在固定版本的 Chromium 之上
（没有任何编译进去的行为不是可读补丁，见 [`../patches/README.md`](../../patches/README.md)）。因此最重要的一条发布不变量是：
**每个补丁都被正确应用、编译进去并且生效；只要有一个不满足，就不发布构建。**

## 为什么需要硬性门禁（失效模式）

丢失的隐身补丁会**静默放行（fails open）**。如果 `040-fonts` 或 `010-user-agent-and-webdriver` 悄无声息地没打上
（增量重建时 reject 被吞掉、提交的 `patches/` 已过时、上游合并移动了锚点、某个编译单元没有重新编译），
浏览器**依然能启动、依然能用**。它只是*不那么隐身了*：`navigator.webdriver` 泄露，或者字体列表不再符合画像，
或者 TLS ClientHello 回到构建的原生形态。没有崩溃，冒烟测试也注意不到。第一个"注意到"的，是我们想要对抗的检测方。

这与普通软件正好相反：普通软件中，坏掉的改动通常会大声地坏掉。这里，坏掉的改动*在运行时是不可见的，
除非你专门去找那个缺失的行为*。唯一的防线是**显式的、逐补丁的、阻塞发布的检查**，
也就是 [`../scripts/verify_patches.py`](../../scripts/verify_patches.py)。

## 标准：三层检查，因为"已应用"有三种失败方式

"补丁应用了吗？"有三个相互独立的答案，一个构建可能通过一层却在下一层失败。门禁三层都检查；**任何失败都以非零退出并阻塞发布。**

| 层级 | 问题 | 机制 | 能发现的失败 |
|---|---|---|---|
| **1：源码** | 构建该二进制的源码树中，是否完全包含补丁的各个 hunk？ | 在补丁涉及文件的临时副本上，把整个 `series` 从构建树上逐个剥离，从最后一个补丁开始（`patch -R`）。如果每个补丁都精确存在于源码树中，每一个都能干净地反向应用；缺失或被破坏的会失败。按顺序进行，所以修改同一文件的分层补丁（例如叠在 `002`/`070` 之上的 `955`）也能被正确检查；源码树本身从不被修改。 | 被悄悄拒绝、模糊匹配到错误位置或只应用了一部分的补丁；已提交的 `patches/` 集合无法再复现构建所用的源码树。 |
| **2：二进制** | 这些源码是否真的进入了发布的二进制？ | 必需的**标记字符串**（命令行开关名 + 补丁添加的独特字面量）必须出现在 `chrome` / `chrome.dll` 中。 | 过时的二进制：增量构建没有重新编译被修改的编译单元、打包了错误的 `out/` 目录，或者死代码消除把它去掉了。源码是对的，产物是错的。 |
| **3：运行时** | 打过补丁的代码是否真的*起作用*？ | 每个面一个行为**见证**（`navigator.webdriver===false`、`getVoices()` 非空且为画像语音集、`measureText` 网格量化、WebGL 画像 renderer……），通过 [`stealth_coherence.py`](../../scripts/stealth_coherence.py) 对启动后的二进制运行。 | "编译进去了但是坏的"：代码存在，但逻辑错误或不良交互让效果出错。 |

**为什么三层都要，而不是只要一层。** 它们并不冗余，每一层都有盲区，由下一层覆盖：

- 第 1 层可能完全干净，而**二进制却是过时的**（你改了源码，但 `ninja` 没有重新构建那个目标文件，或者你打包了错误的 `out/` 目录）。
  只有第 2 层能看到。
- 第 2 层可能通过（标记字符串在二进制里），而**行为却是坏的**（开关被解析了，但使用它的代码路径回归了）。只有第 3 层能看到。
- 第 3 层最强，但开销最大、覆盖也最不完整（你只能断言写了见证的那些面）。第 1–2 层开销低且**覆盖全部补丁**，
  所以它们是兜底，保证*没有任何东西*被悄悄遗漏。

第 1 层是锚点：它是**精确的**（字节级 hunk 匹配）并且**零维护**：补丁文件本身就是规格说明，
所以新补丁一进入 `series` 就被覆盖，不需要额外写代码。

## 门禁强制执行的内容（第 0 层：完整性）

在任何源码树/二进制检查之前，`verify_patches.py` 会断言簿记是正确的，这正是让标准在不断添加补丁时保持诚实的手段：

- `series` 中的每一项都存在对应文件，每个 `*.patch` 文件都列在 `series` 中
  （**孤立的补丁永远不会被应用**，否则就是一个静默的漏洞）。只有顶层的 `patches/*.patch` 计入：
  子目录如 `patches/macos-150/`（用于另一种构建的补丁）既不应用也不检查。
- `series` 中没有重复项。
- **清单完整性：** 每个 `series` 补丁在 [`../scripts/patch_markers.json`](../../scripts/patch_markers.json) 中都有见证条目。
  你**无法在不记录如何验证的情况下添加补丁**：没有条目的补丁会在第 0 层失败，所以它不可能悄悄绕过第 2/3 层。

## 在哪里运行（三个强制执行点：发布确实无法跳过它）

1. **构建时**：[`scripts/01-apply-patches.sh`](../../scripts/01-apply-patches.sh) 在应用补丁系列后立即运行第 1 层。
   静默的应用失败会在*任何编译开始之前*中止构建，而不是在数小时的构建之后。
   （`CLEARCOTE_SKIP_PATCH_VERIFY=1` 仅用于本地调试，绝不能用于发布构建。）
2. **发布时**：[`docs/zh/RELEASING.md`](RELEASING.md) §11.0a 把运行**完整**门禁作为必须步骤
   （在 `gen_patches.sh` 重新生成 `patches/` 之后运行 `--tree`，**并且**对暂存的 `chrome.dll` 运行 `--binary`）。
   这里的第 1 层证明*已提交的*补丁集能复现构建所用的源码树；第 2 层证明该源码树的代码进入了正要签名的产物。
3. **CI**：[`.github/workflows/patch-integrity.yml`](../../.github/workflows/patch-integrity.yml) 在每次 push/PR 时运行第 0 层
   （完整性 + 清单完整性，不需要源码树）。针对固定版本发布二进制的第 2 层是一个**按需**任务（"Run workflow" 按钮，在 Windows runner 上）：
   在发布后立即触发它（此时固定版本与补丁集一致），作为对用户实际下载的产物的发布后检查。它故意*不*在每次 push 时运行，
   因为在两次发布之间 `patches/` 会领先于固定版本，所以尚未发布的补丁的标记在较旧的固定二进制中缺失是正常的。
   权威的*发布前*第 2 层检查是下面的 §4a，针对新构建的二进制。

## 添加补丁：维护约定

当你把 `NNN-thing.patch` 加入 `series` 时，也必须把它的见证加入 `scripts/patch_markers.json`，否则第 0 层失败：

```jsonc
"NNN-thing.patch": {
  "surface": "one line: what stealth behavior this implements",
  "windows_only": false,                 // true only for the Windows-target overlay patches
  "markers": [                            // >=1 string that SURVIVES into a stripped release binary
    "my-new-switch",                      //   best: a command-line switch value string
    "Some Distinctive Literal"            //   good: a hardcoded literal exposed to JS / logged
  ],                                      //   NEVER a C++ symbol name (stripped); [] = runtime-only
  "runtime": {                            // Layer 3 witness
    "surface": "navigator.somdthing",
    "probe":   "navigator.something",
    "expect":  "the correctly-patched value (vs the vanilla value)"
  }
}
```

选择**二进制标记**：优先使用补丁注册的开关名字符串（它们在运行时被比较，所以一定在二进制中，而且是 Clearcote 独有的）。
其次是补丁添加的、暴露给 JavaScript 或写入日志的硬编码字符串字面量。**不要**使用函数/类/变量名：发布二进制是去掉符号的。
如果一个补丁是纯算法/几何上的修改，没有能保留下来的独特字符串（例如亚像素抖动），就把 `markers` 设为 `[]`，
依靠 `runtime` 见证；第 2 层会跳过它，由第 3 层覆盖。

## 门禁失败时如何修复（绝不压制它）

- **第 1 层失败（"does NOT reverse-apply cleanly"）**：已提交的 `patches/` 与构建树不再一致。这在*开发过程中*是正常的
  （源码树会领先于已提交的补丁集）。发布时的修复方法正是发布手册中的步骤：运行 `gen_patches.sh` **从源码树**重新生成 `patches/`
  （它会自检能否在原始基线上零 reject 地重新应用），然后重新运行门禁，此时必须干净通过。如果在 `01-apply-patches.sh`
  之后立即有单个补丁失败，说明那个补丁确实没打上：修复 reject，不要跳过它（见 [不跳过隐身补丁](../../CONTRIBUTING.md) 规则）。
  在分层的补丁栈中，报告会列出剥离时失败的每个补丁；**第一个**列出的就是出问题的地方，其后的可能只是连带失败。
- **第 2 层失败（"did not compile into the binary"）**：源码中有补丁，但产物中没有。重新构建受影响的目标
  （`ninja -C out/Default chrome`），确认你打包的是那个 `out/` 目录，然后重新运行。如果是标记本身错了（被优化掉了），
  就对照一个已知正确的二进制在清单中修正它。
- **第 3 层失败**：行为回归了；调试对应的面。见 [STEALTH-COHERENCE.md](STEALTH-COHERENCE.md)。

**不要**在发布构建中加 `CLEARCOTE_SKIP_PATCH_VERIFY=1`，也不要为了让第 0 层通过而删除补丁的见证。
这个项目的全部价值，就在于隐身能力真实存在于发布出去的东西里。
