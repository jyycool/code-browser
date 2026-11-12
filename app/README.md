# code-browser 桌面应用（Windows）

一个 Electron 外壳：首页有一个"开始"按钮，点击后在应用窗口**内部**打开 code-browser 浏览器。
浏览器没有地址栏、标签栏、菜单和设置；指纹、代理、时区都在引擎里生效。

```
首页 ──[开始]──► 启动中（校验内核 → 查询出口 IP → 启动浏览器 → 嵌入窗口）──► 浏览器（嵌入）
                       │ 失败：显示原因，可重试                                │ 停止 → 首页
                                                                              │ 意外退出 → 提示页，可重新开始
```

## 准备

1. **编译浏览器内核**（见 [从源码构建](../docs/zh/BUILDING.md)），把编译输出的**整个目录**（包含 `chrome.exe`）放到 `app/kernel/`：

   ```
   app/kernel/chrome.exe
   app/kernel/chrome.dll
   app/kernel/locales/...
   ...
   ```

   也可以不放在这里，在配置文件中用 `executablePath` 指定内核的完整路径。

2. **构建 SDK**（应用复用它的启动逻辑）：

   ```bash
   cd sdk/node
   npm install
   npm run build
   ```

3. **安装应用依赖：**

   ```bash
   cd app
   npm install
   ```

## 运行与打包

```bash
npm start          # 开发运行
npm test           # 单元测试
npm run dist       # 打包：release/ 下生成安装包（NSIS）和 zip
```

打包时 `app/kernel/` 会被复制到安装目录的 `resources/kernel/`。

建议在 Windows 上打包：这样 `.exe` 会写入图标和版本信息。在 Linux 上打包时，`electron-builder.yml` 里的
`signAndEditExecutable` 需要保持 `false`（否则需要 Wine）。

## 配置文件

设置不能在界面上修改，只能改配置文件。第一次运行时，应用会把默认配置复制到：

```
%APPDATA%\code-browser\config.json
```

改完后重启应用生效。配置有误时，首页会显示提示，并改用默认值。

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `appName` / `tagline` | `code-browser` / `安全、独立的浏览环境` | 首页和标题栏显示的名称与介绍 |
| `accent` | `#2563EB` | 主题色（`#RRGGBB`） |
| `startUrl` | `https://example.com` | 点击"开始"后打开的网址（http 或 https） |
| `fingerprint` | `user-0001` | 指纹种子。同一个种子 = 同一台"机器" |
| `platform` | `windows` | 呈现的操作系统：`windows` / `linux` / `macos` / `android` |
| `brand` | `Chrome` | 浏览器品牌：`Chrome` / `Edge` / `Opera` / `Vivaldi` |
| `proxy` | 空 | 代理，例如 `socks5://用户名:密码@1.2.3.4:1080`，支持 http、https、socks5 |
| `geoip` | `true` | 按出口 IP 自动设置时区和语言，并让 WebRTC 报告出口 IP |
| `timezone` / `acceptLanguage` | 空 | 手动指定时区和语言，优先于 `geoip` 的结果 |
| `executablePath` | 空 | 内核路径；为空时使用 `kernel\chrome.exe` |
| `kernelSha256` | 空 | 填写后，启动前校验内核 `chrome.exe` 的 SHA-256 |
| `extraArgs` | `[]` | 额外传给内核的命令行开关 |
| `showNavBar` | `true` | 是否显示顶部导航条（后退、前进、刷新、回首页、停止） |
| `newWindow` | `same-page` | 网页打开新窗口时：`same-page` 在当前页面打开，`block` 直接拦截 |
| `embedMode` | `child` | 嵌入方式：`child` 真正的子窗口；`follow` 跟随窗口（备用） |
| `blockShortcuts` | `true` | 屏蔽 Ctrl+T/N/W、Ctrl+Shift+I、F12 等浏览器快捷键 |
| `writePolicies` | `false` | 写入 Chromium 策略（见下文），默认关闭 |
| `maxWindow` | `1920×1080` | 应用窗口的最大尺寸，避免窗口比画像里的屏幕还大 |

浏览器的登录状态和 Cookie 保存在 `%APPDATA%\code-browser\profile\`，下次开始时会恢复为同一个身份。

## 工作原理

| 部分 | 文件 | 作用 |
|---|---|---|
| 启动 | `src/main/session.ts` | 用 SDK 的 `serve()` 以 `--app=<网址>` 模式启动内核（没有地址栏），先放在屏幕外，避免嵌入前闪一下 |
| 嵌入 | `src/main/embed.ts`、`win32.ts` | 按进程号找到浏览器窗口，去掉边框，`SetParent` 设为应用窗口的子窗口，按界面里的占位区域和屏幕缩放比例调整位置 |
| 守卫 | `src/main/guard.ts` | 通过 CDP 监听：新窗口或新标签改为在当前页打开（或关闭）；`chrome://` 等内部页面、开发者工具一律关闭或返回起始页 |
| 快捷键 | `src/main/keys.ts` | 低级键盘钩子：应用在前台时屏蔽打开浏览器界面的快捷键；Ctrl+C/V、Ctrl+F、打印等保留 |
| 策略 | `src/main/policy.ts` | 可选。写入 `HKCU\Software\Policies\Chromium`：禁用开发者工具、无痕模式、访客模式，屏蔽内部页面。**会影响这台电脑上所有 Chromium 内核的浏览器**，所以默认关闭；退出应用时会删除写入的值 |
| 界面 | `src/renderer/` | 首页、启动中、浏览器、异常四个界面，与原型一致 |

守卫和快捷键屏蔽不会向网页注入任何脚本，也不会启用 `Runtime` 域，所以不影响指纹。

## 在 Windows 上需要验证的项目

嵌入只在 Windows 上生效，开发环境（Linux）里浏览器会以独立窗口运行。请在 Windows 上逐项确认：

- [ ] 点击"开始"后，浏览器出现在应用内的内容区，没有地址栏和边框，启动时没有在别处闪一下
- [ ] 拖动、缩放、最大化、还原、最小化后，浏览器始终铺满内容区
- [ ] 显示缩放为 100%、125%、150% 时位置都正确，边缘没有缝隙
- [ ] 在网页里能正常点击、滚动、输入，中文输入法正常
- [ ] Ctrl+T、Ctrl+N、Ctrl+Shift+I、F12 没有反应
- [ ] 右键"在新窗口中打开链接"、`target=_blank` 链接：在当前页面打开，并显示提示
- [ ] 关闭应用后，任务管理器里没有残留的 `chrome.exe`
- [ ] 在任务管理器里结束 `chrome.exe`：应用显示"浏览器已意外退出"，可以重新开始

如果嵌入后出现焦点、输入法或显示问题，把配置里的 `embedMode` 改为 `follow` 再试，然后把现象告诉开发者。
