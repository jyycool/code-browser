# 隐身一致性门禁（Stealth-coherence gate）

一个回归门禁：启动发布出去的 `chrome.exe`，断言画像/加噪（persona/farble）层**内部自洽**，
即不会以严格的指纹一致性检查能看出来的方式暴露自己。

每条断言都是**自参照**的：它在不同执行上下文、不同源之间拿浏览器和*它自己*比较，
从不和外部的"已知正确"值比较。这是有意为之：门禁判定通过/失败时**不需要网络、不需要参照语料、
也不需要第二个浏览器**，因此它是可靠的 CI 门禁，而不是时灵时不灵的测试。
（可选的 `--baseline` 运行会交叉检查原版 Chrome 能通过所有检查，以此验证门禁本身的逻辑。）

## 为什么

真正的 Chromium 是自洽的：

- 文本度量落在固定的亚像素网格上（`dpr=1` 时为 **1/512 px** 的整数倍），
- 同一个字符串**在主线程和 Worker 中测得的结果相同**，
- 两种矩形 API（`getBoundingClientRect` 与 `Range.getClientRects`）**结果一致**，
- 同一台机器**在每个站点上渲染出相同的字节**。

一个破坏了上述任一不变量的加噪层，**检测方不需要知道真实值**就能发现它，只要检查这个不变量即可。
本门禁把这些不变量锁死：一旦某个被破坏（比如某个扰动只挂在 window 上下文、Worker 里没加噪），
**构建就会失败，而不是把破绽发布出去**。

## 检查项

| id | 不变量 | 加噪 bug 如何破坏它 |
|----|-----------|----------------------------|
| `measuretext-grid` | 每个 `measureText` 宽度都是 1/512 px 的整数倍 | 统一的亚网格缩放把宽度推离网格 |
| `worker-vs-main` | `measureText(s)` 在主线程和 `OffscreenCanvas` Worker 中相等 | 加噪只挂在 window 执行上下文 |
| `bcr-vs-range` | 同一节点的 `el.getBoundingClientRect().left == Range.getClientRects()[0].left`，且都在网格上 | 矩形加噪在不同 API 间应用不一致 |
| `origin-invariant` | 同一会话中两个可注册域名下的 canvas2d + WebGL 读回哈希相同 | 加噪种子按可注册域名生成 |
| `webgl-webgpu-vendor-match` | WebGPU 适配器 vendor 与 WebGL `UNMASKED_VENDOR` 属于同一厂商 | GPU 身份只在一个面上伪装、另一个面没改 |

## 运行

```bash
# gate the local build (auto-finds win-x64/chrome.exe, or set CLEARCOTE_BINARY)
py -3 scripts/stealth_coherence.py
py -3 scripts/stealth_coherence.py --binary C:\clearcote\chrome.exe --json out.json

# prove the checks themselves are correct: stock Chrome must pass all of them
py -3 scripts/stealth_coherence.py --baseline

# validate the check logic with no binary at all (runs anywhere, used on PRs)
py -3 scripts/stealth_coherence.py --selftest
```

退出码：`0` 满足约定 · `1` 违反约定 · `2` 缺少依赖/二进制 · `3` 门禁自身崩溃。

## 预期状态约定

每项检查要么是 **REQUIRED**（必须通过，即约定本身），要么是 **KNOWN_GAP**（尚未修复的破绽，记录了修复位置），
两者都声明在 `scripts/stealth_coherence.py` 顶部。门禁在以下情况**失败**：

- 某个 REQUIRED 检查失败 → **回归**；或
- 某个 KNOWN_GAP 检查现在**通过了** → 说明它已被修复；**把它提升进 `REQUIRED`**，
  以后就不可能悄悄回退（门禁会准确地打印这条提示）。

因此当前已记录的缺口不会阻塞发布，但每个引擎修复一落地就会被持续强制执行。

### 已修复并强制执行

| id | 落地的修复 |
|----|-----|
| `measuretext-grid` | measureText 扰动系数设为 0（补丁 `060`）：度量真实且落在 1/512 网格上。熵来自伪装的字体集，而不是亚网格缩放。 |
| `worker-vs-main` | 去掉度量缩放后，主线程返回的真实度量与 `OffscreenCanvas` Worker 相同（补丁 `060`）。 |
| `bcr-vs-range` | clientRects 偏移机制被**彻底删除**（补丁 `050`）：`getBoundingClientRect` 与 `Range` 矩形一致并保持在网格上。它之前已被置为系数 0，但在 `--disable-fingerprint-noise` 下置零被跳过，而成员变量仍保留乘法时代的默认值 `1`，于是该开关把每个矩形都偏移了 +1.0px；而且偏移并不均匀，因为只有 `element.cc` 中的位置遵守了绝对定位豁免。删除整个机制同时消除了这个 bug 和这一类 bug：client rects 是字体 + DPR + 视口的*输出*，永远不应是输入。 |

这些现在都是 `REQUIRED`：一旦回归，构建失败。

### 当前已知缺口

| id | 状态 |
|----|-----|
| `origin-invariant` | **按设计保留按域名生成。** canvas/WebGL 读回按可注册域名生成种子，因此同一身份在不同站点渲染结果不同。这保留了按站点加噪带来的不可关联性；只有当使用模式变为"一个配置对应一个身份"时，才有必要把种子改为按画像生成（补丁 `001`）。 |

## CI

`.github/workflows/stealth-coherence.yml`：

- **`selftest`**（Ubuntu）在每个涉及门禁的 PR 上运行：不需要二进制，验证检查逻辑。
- **`gate`**（Windows）在 `workflow_dispatch` 时运行，也作为 `workflow_call` 发布/晋级门禁
  （npm 和 PyPI 发布工作流在每次 SDK 部署时都会调用它）：它下载并校验 SDK 固定版本的 `chrome.exe`
  （`scripts/fetch_release_binary.py`），然后对这个确切的构建运行门禁。

发布前请按 `docs/zh/RELEASING.md` 在本地运行它；它也把守从预发布到稳定版的晋级。
