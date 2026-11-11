# 发布 SDK（npm + PyPI）：通过 GitHub Actions 自动化

这是发布 `code-browser` **SDK** 包（来自 `sdk/node` 的 npm 包 `code-browser`，以及来自 `sdk/python` 的 PyPI 包 `code-browser`）的操作手册。
它与 [RELEASING.md](RELEASING.md) 中的浏览器二进制发布是**分开的**：浏览器在自己的 `v0.1.0-pre.N` 标签线上发布；
SDK 在专门的 **`sdk-v*`** 标签线上发布。两者互不触发。

发布使用 **OIDC "可信发布（trusted publishing）"**：没有 `NPM_TOKEN`，没有 PyPI API token，GitHub secrets 中不存储任何东西。
每次运行签发一个短期 OIDC token，用来换取一次性的发布凭据。npm **provenance** 和 PyPI **PEP 740 证明**会自动生成。

> 已对照官方文档验证（2026）：npm 可信发布于 2025-07-31 正式可用
> （[更新日志](https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/)）；
> PyPI 使用 [`pypa/gh-action-pypi-publish@release/v1`](https://github.com/pypa/gh-action-pypi-publish)。
> `code-browser` 已在两个仓库上发布过，所以可以立即配置 OIDC（没有冷启动问题）。仓库是**公开的**，这是 npm provenance 所要求的。

## 工作流
- [`.github/workflows/npm.yml`](../../.github/workflows/npm.yml)：在 `sdk/node` 中构建（`tsc`）+ `npm publish`。
- [`.github/workflows/pypi.yml`](../../.github/workflows/pypi.yml)：在 `sdk/python` 中 `python -m build` + 上传（拆成两个任务：无门禁的构建 → 有门禁的发布）。

两者都在 push `sdk-v*` 标签时触发，并提供 `workflow_dispatch` 手动后备。每个都运行在一个 GitHub **Environment**（`npm` / `pypi`）之后，
带有必须审批人（required-reviewer）的审批门禁。

## 一次性设置（在第一次自动发布之前完成）

### 1. GitHub：environments
Settings → Environments → 创建 **`npm`** 和 **`pypi`**。对每一个：
- 添加 **Required reviewers**（你的发布审批人）。
- 如果你是**唯一维护者**，保持 *Prevent self-review* **关闭**（否则你永远无法审批自己的发布，会一直卡住）。
  有第二位维护者时，把它**打开**，实现双人控制。
- 可选：添加 *Deployment branches and tags* 规则，把该 environment 限制为 `sdk-v*` 标签。
- OIDC 方式不需要添加任何 secret。

### 2. npmjs.com：可信发布者
`code-browser` 包 → **Settings → Trusted Publisher → GitHub Actions**。填写（全部**区分大小写**）：
| 字段 | 值 |
|---|---|
| Organization or user | `clearcotelabs` |
| Repository | `code-browser-browser` |
| Workflow filename | `npm.yml` *（只写文件名，带 `.yml`，不带路径）* |
| Environment name | `npm` |

runner 上需要 npm CLI ≥ 11.5.1 / Node ≥ 22.14.0：工作流固定了 Node 24 并运行 `npm install -g npm@latest`，所以这一点已经处理好了。

### 3. pypi.org：可信发布者
项目 `code-browser` → **Publishing → Add a new publisher (GitHub Actions)**：
| 字段 | 值 |
|---|---|
| Owner | `clearcotelabs` |
| Repository | `code-browser-browser` |
| Workflow name | `pypi.yml` *（只写文件名）* |
| Environment name | `pypi` |

*（如果项目还不存在，在 Account → Publishing 下用相同字段添加一个 **pending publisher**：它会在第一次上传时转正，
但不会预留名字，所以要尽快发布。）*

## 每次发布的步骤（每个 SDK 版本）
1. 在**全部三个**硬编码的位置更新为**相同的**版本号：
   - `sdk/node/package.json` → `"version"`
   - `sdk/python/pyproject.toml` → `[project] version`
   - `sdk/python/code_browser/__init__.py` → `__version__`

   .NET SDK 也用同一版本发布？它还有**另外两个**位置，如果不一致，单元测试会让发布失败：
   `sdk/dotnet/src/CodeBrowser/CodeBrowser.csproj`（`<Version>`）和 `sdk/dotnet/src/CodeBrowser/CodeBrowser.cs`（`public const string Version`）。
   见 [sdk/dotnet/PUBLISHING.md](../../sdk/dotnet/PUBLISHING.md)；它在自己的 `dotnet-v*` 标签上发布。
2. 提交并推送到 `main`。
3. 打标签并推送：
   ```bash
   git tag sdk-v0.6.1
   git push origin sdk-v0.6.1
   ```
4. 推送会启动**两个**工作流。每个都会在 environment 门禁处暂停：在仓库的 Actions/Environments 界面中**批准** `npm` 和 `pypi`。
   批准后各自发布（OIDC，带 provenance/证明）。版本号与标签不一致会让运行明确失败（有一个守卫步骤），
   把忘记更新版本号变成一个清晰的红色 ❌，而不是错误发布。

5. **对已发布的版本做冒烟测试：必须做，不要跳过。** 单元测试无法证明浏览器能启动；CI 全绿依然可能发布一个启动不了的构建
   （固定版本错误、压缩包打包错误、PRO 路由损坏、缺少 Docker 系统库）。从真实的包仓库安装刚发布的版本并启动它，
   FREE + PRO、Python + Node，在**每个**目标操作系统上，外加一个干净的容器环境：
   ```bash
   CLEARCOTE_LICENSE_KEY=cc_lic_...  sdk/scripts/smoke-release.sh <version>            # this OS (run on Windows AND Linux)
   CLEARCOTE_LICENSE_KEY=cc_lic_...  sdk/scripts/smoke-release.sh <version> --docker   # clean-room Linux container
   ```
   必须打印 `### SMOKE PASS ###`（退出码 0）。任何 `LAUNCH_FAIL` → 这个版本是坏的；撤回或打补丁，不要对外宣布。
   完整细节和 Docker 系统库列表：[RELEASE-SMOKE-TEST.md](RELEASE-SMOKE-TEST.md)。

> 一个 `sdk-v*` 标签会发布**两个**包（目前它们共用一个版本号）。如果以后需要用不同的版本号发布它们，就拆分成按包区分的标签命名空间。

## MCP 服务（`code-browser-mcp`）：独立的标签线

[`mcp/`](../../mcp/) 中的 MCP 服务在专门的 **`mcp-v*`** 标签上发布（工作流 [`mcp.yml`](../../.github/workflows/mcp.yml)），
独立于 SDK 的 `sdk-v*` 标签线：它单独编号（从 `0.1.0` 开始）。一个 `mcp-v*` 标签通过 OIDC 同时发布 Python 包
（`code-browser-mcp` → PyPI）和 npm 启动器（`code-browser-mcp` → npm）。

1. 在**全部四个**位置更新为**相同的**版本号：`mcp/pyproject.toml`、`mcp/code_browser_mcp/__init__.py`（`__version__`）、
   `mcp/npm/package.json` 和 `mcp/server.json`（顶层 `version` 以及每个包的 `version`；否则 `mcp/tests/test_registry.py` 会失败）。
2. 提交并推送，然后：
   ```bash
   git tag mcp-v0.1.0
   git push origin mcp-v0.1.0
   ```
3. 推送会运行 `mcp.yml`：一个版本一致性守卫 + MCP 测试（[`mcp-ci.yml`](../../.github/workflows/mcp-ci.yml)：
   分别在最新依赖和声明的最低版本下重新解析 `./mcp`），然后在 `pypi` 和 `npm` 两个 environment 门禁处暂停。
   逐个批准后，两者都通过 OIDC 发布。`mcp-ci.yml` 还会每周运行一次，检查已发布的包，因为上游 `mcp` 的新版本可能在这里没有任何提交的情况下
   让全新安装失败。

**一次性的可信发布者注册**（与 SDK 相同，但指向 `mcp.yml`）：
- PyPI：项目 `code-browser-mcp` → Publishing → 添加仓库 `jyycool/code-browser`，工作流 `mcp.yml`，environment `pypi`。
- npm：`code-browser-mcp` → Settings → Trusted Publisher → GitHub Actions，工作流 `mcp.yml`，environment `npm`。

### 在官方 MCP Registry 中登记

[`mcp/server.json`](../../mcp/server.json) 是 Registry 条目（`io.github.jyycool/code-browser-mcp`，包含两个包）。
Registry 只存储这份元数据，并检查每个包是否声明了该条目：`mcp/npm/package.json` 中的 `mcpName`，以及 `mcp/README.md`
顶部的 `mcp-name:` 注释（即 PyPI 描述）。两者只有随发布才会到达各包仓库，所以要在包含它们的 `mcp-v*` 版本已在 PyPI 和 npm 上线、
且 `server.json` 已是该版本**之后**，再发布这个条目。`io.github.clearcotelabs/` 命名空间需要证明对 `clearcotelabs` 组织的所有权，
而交互式的 `mcp-publisher login github` 做不到（它只能访问个人的 `io.github.<user>/` 命名空间）。
因此改用手动触发的 [`mcp-registry.yml`](../../.github/workflows/mcp-registry.yml) 工作流发布：它使用工作流的 GitHub OIDC token 登录，不存储任何东西。

```bash
gh workflow run mcp-registry.yml -R jyycool/code-browser
```

如果一定要在本地运行（需要一个所有者的、带 `read:org` 权限的 classic PAT）：

```bash
# mcp-publisher: `brew install mcp-publisher`, or the binary from
# https://github.com/modelcontextprotocol/registry/releases
cd mcp
mcp-publisher validate            # checks server.json without publishing
mcp-publisher login github --token <classic PAT with read:org>
mcp-publisher publish
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.jyycool/code-browser-mcp"
```
以后每次发布：把 `server.json` 与另外三处版本号一起更新，然后再次运行该工作流。

## 认证后备方案（仅在 OIDC 不可用时）
如果必须在配置 OIDC 之前发布：在已登录的机器上运行 `npm publish --access public`（或使用临时的 `NODE_AUTH_TOKEN` 自动化 token），
并用 PyPI API token 运行 `twine upload`。之后切回无 token 的 OIDC 方式。**不要**把 token 留在 GitHub secrets 中。

## 备注 / 坑点
- 包仓库配置与工作流之间，owner/repo/工作流文件名/environment 都必须**区分大小写地完全一致**：仓库名是 `code-browser-browser`（不是 `code-browser`）。
  不一致会让 OIDC 静默失败，并报 "invalid publisher" 错误。
- npm provenance 要求仓库保持**公开**，并且 `package.json` 的 `repository` 与之一致
  （目前一致：`git+https://github.com/jyycool/code-browser.git`）。把仓库改为私有会静默关闭 provenance。
- PyPI action 的 `release/v1` 是一个会移动的主版本指针；为了最大程度的供应链加固，可以把它固定到完整的提交 SHA（代价是需要手动更新）。
