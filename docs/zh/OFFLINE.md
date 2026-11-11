# 离线模式（Platform 授权）

在隔离的、物理断网的网络中运行 CodeBrowser PRO：不发起授权请求、不下载、不发送遥测。离线模式随 Platform 授权提供。
你需要从账户中拿到两样东西：**离线密钥（Offline Key）** 文件，以及**离线包**（PRO 浏览器加 SDK 安装包）。

## 1. 制作离线包（在一台联网的中转机器上）

Linux / macOS 中转机：

```bash
curl -fsSL https://www.clearcotelabs.com/api/v1/offline/fetch.sh -o fetch.sh
CLEARCOTE_LICENSE_KEY=cc_lic_... bash fetch.sh linux
```

Windows 中转机：

```powershell
iwr https://www.clearcotelabs.com/api/v1/offline/fetch.ps1 -OutFile fetch.ps1
$env:CLEARCOTE_LICENSE_KEY = "cc_lic_..."; .\fetch.ps1 -Platform windows
```

脚本生成的目录包含 `code-browser-offline-key.json`、PRO 浏览器压缩包（已做 sha256 校验）、带依赖的 SDK 安装包
（`sdk/python`、`sdk/node`）以及一个 `SHA256SUMS` 文件。`pip download` 下载的是适配中转机自身 Python 版本和操作系统的 wheel，
所以中转机的操作系统和 Python 版本要与离线机器一致。
按你们正常的传输流程把这个目录搬进隔离网络，并用 `sha256sum -c SHA256SUMS` 校验。

## 2. 在离线机器上安装

```bash
tar -xJf browser/code-browser-pro-*-linux-x64.tar.xz -C /opt/code-browser
pip install --no-index --find-links sdk/python code-browser          # Python
npm install --offline ./sdk/node/node_modules/code-browser           # Node (or copy node_modules)
```

## 3. 启动

Python：

```python
import code_browser
browser = code_browser.launch(offline_key="/etc/code-browser/code-browser-offline-key.json",
                           executable_path="/opt/code-browser/chrome")
```

Node：

```js
import { launch } from "code-browser";
const browser = await launch({ offlineKey: "/etc/code-browser/code-browser-offline-key.json", executablePath: "/opt/code-browser/chrome" });
```

.NET：

```csharp
var browser = await CodeBrowser.LaunchAsync(new LaunchOptions {
    OfflineKey = "/etc/code-browser/code-browser-offline-key.json", ExecutablePath = "/opt/code-browser/chrome" });
```

也可以设置 `CODE_BROWSER_OFFLINE_KEY=/etc/code-browser/code-browser-offline-key.json` 和 `CODE_BROWSER_BINARY=/opt/code-browser/chrome`，
代码保持不变。离线模式下 SDK 不发起授权请求、从不下载；它读取密钥、检查到期日，再把密钥中的 token 交给浏览器，由浏览器在本地校验。

不用 SDK（直接用 Playwright）：启动 PRO 二进制时，把环境变量 `CLEARCOTE_RUN_TOKEN` 设为密钥文件中 `token` 字段的值。

## 4. 在离线站点更换密钥

每个密钥的有效期是付费周期再加 30 天。每次续费后，新密钥会通过邮件发给你，也可以在 Licenses 页面的 Offline 卡片中获取
（或用你的授权密钥调用 `GET /api/v1/offline/key`）。

1. 收到续费邮件后，尽快在联网机器上下载新密钥。
2. 按正常传输流程把它搬进每个离线环境。
3. 用新文件替换启动时所用路径（`offline_key` / `CODE_BROWSER_OFFLINE_KEY`）下的旧文件。其它东西都不需要重启：
   下一次启动浏览器时就会使用新密钥。
4. 检查：`python -c "import json;print(json.load(open('/etc/code-browser/code-browser-offline-key.json'))['expires_at'])"`。

浏览器在本地强制执行的规则：

- **始终安装最新的密钥。** 一台机器一旦用过某个密钥，就会拒绝在它之前签发的任何密钥。
- **过期即失效。** 超过 `expires_at` 后，浏览器在装上更新的密钥之前无法启动。SDK 从到期前 7 天开始在 stderr 输出警告
  （`quiet=True` 可关闭）。
- **时钟。** 密钥从签发前两天起就有效，所以时钟略慢的机器也能接受。时钟快很多会让密钥提前显得过期：请保持离线机器的时间正确。

一个组织级密钥可用于所有机器和站点，不需要逐台激活。

## 故障排查

| 提示信息 | 含义 |
| --- | --- |
| `This offline key expired on …` | 安装续费后得到的最新密钥。 |
| `Offline mode runs the PRO binary from your offline bundle` | 传入 `executable_path` / `ExecutablePath`，或设置 `CODE_BROWSER_BINARY`。 |
| `… is not a CodeBrowser offline key file` / `has no valid token` | 文件在传输中被修改或截断；与 `SHA256SUMS` 比对。 |
| 浏览器退出：`no valid license lease for this run` | token 被拒绝：密钥比这台机器已用过的更旧、密钥已过期，或文件被编辑过。 |
