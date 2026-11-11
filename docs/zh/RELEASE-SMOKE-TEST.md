# 发布冒烟测试：绝不发布启动不了的构建

单元测试无法证明**浏览器真的能启动**。一个版本可能在 CI 上全绿，对用户却是坏的：二进制固定版本错误、
压缩包打包错误、缺少 PRO 路由，或者（在 Docker 中）缺少系统库。本冒烟测试从真实的包仓库安装**已发布的** SDK，
并**启动浏览器**：覆盖 FREE 和 PRO、Python 和 Node、每个目标操作系统，外加一个干净的容器环境；
通过读取真实的 `navigator.userAgent` 证明引擎已经启动并能运行 JS。

**每次发布 SDK 后、对外宣布之前都要运行。** 如果失败，说明这个版本是坏的：撤回或打补丁，不要发布。

## 覆盖范围

| 维度 | 取值 |
| --- | --- |
| SDK | Python（PyPI）· Node（npm） |
| 档位 | FREE（无密钥）· PRO（提供授权密钥） |
| 环境 | Windows 主机 · Linux 主机 · 干净的 Linux Docker 容器（以非特权用户运行，外加一轮带 `--cap-add=SYS_NICE` 的 root 测试） |

FREE 证明 GitHub 固定版本的构建能下载、校验并启动，且**完全不**联系授权后端。
PRO 证明经过认证的 `/api/v1/download/pro` 路由、租约/run-token 以及受控启动全流程可用。
每个档位有各自的临时主目录，由 Python 和 Node 共用，所以每个操作系统每轮只下载一次 FREE 和 PRO 二进制。

## 如何运行

测试工具位于 [`sdk/scripts/`](../../sdk/scripts/)：`smoke-release.sh`（编排脚本）+
`smoke_launch.py` / `smoke_launch.mjs`（实际的启动器，任何失败都以非零退出；
参数为 `free`、`pro`，或不传表示两者都测）。

```bash
# On EACH target OS (Windows via Git-Bash, Linux):
CCKEY=cc_lic_...  sdk/scripts/smoke-release.sh 0.32.0

# Clean-room Linux container (bare debian + the documented system libs — how Docker users deploy):
CCKEY=cc_lic_...  sdk/scripts/smoke-release.sh 0.32.0 --docker
```

- 传入你刚发布的版本号。不传密钥则只测 FREE 档（PRO 会被报告为 `SKIPPED`）。
  也可以用 `CLEARCOTE_LICENSE_KEY=` 代替 `CCKEY=`。
- **FREE 测试真的不带密钥。** SDK 会自动从 `CLEARCOTE_LICENSE_KEY` 和 `~/.code-browser/license.key` 读取密钥，
  所以维护者自己的密钥曾在无人察觉的情况下把"免费"启动变成了授权启动。现在脚本在每轮 FREE 测试开始时
  两者都不提供，启动器还加了一道保护：如果 FREE 测试运行的 Chrome 主版本不是 SDK 固定的开源构建版本，
  则判为失败（`… a licence key reached the free run?`）。只有 PRO 测试会拿到密钥。
- **前置条件：** 主机模式需要 PATH 中有 `python3` 和 `node`/`npm`；`--docker` 模式需要 Docker。
- **通过标准：** 每一轮都打印 `LAUNCH_OK`，脚本以 `0` 退出并输出 `### SMOKE PASS ###`。
  任何 `LAUNCH_FAIL` → 非零退出并输出 `### SMOKE FAIL … DO NOT SHIP ###`。
  每行会显示实际运行的 Chrome 主版本，例如 `FREE: LAUNCH_OK | Chrome/151` 和
  `PRO : LAUNCH_OK | Chrome/153`：FREE 是 SDK 固定的开源构建，PRO 是当前的授权构建。

授权密钥是机密：通过环境变量传入，绝不要硬编码进脚本或提交到仓库的文件中。

## Docker：系统库

裸镜像（`FROM debian:bookworm-slim`、`python:*-slim`、`node:*-slim`）**不包含任何** Chromium 依赖的共享库，
所以在其中启动会报 `error while loading shared libraries`。这是一个正常的版本在 Docker 中"坏掉"的最常见原因。
容器必须安装以下包（bookworm 包名）：

```
ca-certificates fonts-liberation libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2
libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0
libpangocairo-1.0-0 libcairo2 libatspi2.0-0 libxshmfence1 libx11-6 libxcb1 libxext6 libxi6
```

在容器中用 `--no-sandbox` 运行浏览器（上面的 SDK 示例已经这样做了），或者配置用户命名空间。
`--docker` 模式安装的正是这份列表，所以 `--docker` 测试通过，也就证明了应该在用户文档中写明的就是这些库。

## Docker：root 容器

`--docker` 模式以镜像中的非特权 `node` 用户运行每一轮 SDK 测试，这与已发布的 `teamflatearth/clearcote`
镜像运行浏览器的方式一致（以它自己的 `cc` 用户运行）。

在 Chromium 150 开源构建（`v0.1.0-pre.23`）及之前，在容器中以 **root** 运行会让开源构建在启动时停止：
它编译时开启了调试断言（DCHECK），而当容器没有 `CAP_SYS_NICE` 时，Chromium 的 `setpriority()` 调用会被拒绝，
报错 `FATAL:base/process/process_linux.cc … DCHECK failed: result == 0. : Permission denied`，
在 Playwright 中表现为 `Target page, context or browser has been closed`。从 Chromium 151 起，开源构建与授权构建一样
是关闭了 DCHECK 的正式构建（official build），不再受影响。`--docker` 模式仍会额外以 root 加 `--cap-add=SYS_NICE`
跑一轮 FREE 测试，以覆盖仍固定在 150 的用户。（在本测试工具改为以非特权用户运行之前，它自己的 `--docker`
模式就是以 root 运行的，并且正是因为这个原因导致 FREE 档失败，0.31.1 和 0.32.0 都是如此。）

## 它能发现什么

- FREE 失败而 PRO 通过（或反之）→ 某个档位特有的打包/路由 bug。
- FREE 报告的是授权版的 Chrome 主版本 → 有密钥进入了免费测试；测试工具的隔离失效了。
- 主机通过但 `--docker` 失败 → 缺少系统库（更新上面的列表和用户文档）。
- 非特权测试通过但 root 测试失败 → `--cap-add=SYS_NICE` 已不足以覆盖 root 容器；
  更新 `docker/README.md` 和各 SDK README 中的 Linux 说明。
- Python 通过但 Node 失败（或反之）→ 单个 SDK 的回归（例如 PRO 路径只在一种语言中落地，
  或者某个版本是从过时的代码树发布的）。
- 导入失败（`exit 2`）→ 包没有装上，或入口点损坏。

> **裸镜像必须满足的运行时要求（0.28.0 发布时学到的）：** Node **20 或更新**：`playwright-core ^1.49`
> 解析到的版本拒绝 Node 18，而 Debian bookworm 打包的正是 Node 18，所以容器使用 `node:20-bookworm-slim` 镜像；
> 以及 **`xz-utils`**：Node SDK 用系统 `tar` 解压 `.tar.xz` 引擎包，这需要 `xz`
> （Python SDK 内置了 `lzma`，不需要）。这两项现在都已列入脚本的依赖清单。
