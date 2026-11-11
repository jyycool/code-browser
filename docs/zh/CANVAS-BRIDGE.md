# Canvas 渲染桥（Canvas Bridge）

在一块**真实的远程 GPU** 上渲染 canvas 和 WebGL，让页面读回的像素与你的配置所声称的 GPU 一致。

> **状态：** 实验性，`v0.1.0-pre.12`。需要主动开启：不传 `--canvas-bridge-url` 时，clearcote 完全在本地渲染，与以前完全一样。
> Canvas2D（含 `measureText`）和 **WebGL** 都会被转发：几何、着色器、uniform、绘制调用、**程序生成的纹理**
> （从像素数组 `texImage2D`）、`readPixels` **以及** `toDataURL`。如果某个 WebGL canvas 的纹理来自图片 / 2D canvas / 视频，
> 或使用了 3D 纹理，该 canvas 会自动**回退到本地渲染**，所以永远不会返回渲染了一半的结果。
>
> **引擎支持：** `--canvas-bridge-url` / `--canvas-bridge-auth`（渲染桥本身）在当前已发布的构建上可用。
> 按源的策略开关（`--canvas-bridge-mode` / `-allow` / `-deny` / `-fallback`）需要**最新的引擎构建**，
> 旧的二进制会静默忽略它们（不起作用）。因此 SDK 的 `canvasBridge` 选项是向前兼容的：在旧二进制上设置 `mode`/`allow`/`deny`/`fallback`，
> 效果只是对所有源都走渲染桥，且 `fallback=block`。

## 为什么

clearcote 在宿主机实际拥有的 GPU 上渲染 canvas/WebGL。如果配置声称的 GPU 与宿主机*不同*，严格的反检测 / 浏览器篡改检查
可以通过比较渲染像素与所声称的硬件来发现这种不一致（你无法在软件中让一块 GPU 输出另一块 GPU 的精确像素，见
[docs/zh/RESEARCH.md](RESEARCH.md)）。渲染桥消除了这种不一致：它不是在本地渲染、只伪装 GPU *字符串*，而是
**把 canvas/WebGL 操作转发到一个拥有你想要呈现的 GPU 的远程浏览器**，并返回那个浏览器的真实像素。

因为它转发的是*操作*（而不是一个固定的预录图像库），所以它能处理任意的、程序生成的 canvas，而不只是已知的探测脚本。

## 工作原理

```
   clearcote (your automation host)          render browser (real GPU)
   +-----------------------------+           +------------------------+
   | page: getImageData /        |  ops  --> | a real browser renders |
   |   toDataURL / readPixels /  |           |  the ops on its real   |
   |   measureText               |           |  GPU and reads back     |
   | CanvasBridgeClient  <--- pixels ---------|  the pixels            |
   +-----------------------------+           +------------------------+
```

读回 API（`getImageData`、`toDataURL`、`readPixels`、`measureText`）返回渲染浏览器的真实像素；在渲染桥路径上，本地的 farbling 噪声被绕过
（渲染桥的像素就是真实值）。传输层是一个承载紧凑二进制消息流的 WebSocket。

渲染浏览器可以是：

- **一个你通过 Chrome DevTools Protocol 连接的浏览器**（`--backend cdp`）：推荐的方式，因为你可以选择一台 GPU 恰好是你想呈现的消费级 GPU 的主机；或者
- **一个本地的无头 clearcote**（`--backend local`）：最简单，但 canvas 身份就是你自己机器的 GPU。

参考实现的渲染服务器位于 [`tools/canvas-bridge-server/`](../../tools/canvas-bridge-server/)。

## 选择在哪里渲染：GPU *就是*你的 canvas 身份

渲染浏览器运行在哪块 GPU 上，那块 GPU **就会成为每个使用它的客户端所呈现的 canvas/WebGL 指纹**。由此得出两点：

