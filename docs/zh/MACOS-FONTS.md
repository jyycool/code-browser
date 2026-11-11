# macOS：画像字体

跨操作系统的画像（persona）在 macOS 构建上如何获得字体、哪些已经验证、哪些还没有。
对应补丁 `956`–`958`。如果你构建的是 Windows 或 Linux，这些都不适用：这两个目标从不声明该字体包，
也从不编译注册逻辑。

> **范围：仅限开源的 Chromium 150 macOS 构建。** `956`–`958` 位于
> [`patches/macos-150/`](../../patches/macos-150/)，针对 150 源码树编写。它们不在 Chromium 151 的
> `patches/series` 中，开源 151 也没有 macOS 构建。

## 问题

Windows 画像必须拿到 Windows 字体，否则字体列表说的是一回事，每个字符的步进宽度说的是另一回事。
在 Linux 上，发布包在 `assets/fonts/` 中捆绑了度量兼容的开源克隆字体，SDK 把 `FONTCONFIG_FILE`
指向 `assets/fonts/fonts.conf.template`，于是 `Segoe UI` 解析为 Selawik，`Calibri` 解析为 Carlito，依此类推。

macOS 没有 fontconfig，一台原装 macOS 27.0 机器的 `/Library/Fonts` 中只有一个文件，
Arimo、Carlito、Caladea、Tinos、Cousine、Selawik、Gelasio 一个都没有。所以在 macOS 上，
同样的画像完全得不到替代字体。

在原生 150.0.7871.114 arm64 构建、`platform="windows"` 下，`956`–`958` 之前与之后的实测：

| 探测项 | 之前 | 之后 |
|---|---|---|
| Segoe UI、Calibri、Consolas、Cambria、Candara、Corbel | 不存在 | **存在** |
| Helvetica Neue | 存在 | **不存在** |
| Lucida Grande、Menlo、Geneva、Optima、Apple Chancery、Hiragino Sans | 不存在 | 不存在 |
| `16px system-ui` | 56.84（与 macos 画像相同） | **57.96** |
| `32px` serif / monospace / cursive | 111.98 / 111.98 / 111.98 | **111.98 / 96.00 / 106.82** |

`width(monospace) == width(serif)` 在真实 Windows 上不可能出现，而且不需要任何参照数据就能发现，
所以通用字体族和具名字体族同样重要。

## 构建

```bash
scripts/provision-macos-fonts.sh /path/to/chromium/src   # BEFORE gn gen
```

它把 `assets/fonts/` 复制到 `third_party/clearcote_fonts/`，并对照 `assets/fonts/SHA256SUMS` 校验。
它必须在 `gn gen` 之前运行，因为 gn 在生成阶段解析 `bundle_data` 的源文件：缺文件是 gn 错误，而不是构建错误。

没有新增字体，也没有新增许可证：这些就是 Linux 发布包已经捆绑的同一批文件。
见 `assets/fonts/ATTRIBUTION.md`。

运行时，字体位于
`Chromium.app/Contents/Frameworks/Chromium Framework.framework/Resources/clearcote_fonts/`，
当跨操作系统画像第一次需要某个字体时，以 `kCTFontManagerScopeProcess` 作用域注册到 CoreText：
只对该进程可见，从不写入用户的字体数据库，进程退出即消失。不带画像的启动、以及同操作系统的画像，
不会注册任何字体。渲染进程沙箱本来就允许读取应用包，因此不需要修改沙箱。

## 验证

```bash
python3 scripts/verify_macos_persona.py          # CC_APP=... to point elsewhere
```

关于测量，有两点是吃过亏才学到的：

* **要传种子。** 只有带 `--fingerprint` 或 `--fingerprint-profile` 时 `ungoogled::PersonaActive()` 才为真，
  而 `FontCache::GetFontPlatformData` 中整段字体逻辑都以它为前提。只传 `platform=` 的启动只伪装字符串，
  完全不做字体处理，所以什么也测不出来。
* **只看宽度不能判断字体是否存在。** 要比较完整的 `TextMetrics` 向量，并对照不止一个通用回退字体。
  macOS 的 monospace 默认是 Menlo，所以用 monospace 基线去检查一个等宽度量的字体族，会显得它不存在；
  而 Tinos（Times New Roman 的克隆）与 macOS 的 Times 度量完全相同，Windows 画像下 serif 回退恰好解析到 Times。
  `document.fonts.check()` 对几乎任何字体名都返回 true，在这里毫无用处。

## 已知缺口

* **`cursive` 和 `fantasy` 都落到 Comic Neue。** 真实 Windows 上分别是 Comic Sans MS 和 Impact，两者不同。
  `fantasy` 故意没有重映射：macOS 对它的默认是 Papyrus，而真实 Windows 机器*确实有* Papyrus，
  重映射会让 `font-family: Papyrus, fantasy` 解析成 Impact，而 Windows 会解析成 Papyrus。
  这等于用一个不存在的字体换掉一个存在的字体，是两种错误中更糟的那种。
* **Emoji 没有替代。** `MetricCompatibleSubstitute` 把 Segoe UI Emoji 映射到 Noto Color Emoji，
  但 `assets/fonts/` 没有附带它，而且 CoreText 无论如何也渲染不了它（它是 CBDT/CBLC 位图字体；
  CoreText 支持的是 COLR/CPAL 和 sbix）。
* **`957` 根据 HKLM `FontSubstitutes` 注册表项把 `Helvetica` 解析为 Arial**，这是从文档中读来的，
  没有在 Windows 主机上实测。值得在 Windows 上跑一次确认。
* **克隆字体的宽度就是克隆字体的宽度。** 这里没有拿它们和真实 Windows Chrome 比较；
  `assets/fonts/ATTRIBUTION.md` 已经记录 Consolas/Inconsolata 是已知最差的情况。
* **`scripts/verify_patches.py` 在 macOS 源码树上无法完成第 1 层校验。**
  `905-rc-invoked-guard.patch` 把 `chrome/app/chrome_command_ids.h` 中的 `#if (0)` 改为 `#if (1)`，
  而这个 `#if (0)` 是 **ungoogled-chromium-windows** 叠加层写入的；基于 macos 叠加层构建的 macOS 源码树
  在那里是 `#if BUILDFLAG(IS_LINUX)`，所以 `905` 永远打不上，反向剥离也停在它这里。第 0 层通过，
  `956`–`958` 能干净地剥离；但 series 中 `905` 之下的所有补丁在 macOS 上都没有被检查。
  这是早已存在的问题，不是这些补丁引入的，与该源码树上已知的依赖叠加层的 hunk 属于同一类不匹配。
* 更一般地说，门禁能证明补丁*在源码树里*，却无法证明被修改的文件*在目标的构建图里*。
  正是这个区别，让三个字体补丁进入了 macOS 构建却完全不起作用。为每个补丁加一条
  `gn desc out/Default <target> sources` 断言就能补上这个缺口。
