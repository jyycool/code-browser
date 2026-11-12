// Shell UI: home -> loading -> browser (embedded) / failed / crash.
const api = window.shellApi;
const $ = (id) => document.getElementById(id);

const views = { home: $("view-home"), loading: $("view-loading"), browser: $("view-browser"), crash: $("view-crash") };
let phase = "home";
let showNavBar = true;
let noticeTimer = null;

function show(name) {
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
  if (name === "browser") requestAnimationFrame(reportBounds);
}

function bind(key, value) {
  for (const el of document.querySelectorAll(`[data-bind="${key}"]`)) el.textContent = value ?? "";
}

/* ---------- home ---------- */
async function loadInfo() {
  const info = await api.info();
  document.documentElement.style.setProperty("--accent", info.accent);
  document.title = info.appName;
  bind("appName", info.appName);
  bind("tagline", info.tagline);
  bind("identity", info.identity);
  bind("proxy", info.proxy);
  bind("version", `v${info.version}`);
  showNavBar = info.showNavBar;
  $("navbar").hidden = !showNavBar;

  const dot = $("kernel-dot");
  dot.classList.toggle("dot-ok", info.kernelFound);
  dot.classList.toggle("dot-bad", !info.kernelFound);
  $("kernel-text").textContent = info.kernelFound ? "内核已就绪" : "未找到浏览器内核";
  $("kernel-text").title = info.kernelPath;

  const list = $("warnings");
  list.replaceChildren();
  const notes = [...info.warnings];
  if (!info.kernelFound) notes.unshift(`请把编译好的浏览器放到：${info.kernelPath}（或在配置文件中设置 executablePath）`);
  if (notes.length) notes.push(`配置文件：${info.configFile}`);
  for (const w of notes) {
    const li = document.createElement("li");
    li.textContent = w;
    list.append(li);
  }
  list.hidden = notes.length === 0;
}

/* ---------- loading ---------- */
const STATE_TEXT = { pending: "等待", running: "进行中", done: "完成", skipped: "跳过", error: "失败" };
const ICONS = {
  done: '<circle cx="12" cy="12" r="10"/><polyline points="7.5 12.5 10.5 15.5 16.5 9"/>',
  running: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4" class="fill"/>',
  pending: '<circle cx="12" cy="12" r="10"/>',
  skipped: '<circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>',
  error: '<circle cx="12" cy="12" r="10"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>',
};
const ICON_COLOR = { done: "#15803D", running: "var(--accent)", pending: "#9CA3AF", skipped: "#9CA3AF", error: "#B91C1C" };

function svgIcon(status) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("stroke", ICON_COLOR[status]);
  // Static markup from the table above, never page data.
  const tpl = new DOMParser().parseFromString(`<svg xmlns="${ns}">${ICONS[status]}</svg>`, "image/svg+xml");
  for (const child of [...tpl.documentElement.childNodes]) {
    const node = document.importNode(child, true);
    if (node.getAttribute && node.getAttribute("class") === "fill") node.setAttribute("fill", ICON_COLOR[status]);
    svg.append(node);
  }
  return svg;
}

function renderSteps(steps) {
  const ol = $("steps");
  ol.replaceChildren();
  for (const s of steps) {
    const li = document.createElement("li");
    li.className = `step step-${s.status}`;
    const body = document.createElement("div");
    body.className = "step-body";
    const label = document.createElement("span");
    label.textContent = s.label;
    body.append(label);
    if (s.note) {
      const note = document.createElement("span");
      note.className = "step-note";
      note.textContent = s.note;
      body.append(note);
    }
    const state = document.createElement("span");
    state.className = "step-state";
    state.textContent = STATE_TEXT[s.status];
    li.append(svgIcon(s.status), body, state);
    ol.append(li);
  }
}

function resetLoading() {
  $("page-title").textContent = "";
  $("egress-text").textContent = "—";
  $("loading-title").textContent = "正在准备浏览器…";
  $("loading-spinner").hidden = false;
  $("loading-error-icon").hidden = true;
  $("loading-error").hidden = true;
  $("loading-actions").hidden = false;
  $("failed-actions").hidden = true;
  renderSteps([
    { id: "verify", label: "校验浏览器内核", status: "pending" },
    { id: "geo", label: "查询代理出口 IP，设置时区与语言", status: "pending" },
    { id: "launch", label: "启动浏览器（无地址栏模式）", status: "pending" },
    { id: "embed", label: "嵌入到应用窗口", status: "pending" },
  ]);
}

function showFailed(message) {
  $("loading-title").textContent = "无法启动浏览器";
  $("loading-spinner").hidden = true;
  $("loading-error-icon").hidden = false;
  $("loading-error").textContent = message;
  $("loading-error").hidden = false;
  $("loading-actions").hidden = true;
  $("failed-actions").hidden = false;
}

/* ---------- browser ---------- */
function reportBounds() {
  if (phase !== "browser") return;
  const r = $("browser-host").getBoundingClientRect();
  api.setBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
}

function showNotice(text) {
  const inline = $("notice-inline");
  const strip = $("notice-strip");
  clearTimeout(noticeTimer);
  if (showNavBar) {
    inline.textContent = text;
    inline.hidden = false;
  } else {
    strip.textContent = text;
    strip.hidden = false;
    requestAnimationFrame(reportBounds);
  }
  noticeTimer = setTimeout(() => {
    inline.hidden = true;
    if (!strip.hidden) {
      strip.hidden = true;
      requestAnimationFrame(reportBounds);
    }
  }, 4000);
}

new ResizeObserver(() => reportBounds()).observe($("browser-host"));
window.addEventListener("resize", reportBounds);

/* ---------- wiring ---------- */
function setPhase(next, message) {
  phase = next;
  if (next === "home") { show("home"); void loadInfo(); }
  else if (next === "loading") { resetLoading(); show("loading"); }
  else if (next === "failed") { show("loading"); showFailed(message || "未知错误"); }
  else if (next === "browser") show("browser");
  else if (next === "crash") show("crash");
}

api.onPhase((p) => setPhase(p.phase, p.message));
api.onSteps((steps) => renderSteps(steps));
api.onStatus((s) => {
  const parts = [s.ip ? `出口 IP ${s.ip}` : "出口 IP 未知", s.timezone].filter(Boolean);
  $("egress-text").textContent = parts.join(" · ");
});
api.onTitle((t) => { $("page-title").textContent = t; });
api.onToast((t) => showNotice(`${t.title}：${t.body}`));
api.onMaximized((m) => $("wc-max").setAttribute("aria-label", m ? "还原" : "最大化"));

$("btn-start").addEventListener("click", () => { void api.start(); });
$("btn-cancel").addEventListener("click", () => { void api.stop(); });
$("btn-retry").addEventListener("click", () => { void api.start(); });
$("btn-failed-home").addEventListener("click", () => setPhase("home"));
$("btn-stop").addEventListener("click", () => { void api.stop(); });
$("btn-restart").addEventListener("click", () => { void api.start(); });
$("btn-crash-home").addEventListener("click", () => setPhase("home"));
for (const b of document.querySelectorAll("[data-nav]")) b.addEventListener("click", () => api.nav(b.dataset.nav));
$("wc-min").addEventListener("click", () => api.minimize());
$("wc-max").addEventListener("click", () => api.toggleMaximize());
$("wc-close").addEventListener("click", () => api.close());

setPhase("home");