1. **选择真实的消费级 GPU。** 带有真实消费级 GPU（典型的笔记本/台式机集显或独显）的渲染主机，会产生一个合理、常见的 canvas 身份。
   避免使用**软件光栅化器**（例如 "Basic Render Driver" / SwiftShader / llvmpipe）或**数据中心 GPU** 渲染的主机：两者虽然自洽，
   但作为非消费级硬件会很显眼。你可以从服务器连接时记录的 GPU 字符串判断拿到的是哪种（见下面第 3 步）。
2. **一个渲染主机 = 一个 canvas 身份。** 共享同一个渲染主机的所有配置共享它的 canvas 哈希，因此可以通过 canvas 被关联。
   如果需要许多*不可关联*的身份，请**每个身份组使用一个渲染主机（GPU）**。

渲染主机需要**你自己提供**。任何能向浏览器暴露 CDP/WebSocket 端点的东西都可以：浏览器托管服务商，或者你自己在一台闲置机器上运行的浏览器。
clearcote 不提供也不背书任何服务商；请选择满足上述条件的。

## 教程：在远程真实 GPU 浏览器上渲染（推荐）

### 1. 获取一个连接到真实消费级 GPU 浏览器的 CDP 端点

获取一个 Chrome DevTools Protocol WebSocket URL（`ws://…` 或 `wss://…`），指向运行在你想呈现的 GPU 上的浏览器。可以：

