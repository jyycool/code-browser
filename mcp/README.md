# CodeBrowser MCP server

<!-- mcp-name: io.github.jyycool/code-browser-mcp -->

Drive the open-source **CodeBrowser stealth Chromium** from any MCP client — Claude Desktop, Cursor,
Cline, Continue, or your own agent. One shared, coherent stealth browser; ~20 tools to navigate,
read, extract, click, fill, screenshot, and persist sessions — plus `get_cdp_endpoint`, which hands
the **same** stealth browser to any Playwright / Puppeteer / browser-use / Crawl4AI client.

The fingerprint is corrected in Chromium's **C++**, so you do **not** add `puppeteer-stealth` /
`undetected-chromedriver` / any JS patching — those self-reveal and undo it. Driving over CDP adds
no automation flags, so `navigator.webdriver` stays `false` and the persona is intact end to end.

---

## Run it

**Node (no install):**
```bash
npx code-browser-mcp
```
The launcher runs the Python server with `uvx` if you have [uv](https://docs.astral.sh/uv/), else with `pipx`, else
installs it with `pip` (a Python whose `pip install` is refused outside a virtual environment, as on Debian 12+,
Ubuntu 23.04+ and Homebrew, needs uv or pipx; the launcher says so).

**Python:**
```bash
pip install code-browser-mcp
code-browser-mcp            # stdio server
```

Both auto-download + SHA-256-verify the right CodeBrowser binary per OS on first use (native Windows
x64 + Linux x64).

## Add it to a client

Claude Desktop / Cursor / Cline `mcpServers` config:

```json
{
  "mcpServers": {
    "code-browser": {
      "command": "npx",
      "args": ["-y", "code-browser-mcp"],
      "env": {
        "CODE_BROWSER_FINGERPRINT": "acct-1",
        "CODE_BROWSER_PLATFORM": "windows",
        "CODE_BROWSER_PROXY": "http://user:pass@host:port",
        "CODE_BROWSER_GEOIP": "1"
      }
    }
  }
}
```

The **persona lives in the environment**, so the tool surface stays clean:

| env var | meaning |
|---|---|
| `CODE_BROWSER_FINGERPRINT` | seed → one stable, coherent identity (same seed = same machine across runs) |
| `CODE_BROWSER_PLATFORM` | `windows` \| `linux` \| `macos` \| `android` |
| `CODE_BROWSER_BRAND` | `Chrome` \| `Edge` \| `Opera` \| `Vivaldi` |
| `CODE_BROWSER_PROXY` | `http://user:pass@host:port` (routes all traffic) |
| `CODE_BROWSER_GEOIP` | `1` → derive timezone/locale/WebRTC IP from the proxy exit IP |
| `CODE_BROWSER_TIMEZONE` / `CODE_BROWSER_ACCEPT_LANGUAGE` | explicit overrides |
| `CODE_BROWSER_HEADLESS` | `0` for a visible window (default headless) |
| `CODE_BROWSER_BINARY` | path to a specific CodeBrowser binary (optional) |
| `CODE_BROWSER_CLOUD` | `1` → the shared browser is a **hosted** CodeBrowser session instead (needs `CODE_BROWSER_API_KEY`) |
| `CODE_BROWSER_API_KEY` | your `cc_live_...` key: cloud mode, and the `run_task` tool |

Hardening knobs: `CODE_BROWSER_MCP_TOOL_TIMEOUT` (s), `CODE_BROWSER_MCP_RUN_TIMEOUT` (s, `run_task`; default 900), `CODE_BROWSER_MCP_WRITE_DIR` (sandbox for file
writes), `CODE_BROWSER_MCP_ALLOW_ANY_PATH=1`, `CODE_BROWSER_ALLOW_PRIVATE_EGRESS=1` (allow localhost /
private targets; still `http`/`https` only), `CODE_BROWSER_MCP_PREWARM=0`, `CODE_BROWSER_SERVE_PORT`, `CODE_BROWSER_MCP_INLINE_IMAGE_MAX`
(bytes; default 200000: the largest screenshot also returned inline).

## Tools

**Read** · `read_page` (Markdown by default; `format="text"` or `"both"`) · `get_page_html` · `page_elements` (interactive elements +
selectors) · `evaluate_js` · `wait_for` · `current_page` · `get_cookies` · `list_tabs`
**Act** · `navigate` · `click` (selector or visible text) · `fill_field` (selector/label/placeholder/name)
· `press_key` · `new_tab` · `close_tab`
**Capture** · `screenshot_page` (saved under the sandbox dir; up to 200 KB also returned as an image) · `save_page_pdf`
**Session** · `save_profile` / `load_profile` (cookies + storage)
**Stealth / infra** · `get_egress_info` (public IP + active persona) · **`get_cdp_endpoint`** (attach any
other CDP client to the same stealth browser)

`navigate` and `read_page` also return `http_status` (the shown document's HTTP status; `null` when there is none,
as for a local file or `about:blank`, or the browser has none for it) and `page_state`: `blocked` (HTTP 401, 403,
429 or 503), `empty` (under 20 characters of visible text: still loading, or nothing to read) or `ok`. Output
formats changed in 0.3.0: see [CHANGELOG.md](CHANGELOG.md).

**Cloud** · `run_task(task, url?, schema_json?)`: a whole task run by the hosted agent (CodeBrowser
Jet) on a cloud browser, returning its JSON result (`run_status`, `result.output`, `cost_eur`). Listed
only when `CODE_BROWSER_API_KEY` is set.

## Cloud mode

Set `CODE_BROWSER_CLOUD=1` and `CODE_BROWSER_API_KEY` and the shared browser runs on CodeBrowser's servers
instead of this machine: nothing to download, a residential IP included. Every tool works the same,
and the persona variables above still apply (`CODE_BROWSER_BINARY` and `CODE_BROWSER_SERVE_PORT` are
local-only and ignored). The one difference: a cloud session's CDP URL is single-use and the server
holds it, so `get_cdp_endpoint` has no endpoint to hand out; start your own hosted browser with
`code_browser.launch(cloud=True)` instead. Needs `code-browser` 0.34 or newer.

```json
{
  "mcpServers": {
    "code-browser": {
      "command": "npx",
      "args": ["-y", "code-browser-mcp"],
      "env": { "CODE_BROWSER_CLOUD": "1", "CODE_BROWSER_API_KEY": "cc_live_..." }
    }
  }
}
```

## Guardrails (built in)

- Every tool has a wall-clock timeout and returns a **structured error** instead of crashing the server.
- **Private addresses are refused** — only `http`/`https` urls, read the way the browser reads them (`file:`,
  `view-source:`, `chrome:` and every other scheme are always refused); this machine, the local network and cloud
  metadata endpoints are refused, for the url a tool gets and for every request the browser then makes (redirects,
  images, frames, script requests, popups), unless you opt in. Checking every request
  turns the browser's HTTP cache off. Not covered: WebSocket connections a page script opens, and a host name whose
  address changes between the check and the browser's own lookup (DNS rebinding).
- File writes are **confined** to a sandbox dir (no path traversal).
- Oversized text is **capped** so a response never floods the agent's context, with an explicit
  `<field>_truncated` flag.
- Everything a page controls (text, Markdown, HTML, element lists, script results and errors, titles, cookies, and
  the browser's error messages, which can quote the page) is **fenced** as untrusted data
  (`<untrusted_page_content>`), and nothing in it can pass for a fence tag.
- The shared browser is **rebuilt** automatically if it dies, and **closed** whenever the server stops (its input
  closed, Ctrl+C, Ctrl+Break, SIGTERM or SIGHUP), with its profile and temporary files. Not after a forced kill of
  the server; not a browser whose launch is still under way 20 s after the stop (the server waits no longer); and on
  Windows a Ctrl+Break also ends Playwright's driver at once, which leaves its `playwright-artifacts-*` folder in the
  temp directory.

## Just want the raw endpoint?

If you don't need the tools, run the browser as a standing CDP endpoint and attach your existing code:

```bash
code-browser-serve --port 9222 --fingerprint acct-1 --platform windows
# → prints http://127.0.0.1:9222 ; then:  connect_over_cdp / puppeteer.connect({browserURL})
```

See [USAGE.md](USAGE.md) for per-client examples. Part of
[code-browser-browser](https://github.com/jyycool/code-browser) (BSD-3).