- **从浏览器托管服务商处获取**，它会为远程浏览器会话提供 CDP/WebSocket URL。选择节点运行在**真实消费级 GPU** 上的服务商/套餐
  （在第 3 步中验证）。如果服务商通过 API 签发短期会话，见 [运维说明与坑点](#运维说明与坑点) 中的*短期会话*。
- **从你控制的另一台机器上的浏览器获取**，用 `--remote-debugging-port=9222` 启动。它的 CDP URL 是
  `http://<machine>:9222/json/version` 中的 `webSocketDebuggerUrl` 字段。

### 2. 启动指向该浏览器的渲染服务器

```bash
pip install playwright            # one-time (no browser download needed for CDP)
python tools/canvas-bridge-server/server.py \
    --backend cdp \
    --cdp-url 'ws(s)://<your-render-browser>/...' \
    --port 9099
```

### 3. 记下服务器报告的渲染 GPU

连接时，服务器会探测渲染浏览器**真实的** WebGL 字符串并记录下来，例如：

```
[backend] connected over CDP; render GPU='ANGLE (Intel, Intel(R) UHD Graphics ... D3D11)'
[server] backend=cdp up; render GPU='ANGLE (Intel, Intel(R) UHD Graphics ... D3D11)'; listening on ws://127.0.0.1:9099
```

确认它是真实的消费级 GPU（不是软件渲染器或数据中心显卡）。复制 vendor 和 renderer 字符串，下一步要让客户端与它们一致。

### 4. 启动 clearcote，带上渲染桥**以及匹配的 GPU**（一致性）

渲染桥让 canvas *像素*与渲染 GPU 一致；你还必须让 clearcote 的 WebGL `getParameter(UNMASKED_*)` *字符串*也与之一致，
否则字符串和像素会对不上。传入第 3 步中的确切字符串：

```bash
clearcote \
  --canvas-bridge-url=ws://127.0.0.1:9099 \
  --no-sandbox \
  --fingerprint=<seed> \
  --fingerprint-gpu-vendor='Google Inc. (Intel)' \
  --fingerprint-gpu-renderer='ANGLE (Intel, Intel(R) UHD Graphics ... D3D11)'
```

| 开关 | 含义 |
|---|---|
| `--canvas-bridge-url=ws://host:port` | 渲染桥端点。启用渲染桥时**必需**。 |
| `--no-sandbox` | **必需**：客户端从渲染进程中打开渲染桥 socket，而沙箱会阻止这一点。 |
| `--fingerprint=<seed>` | 你的画像种子。 |
| `--fingerprint-gpu-vendor` / `--fingerprint-gpu-renderer` | 设为第 3 步中的渲染 GPU，使报告的 GPU 字符串与渲染桥返回的像素一致。 |
| `--canvas-bridge-auth=user:secret` | 可选的 HTTP Basic 凭据（如果你的部署在服务器前面加了认证）。作为进程参数传递（在 `ps` / 任务管理器中可见）：请在私有网络上使用每台主机独立的密钥，不要使用共享或长期有效的密钥。 |
| `--canvas-bridge-mode=off\|all\|allow\|deny` | 按源的策略（默认 `all`）。把渲染桥限制在真正会对 canvas 一致性打分的源上。 |
| `--canvas-bridge-allow=a.com,b.com` / `--canvas-bridge-deny=...` | `mode=allow` / `mode=deny` 使用的 eTLD+1 列表。 |
| `--canvas-bridge-fallback=block\|local` | 缓存冷未命中时的行为（默认 `block`）。`local` = 永不阻塞：未命中时返回快速的本地渲染结果，而不是等待渲染桥。 |

### 5. 验证

- 客户端日志打印 `canvas-bridge: connected to <host>:<port>`（用 `--enable-logging=stderr --v=1` 运行）。
- 当页面对 canvas 计算哈希时，服务器日志打印 `rendered id=… (N ops)` 行：这就是你的客户端的 canvas 工作在远程 GPU 上被渲染。
- 在页面中，`gl.getParameter(UNMASKED_RENDERER_WEBGL)` 等于渲染 GPU，并且 `canvas.toDataURL()` 的哈希与该 GPU 一致（与不使用渲染桥时不同）。

## 替代方案：在你自己的机器上渲染

如果你有一台可以专门使用的真实 GPU 机器，可以跳过 CDP 主机，在本地渲染：

```bash
python tools/canvas-bridge-server/server.py \
    --backend local --chrome /path/to/clearcote/chrome.exe --port 9099
```

此时 canvas 身份就是那台机器的 GPU。

## 在 SDK 中使用

使用一等公民的 `canvasBridge` 选项：它会生成相应开关，并自动加上必需的 `--no-sandbox`：

```python
import clearcote
browser = clearcote.launch(
    fingerprint="user-1",
    gpu_vendor="Google Inc. (Intel)",
    gpu_renderer="ANGLE (Intel, Intel(R) UHD Graphics ... D3D11)",
    canvas_bridge={
        "url": "ws://127.0.0.1:9099",
        "mode": "allow",                 # only bridge where canvas is scored
        "allow": ["target-site.com"],
        "fallback": "local",             # never stall on a cold miss
    },
)
```

```js
// Node
const browser = await clearcote.launch({
  fingerprint: "user-1",
  gpuVendor: "Google Inc. (Intel)",
  gpuRenderer: "ANGLE (Intel, Intel(R) UHD Graphics ... D3D11)",
  canvasBridge: {
    url: "ws://127.0.0.1:9099",
    mode: "allow",
    allow: ["target-site.com"],
    fallback: "local",
  },
});
```

（如果你更喜欢，也仍然可以通过 `args` 传入原始的 `--canvas-bridge-*` 开关。）

## 运维说明与坑点

- **渲染主机从不接触你的目标站点。** 它只负责光栅化 canvas 像素。它的价值在于它的 **GPU**，而不是它的 IP：
  面向目标站点的 IP/代理是*客户端*上的另一回事。为了得到一个自洽的身份，让一个 IP 看起来像消费者网络的客户端，
  搭配一个 GPU 看起来像消费级 GPU 的渲染主机。
- **短期会话。** 如果你的服务商签发会过期的会话，在需要时生成新的 CDP URL：在参考服务器中继承 `RemoteCDPBackend` / 重写 `get_cdp_url()`。
  **关闭 CDP 连接通常不会停止远程会话或其计费**：请显式调用服务商的停止接口（在 `close()` 中调用）。
- **固定主机以获得稳定身份。** 重新连接可能落到一台*不同的*远程机器上，带着*不同的* GPU，从而改变 canvas 身份。
  如果你的服务商支持固定特定节点，请使用；GPU 发生漂移时服务器会发出警告。
- **控制面的机器人防护。** 如果服务商的会话 API 位于机器人过滤器之后，来自裸 HTTP 客户端的请求可能会被拦截：
  在这些 API 调用中发送正常浏览器的 `User-Agent`（以及任何必需的请求头）。
- **延迟。** 每次读回都是一次阻塞的网络往返（5 秒超时，之后回退到本地）。让渲染主机离得近（低 RTT）；
  对延迟敏感、canvas 密集的页面避免使用渲染桥。
- **明文传输。** `ws://` 是不加密的：在私有网络或加密隧道（Tailscale、WireGuard、SSH `-L`）上运行渲染桥。
  绝不要把服务器端口暴露在公网上。

## 延迟与计时

经过渲染桥的同步 canvas 读回（`getImageData`/`toDataURL`/`readPixels`/`measureText`）是渲染线程上的一次网络往返。
面对*感知延迟*的检测方，这次往返本身就是一个信号，与渲染桥所修正的静态 canvas/WebGL 哈希是两回事。
clearcote 在引擎层面缓解了这个问题；请针对你的目标进行调整：

- **预取 + 缓存（自动）。** 每次绘制后，引擎会在后台推测性地获取该画面并缓存。任何与上次绘制之间隔着*任何*异步边界的读取
  （动画帧、延后读取、重复读取）都直接从缓存返回，**没有往返**（`performance.now()` 也是真实、快速的）。
  只有*紧跟在绘制之后的第一次同步读取*仍可能付出 RTT。
- **`--canvas-bridge-fallback=local`（永不阻塞）。** 缓存冷未命中时，返回快速的本地渲染结果，而不是等待渲染桥。
  已预热的一致缓存仍然服务大多数读取；只有罕见的冷读取是本地的。适合既要一致性、又绝不能出现读回停顿的场景。
- **`--canvas-bridge-mode`（按源）。** 只在真正会对 canvas 一致性打分的源上使用渲染桥；其它一切在本地服务（快速，并使用一致的画像 GPU 字符串）。
  在不走渲染桥的源上，clearcote 的行为与未配置渲染桥时完全相同。
- **压缩 RTT。** 要既保持一致性、又完全消除计时差异，唯一的办法是把渲染主机放在同一个局域网/数据中心，
  使 RTT 落在本地 GPU 读回的波动范围之内。远处的住宅 GPU 与零延迟读回不可兼得：按目标选择。
  （住宅 *IP* 是代理层面的问题，与像素在哪里渲染无关。）

## 注意事项与限制

- **Canvas2D、measureText 和 WebGL**（几何、着色器、uniform、绘制调用、`readPixels`、`toDataURL`，以及程序生成的 `texImage2D` 纹理）都会走渲染桥。
  来源于图片/canvas/视频的 WebGL 纹理会回退到本地渲染，而不是走渲染桥。
- 客户端**必须使用 `--no-sandbox`**。
- 紧跟在绘制之后的第一次同步读取仍要付出一次往返，见 **延迟与计时** 中的预取 / `fallback=local` / 按源等缓解措施。
- 平滑回退：如果渲染桥不可达，clearcote 会记录一条警告并**在本地渲染**：配置错误的渲染桥只会平滑降级，不会让页面坏掉。

## 故障排查

| 现象 | 可能的原因 / 解决办法 |
|---|---|
| Canvas 仍与本地 GPU 一致 | 渲染桥没有连上。检查客户端日志中是否有 `canvas-bridge: connected`；确认 `--no-sandbox`、URL/端口以及隧道。 |
| GPU 字符串与 canvas 像素不一致 | 你没有把 `--fingerprint-gpu-vendor/-renderer` 设为服务器日志中的渲染 GPU（第 3/4 步）。 |
| 渲染 GPU 是软件渲染器 / 数据中心显卡 | 你的渲染主机没有合适的消费级 GPU：换一个主机/服务商/套餐。 |
| 页面短暂停顿，然后在本地渲染 | 读回超时（主机慢或不可达）。检查服务器和网络 RTT。 |
| 日志中出现 `malformed --canvas-bridge-url` | URL 必须是 `ws://host:port[/path]`（或 `wss://`，会按明文处理：请走隧道）。 |
| 连接被拒绝 | 服务器没有在监听 / 防火墙 / 端口错误；确认隧道。 |
