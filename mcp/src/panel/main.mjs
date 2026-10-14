// Conductor panel — MCP App page. One App per page; handlers registered before connect.
import { App } from "@modelcontextprotocol/ext-apps";
import {
  ResourceUpdatedNotificationSchema,
} from "@modelcontextprotocol/core";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const parseJson = (content) => {
  try {
    return JSON.parse((content || []).find((c) => c.type === "text")?.text || "");
  } catch {
    return null;
  }
};

// Minimal stroke icon set (lucide-inspired, ISC — see README attribution).
const ICONS = {
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  checklist: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8.5 12 2.5 2.5 5-5.5"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  review: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8.5 11l2 2 3.5-4"/>',
  handoff: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  revert: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  trending: '<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  layers: '<path d="m12 2 9 4.9-9 4.9-9-4.9z"/><path d="m21 11.4-9 4.9-9-4.9"/><path d="m21 16.2-9 4.9-9-4.9"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const state = {
  view: "conductor", // conductor | timeline | architecture | archive | todos
  tracks: [],
  summary: null,
  selected: null,
  detail: null,
  detailTab: "plan", // plan | spec
  openThread: null,
  openDiff: null, // '<track>:<phaseIdx>:<taskIdx>' — only the clicked row opens
  diffs: {},
  timeline: null,
  timelineLoaded: false,
  arch: null,
  changelog: null,
  archived: null,
  connected: false,
  version: null,
  initialized: false, // conductor/ present
};

const app = new App({ name: "Conductor Panel", version: "0.6.0" });
const EMPTY = { parse: (v) => v };

window.addEventListener("error", (e) => {
  try {
    const b = document.getElementById("banner");
    if (b && !b.classList.contains("show")) {
      b.textContent = "Panel error: " + (e.message || "unknown");
      b.classList.add("show");
    }
  } catch { /* nothing else to do */ }
});
window.__czpBooted = false;

// ------------------------------------------------------------ host plumbing

function applyTheme(ctx) {
  const theme = ctx?.theme === "dark" ? "dark" : ctx?.theme === "light" ? "light" : null;
  if (theme) document.documentElement.style.colorScheme = theme;
  const v = ctx?.styles?.variables || {};
  const map = [
    ["--czp-panel-bg", ["--card", "--background"]],
    ["--czp-text", ["--foreground"]],
    ["--czp-muted", ["--muted-foreground"]],
    ["--czp-border", ["--border"]],
    ["--czp-accent", ["--primary"]],
    ["--czp-accent-fg", ["--primary-foreground"]],
  ];
  for (const [local, candidates] of map) {
    for (const c of candidates) {
      if (v[c]) {
        document.documentElement.style.setProperty(local, v[c]);
        break;
      }
    }
  }
}

function readWidgetState(ctx) {
  try {
    const ws = ctx?.["zcode/widgetState"];
    const pc = ws?.privateContent;
    if (!pc) return;
    if (["conductor", "timeline", "architecture", "archive", "todos"].includes(pc.view)) state.view = pc.view;
    if (pc.selected) state.selected = pc.selected;
    if (["plan", "spec", "handoff"].includes(pc.detailTab)) state.detailTab = pc.detailTab;
  } catch {
    /* forward-compat: ignore unexpected shapes */
  }
}

async function saveWidgetState() {
  try {
    if (!app.getHostCapabilities()?.experimental?.["zcode/widgetState"]) return;
    await app.request(
      { method: "ui/set-widget-state", params: { widgetState: { privateContent: {
        view: state.view, selected: state.selected, detailTab: state.detailTab,
      } } } },
      EMPTY,
    );
  } catch {
    /* state persistence is best-effort */
  }
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

async function sendPrompt(prompt) {
  try {
    const res = await app.sendMessage({ role: "user", content: [{ type: "text", text: prompt }] });
    if (res?.isError) throw new Error("rejected");
    toast("Sent to the conversation — ZCode is picking it up.");
  } catch {
    try {
      await navigator.clipboard.writeText(prompt);
      toast("Couldn't reach the chat — prompt copied, paste it in the conversation.");
    } catch {
      toast("Prompt: " + prompt);
    }
  }
}

async function callTool(name, args) {
  // first call through the host may include lazy server spawn + handshake
  const res = await Promise.race([
    app.callServerTool({ name, arguments: args || {} }),
    sleep(30000).then(() => { throw new Error("host timeout (30s)"); }),
  ]);
  const data = parseJson(res.content);
  if (data && data.error) throw new Error(data.error);
  return data;
}

// ---------------------------------------------------------------- data flow

async function loadArch() {
  try {
    state.arch = await callTool("get_architecture_review");
  } catch {
    state.arch = { exists: false, candidates: [] };
  }
}

async function loadArchived() {
  try {
    state.archived = await callTool("list_archived");
  } catch {
    state.archived = { tracks: [] };
  }
}

async function loadChangelog() {
  try {
    state.changelog = await callTool("get_changelog");
  } catch {
    state.changelog = { exists: false, entries: [] };
  }
}

async function loadVersion() {
  try {
    state.version = await callTool("get_version");
  } catch {
    state.version = null;
  }
}

async function refreshTracks() {
  const data = await callTool("list_tracks");
  state.tracks = data.tracks;
  state.summary = data.summary;
  state.initialized = true;
  await loadArch();
  await loadChangelog();
  await loadArchived();
  if (!state.selected || !data.tracks.some((t) => t.id === state.selected)) {
    state.selected =
      (data.tracks.find((t) => t.status === "active") || data.tracks.find((t) => t.status === "planned") || data.tracks[0] || {}).id || null;
    await loadDetail();
  }
  renderAll();
}

async function loadDetail() {
  state.detail = null;
  if (!state.selected) return;
  try {
    state.detail = await callTool("get_track", { trackId: state.selected });
  } catch {
    state.detail = null;
  }
}

async function loadTimeline(force) {
  if (state.timelineLoaded && !force) return;
  state.timelineLoaded = true;
  try {
    state.timeline = await callTool("timeline");
  } catch {
    state.timeline = { lanes: [], gitError: "unavailable" };
  }
}

function refreshSoon(uri) {
  // resource-updated push: refresh only what changed
  if (uri === "conductor://registry") refreshTracks().catch(() => {});
  else if (uri === "conductor://architecture-review") loadArch().then(renderAll).catch(() => {});
  else if (uri === "conductor://changelog") loadChangelog().then(renderAll).catch(() => {});
  else if (state.selected && uri.startsWith(`conductor://tracks/${state.selected}`)) {
    loadDetail().then(renderAll).catch(() => {});
    if (state.view === "timeline") loadTimeline(true).then(renderAll).catch(() => {});
  }
}

// ------------------------------------------------------------------ render

const chip = (status) =>
  status === "done"
    ? '<span class="chip c-done">Done</span>'
    : status === "active"
      ? '<span class="chip c-active">In progress</span>'
      : '<span class="chip c-planned">Planned</span>';

function miniBar(t) {
  const cls = t.status === "done" ? "m-done" : t.status === "active" ? "m-active" : "m-planned";
  const pct = t.total ? Math.round((t.done / t.total) * 100) : 0;
  return `<span class="mini"><span class="${cls}" style="width:${pct}%"></span></span>`;
}

function renderHeader() {
  const v = state.version;
  const chip = $("verchip");
  if (v) {
    chip.hidden = false;
    const mismatch = v.buildVersion && v.buildVersion !== v.pluginVersion;
    chip.textContent = mismatch ? `v${v.pluginVersion} ⚠ server v${v.buildVersion}` : `v${v.pluginVersion}`;
    chip.classList.toggle("warn", !!mismatch);
    chip.title = mismatch
      ? "Installed plugin and running server disagree — the install is stale. Update the plugin."
      : `Conductor plugin v${v.pluginVersion}\n${v.conductorDir || ""}`;
  }
  const s = state.summary;
  const total = s ? s.total : 0;
  const done = s ? s.done : 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $("health").innerHTML = !state.connected
    ? '<span class="dot warn"></span>Not connected to a host'
    : state.initialized
      ? '<span class="dot"></span>Context OK · conductor/ verified'
      : '<span class="dot warn"></span>conductor/ not initialized';
  $("summary").innerHTML = s && total
    ? `<div class="pct">${pct}%</div><div class="sumright"><div class="sumline"><strong>${s.active ? "On track" : "No active track"}</strong> · ${done}/${total} tasks · ${s.tracks} tracks</div><div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div></div>`
    : '<div class="sumline">No tracks yet — plan the first one to get started.</div>';
  $("summary").style.display = state.initialized ? "" : "none";
}

function renderList() {
  $("tracklist").innerHTML = state.tracks
    .map(
      (t) => `<button class="trackrow${t.id === state.selected ? " is-selected" : ""}" type="button" data-track="${esc(t.id)}">
    <span class="status s-${t.status}"></span>
    <span class="trackmain"><span class="trackname">${esc(t.id)}</span>
    <span class="trackmeta">${esc(t.description)}</span>${miniBar(t)}</span>
    <span class="trackside">${chip(t.status)}${t.blocked ? `<span class="chip c-blocked">${t.blocked} blocked</span>` : ""}<span class="trackcount">${t.done}/${t.total}</span>
    ${t.hasHandoff ? '<span class="handofftag">handoff</span>' : ""}</span></button>`,
    )
    .join("") || '<div class="detail muted">No tracks registered yet.</div>';
}

function commentThreads() {
  const map = {};
  for (const th of state.detail?.comments || []) map[th.anchor] = th;
  return map;
}

function threadHtml(key, th) {
  const entries = th.entries
    .map(
      (c) =>
        `<div class="cmt"><div class="cmt-head"><span class="cmt-author">${esc(c.author)}</span><span class="cmt-when">${esc(c.when)}</span></div><div class="cmt-text">${esc(c.text)}</div></div>`,
    )
    .join("");
  const footer = th.state === "resolved"
    ? '<div class="cmt-head"><span class="cmt-when">Resolved · archived in comments.md</span></div>'
    : `<div class="cmtrow"><input type="text" data-reply-input="${key}" placeholder="Reply — @conductor to address the agent" aria-label="Reply">
       <button class="cmtbtn" type="button" data-reply="${key}">Reply</button>
       ${th.entries.length ? `<button class="cmtbtn" type="button" data-resolve="${key}">Resolve</button>` : ""}</div>`;
  return `<li class="thread${th.state === "resolved" ? " is-resolved" : ""}">${entries}${footer}</li>`;
}

function diffHtml(d) {
  const body = esc(d.diff)
    .split("\n")
    .map((l) => {
      if (l.startsWith("+")) return `<span class="d-add">${l}</span>`;
      if (l.startsWith("-")) return `<span class="d-del">${l}</span>`;
      if (l.startsWith("@@")) return `<span class="d-hunk">${l}</span>`;
      return l;
    })
    .join("\n");
  return `<div class="diffbox"><div class="diffmsg">${esc(d.message)}</div><pre class="diff">${body}</pre>` +
    (d.truncated ? '<div class="diffcut muted">diff truncated — view the full commit in git</div>' : "") +
    "</div>";
}

function diffRowHtml(task) {
  const d = state.diffs[task.sha];
  let inner;
  if (!d) {
    inner = '<span class="spin"></span> <span class="muted">loading diff…</span>';
  } else if (d.error) {
    inner = `<span class="muted">diff unavailable: ${esc(d.error)}</span>`;
  } else {
    inner = diffHtml(d);
  }
  return `<li class="diffrow">${inner}</li>`;
}

function planTree(detail) {
  const threads = commentThreads();
  return detail.plan
    .map((p, pi) => {
      const tasks = p.tasks
        .map((task, ti) => {
          const key = `${detail.id}:${pi}:${ti}`;
          const diffKey = `plan:${key}`;
          const th = threads[key];
          let bubble;
          if (th && th.state === "resolved")
            bubble = `<button class="cbubble has resolved" type="button" data-thread="${key}" title="Resolved thread — comments.md">✓</button>`;
          else if (th)
            bubble = `<button class="cbubble has" type="button" data-thread="${key}" title="${th.entries.length} comment(s) — comments.md">${th.entries.length}</button>`;
          else bubble = `<button class="cbubble" type="button" data-thread="${key}" title="Add comment — comments.md">+</button>`;
          const meta = task.sha
            ? `<button class="sha" type="button" data-sha="${task.sha}" data-diff-key="${diffKey}" title="Show diff for ${task.sha.slice(0, 7)}">${task.sha.slice(0, 7)}</button>`
            : "";
          const now = task.state === "active" && !task.subtask ? '<span class="nowchip">now</span>'
            : task.state === "blocked" ? '<span class="blockedchip">blocked</span>' : "";
          const openHere = state.openThread === key;
          const thread = openHere && th
            ? threadHtml(key, th)
            : openHere
              ? threadHtml(key, { state: "open", entries: [] })
              : "";
          const diffRow = state.openDiff === diffKey ? diffRowHtml(task) : "";
          return `<li class="task t-${task.state}${task.subtask ? " sub" : ""}"><span class="cb"></span><span class="tasklabel">${esc(task.label)}</span>${meta}${now}${bubble}</li>${thread}${diffRow}`;
        })
        .join("");
      return `<div class="phase"><div class="phase-head"><span class="phase-name">${esc(p.name)}</span><span class="phase-count">${p.done}/${p.tasks.length}</span></div><ul class="tasks">${tasks}</ul></div>`;
    })
    .join("");
}

// Safe minimal markdown → HTML: everything is escaped first, then a fixed
// set of inline/structure patterns is applied to the escaped text.
function mdToHtml(md) {
  const lines = esc(md).split("\n");
  const out = [];
  let inCode = false;
  let list = null;
  const closeList = () => {
    if (list) { out.push(`</${list}>`); list = null; }
  };
  const inline = (s) =>
    s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  for (const raw of lines) {
    if (/^```/.test(raw)) {
      closeList();
      out.push(inCode ? "</pre>" : "<pre>");
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(raw); continue; }
    const h = raw.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h4>${inline(h[2])}</h4>`); continue; }
    const li = raw.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    closeList();
    if (raw.trim() === "") continue;
    out.push(`<p>${inline(raw)}</p>`);
  }
  closeList();
  if (inCode) out.push("</pre>");
  return out.join("");
}

function renderDetail() {
  const el = $("detail");
  const d = state.detail;
  if (!state.selected) { el.innerHTML = ""; return; }
  if (!d) { el.innerHTML = '<div class="detail muted">Could not load this track.</div>'; return; }
  const open = Object.values(commentThreads()).filter((t) => t.state === "open").length;
  const tabs = `<div class="dtabs" role="tablist" aria-label="Track files">
    <button class="dtab" role="tab" type="button" data-dtab="plan" aria-selected="${state.detailTab === "plan"}">plan.md${open ? `<span class="dtabn">${open}</span>` : ""}</button>
    <button class="dtab" role="tab" type="button" data-dtab="spec" aria-selected="${state.detailTab === "spec"}">spec.md</button>
    ${d.handoff ? `<button class="dtab" role="tab" type="button" data-dtab="handoff" aria-selected="${state.detailTab === "handoff"}">handoff.md</button>` : ""}</div>`;
  const banner = d.handoff
    ? `<div class="handoff"><div class="handoff-body"><div class="handoff-head">Session handoff · ${esc(d.handoff.written || "")}</div>
       <div class="handoff-resume">Resume: ${esc(d.handoff.resumeTask || "see handoff.md")}</div></div>
       <button class="resume-btn" type="button" data-action="implement_next">Resume</button></div>`
    : "";
  let body;
  if (state.detailTab === "spec") {
    body = d.spec
      ? `<div class="spechead"><code>conductor/tracks/${esc(d.id)}/spec.md</code></div><div class="spec">${mdToHtml(d.spec.text)}</div>`
      : '<div class="muted">No spec.md in this track folder.</div>';
  } else if (state.detailTab === "handoff") {
    body = d.handoff?.text
      ? `<div class="spechead"><code>conductor/tracks/${esc(d.id)}/handoff.md</code></div><div class="spec">${mdToHtml(d.handoff.text)}</div>`
      : '<div class="muted">No handoff.md in this track folder.</div>';
  } else if (d.plan.length) {
    body = planTree(d);
  } else {
    body = '<div class="muted">No tasks parsed from plan.md yet.</div>';
  }
  el.innerHTML = `<div class="detail"><div class="detail-title">${esc(d.description)}</div>
    <div class="detail-spec">${esc(d.id)} · ${d.plan.length} phases</div>${banner}${tabs}${body}</div>`;
  const tasks = (d.plan.flatMap((p) => p.tasks) || []).filter((t) => !t.subtask);
  const remaining = tasks.filter((t) => t.state !== "done").length;
  $("primaryLabel").textContent = d.status === "done" ? "Track complete" : remaining ? "Implement next task" : "Finalize track";
  $("primaryBtn").disabled = d.status === "done";
  $("btnReview").disabled = $("btnHandoff").disabled = $("btnRevert").disabled = d.status === "planned" && !tasks.length;
  $("btnArchive").disabled = d.status !== "done";
  $("tabTodosCount").textContent = String(remaining);
  $("tabTodosCount").style.display = remaining ? "" : "none";
}

function renderTodos() {
  const active = state.tracks.find((t) => t.id === state.selected) ||
    state.tracks.find((t) => t.status === "active");
  const d = active && state.detail && state.detail.id === active.id ? state.detail : null;
  $("todos").innerHTML = !active
    ? '<div class="todosview muted">No track selected.</div>'
    : `<div class="todosview"><div class="todoshead">Session todo mirror · <strong>${esc(active.id)}</strong></div>
       <div class="todomirror">${d
         ? d.plan
             .map((p, pi) =>
               p.tasks
                 .filter((t) => !t.subtask)
                 .map((t) => {
                   const short = `P${pi + 1}`;
                   return `<div class="task t-${t.state}"><span class="cb"></span><span class="tasklabel">${esc(short + " · " + t.label)}</span></div>`;
                 })
                 .join(""),
             )
             .join("")
         : '<div class="task"><span class="tasklabel muted">Loading plan…</span></div>'}</div>
       <div class="todonote"><code>plan.md</code> is the source of truth — this mirror follows the TodoWrite mapping.</div></div>`;
}

function dayFloor(iso) { const d = new Date(iso); d.setHours(0, 0, 0, 0); return d; }

function renderTimeline() {
  const el = $("timeline");
  const t = state.timeline;
  if (!t || !t.lanes?.length) {
    el.innerHTML = '<div class="tl-empty">No tracks registered yet.</div>';
    return;
  }
  const hasData = (l) => (l.points?.length || 0) > 0 || l.span || l.handoff;
  const dated = t.lanes.flatMap((l) => [
    ...(l.span ? [l.span.firstIso, l.span.lastIso] : []),
    ...l.points.map((p) => p.iso),
    ...(l.handoff ? [l.handoff] : []),
  ]);
  if (!dated.length) {
    el.innerHTML = '<div class="tl-empty">No git history found for these tracks — the timeline needs the project to be a git repository with commits in the track folders.</div>';
    return;
  }
  dated.push(t.todayIso);
  const times = dated.map((x) => dayFloor(x).getTime());
  const min = Math.min(...times);
  const max = Math.max(...times);
  const days = Math.max(1, Math.round((max - min) / 86400000));
  const pct = (iso) => (((dayFloor(iso).getTime() - min) / (days * 86400000)) * 100).toFixed(3);
  const spanPct = (a, b) => ({
    left: (((dayFloor(a).getTime() - min) / (days * 86400000)) * 100).toFixed(3),
    width: Math.max((((dayFloor(b).getTime() - dayFloor(a).getTime()) / (days * 86400000)) * 100), 0.5).toFixed(3),
  });
  const ticks = [];
  const step = Math.max(1, Math.ceil(days / 5));
  for (let d = 0; d <= days; d += step) ticks.push(d);
  if (ticks[ticks.length - 1] !== days) ticks.push(days);
  const head = ticks
    .map((d, i) => {
      const dt = new Date(min + d * 86400000);
      const label = dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const cls = i === 0 ? " d-first" : i === ticks.length - 1 ? " d-last" : "";
      return `<span class="tl-day${cls}" style="left:${((d / days) * 100).toFixed(3)}%">${label}</span>`;
    })
    .join("");
  const lanes = t.lanes
    .map((l) => {
      let bar = "";
      if (l.span) {
        const { left, width } = spanPct(l.span.firstIso, l.span.lastIso);
        const cls = l.status === "done" ? "done" : l.status === "active" ? "active" : "planned";
        bar = `<div class="tl-span ${cls}" style="left:${left}%;width:${width}%" title="${esc(l.id)} · ${l.span.commits} commits · ${esc(l.span.firstIso.slice(0, 10))} → ${esc(l.span.lastIso.slice(0, 10))}"></div>`;
      } else if (!hasData(l)) {
        bar = '<div class="tl-nocommits">no commits yet</div>';
      }
      const dots = (l.points || [])
        .map((p) => `<div class="tl-commit" style="left:${pct(p.iso)}%" title="${esc(p.label)} · ${esc(p.iso.slice(0, 10))}"></div>`)
        .join("");
      const hand = l.handoff ? `<div class="tl-hand" style="left:${pct(l.handoff)}%" title="Session handoff · ${esc(l.handoff.slice(0, 10))}"></div>` : "";
      return `<div class="tl-row"><div class="tl-label" title="${esc(l.description || l.id)}${l.archived ? " · archived" : ""}">${esc(l.id)}${l.archived ? ' <span class="muted">·arch</span>' : ""}</div><div class="tl-track">${bar}${dots}${hand}</div></div>`;
    })
    .join("");
  const commits = t.lanes.reduce((a, l) => a + (l.points?.length || 0), 0);
  const spanDays = Math.max(1, Math.round((dayFloor(t.todayIso) - min) / 86400000));
  // unified chronological feed: starts, completions, handoffs, shipped summaries
  const shippedById = new Map();
  for (const e of state.changelog?.entries || []) shippedById.set(e.trackId, e);
  const events = [];
  for (const l of t.lanes) {
    if (l.span) {
      events.push({ date: l.span.firstIso, type: "started", id: l.id, title: l.description || "" });
      if (l.status === "done" && !shippedById.has(l.id))
        events.push({ date: l.span.lastIso, type: "completed", id: l.id, title: l.description || "" });
    }
    if (l.handoff) events.push({ date: l.handoff, type: "handoff", id: l.id, title: "Session handoff written" });
  }
  for (const e of shippedById.values())
    events.push({ date: e.date, type: "shipped", id: e.trackId, title: e.title + (e.shipped ? " — " + e.shipped : "") });
  events.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const evtIcon = { started: '<span class="evt-dot started"></span>', completed: '<span class="evt-dot completed"></span>',
    handoff: '<span class="lg-swatch lg-hand"></span>', shipped: '<span class="evt-dot shipped"></span>' };
  let shipped = "";
  const shown = events.filter((e) => e.date).slice(0, 14);
  if (shown.length) {
    shipped =
      `<div class="shipped"><div class="shipped-head">History</div>` +
      shown
        .map(
          (e) =>
            `<div class="shipped-item">${evtIcon[e.type] || ""}<span class="shipped-date">${esc(e.date.slice(0, 10))}</span><span class="shipped-id">${esc(e.id)}</span>` +
            `<span class="shipped-title">${esc(e.title)}${e.type === "started" ? ' <span class="muted">started</span>' : e.type === "handoff" ? "" : e.type === "completed" ? ' <span class="muted">completed</span>' : ""}</span></div>`,
        )
        .join("") +
      `</div>`;
  }
  el.innerHTML =
    `<div class="tl"><div class="tl-row tl-headrow"><div class="tl-label"></div><div class="tl-track">${head}</div></div>${lanes}
     <div class="tl-today" style="left:calc(var(--tl-label-w) + (100% - var(--tl-label-w)) * ${pct(t.todayIso)})" title="Today"></div></div>
     <div class="tl-note">${commits} committed task dot${commits === 1 ? "" : "s"} · track bars span first→last commit touching each track folder (git history) · ~${spanDays} day${spanDays === 1 ? "" : "s"} shown.</div>${shipped}`;
}

function renderArch() {
  const el = $("architecture");
  const a = state.arch;
  const open = a?.candidates?.filter((c) => c.state === "open").length || 0;
  const badge = $("tabArchCount");
  badge.textContent = String(open);
  badge.hidden = !open;
  if (!a || !a.exists || !a.candidates.length) {
    el.innerHTML =
      '<div class="archhead">No architecture review yet — run <code>/conductor:architecture</code> to scan for deepening opportunities. Findings from track reviews land here too.</div>';
    return;
  }
  const strengthChip = (s) => {
    if (!s) return "";
    const cls = /strong/i.test(s) ? "s-strong" : /explor/i.test(s) ? "s-worth" : "s-spec";
    return `<span class="chip ${cls}">${esc(s)}</span>`;
  };
  el.innerHTML =
    a.candidates
      .map((c) => {
        const dispo = c.state === "open" ? "" : `<div class="cand-dispo">${esc(c.disposition)}</div>`;
        const actions =
          c.state === "open"
            ? `<div class="cand-actions"><button class="cand-btn" type="button" data-plan="${esc(c.id)}">Plan as track</button><button class="cand-btn" type="button" data-dismiss="${esc(c.id)}">Dismiss</button></div>`
            : "";
        return `<div class="cand"><div class="cand-head"><span class="cand-id">${esc(c.id)}</span><span class="cand-title">${esc(c.title)}</span>${strengthChip(c.strength)}</div>
      ${c.files ? `<div class="cand-files">${esc(c.files)}</div>` : ""}
      ${c.problem ? `<div class="cand-line"><b>Problem</b> · ${esc(c.problem)}</div>` : ""}
      ${c.solution ? `<div class="cand-line"><b>Solution</b> · ${esc(c.solution)}</div>` : ""}
      ${c.source ? `<div class="cand-line muted">${esc(c.source)}</div>` : ""}${dispo}${actions}</div>`;
      })
      .join("") || "";
}

function renderArchive() {
  const el = $("archive");
  const rows = state.archived?.tracks || [];
  if (!rows.length) {
    el.innerHTML = '<div class="archhead">No archived tracks. Archiving moves finished tracks from conductor/tracks/ to conductor/archive/ (review cleanup, or the Archive action on a completed track).</div>';
    return;
  }
  el.innerHTML = rows
    .map(
      (a) => `<button class="trackrow" type="button" data-archived="${esc(a.id)}">
    <span class="status s-done"></span>
    <span class="trackmain"><span class="trackname">${esc(a.id)}</span>
    <span class="trackmeta">${esc(a.description)}</span>${miniBar(a)}</span>
    <span class="trackside"><span class="chip c-done">Done</span><span class="trackcount">${a.done}/${a.total}</span>
    ${a.lastIso ? `<span class="trackcount">${esc(a.lastIso.slice(0, 10))}</span>` : ""}</span></button>`,
    )
    .join("");
}

function renderAll() {
  renderHeader();
  renderList();
  renderDetail();
  renderArch();
  renderArchive();
  renderTodos();
  if (state.view === "timeline") loadTimeline().then(renderTimeline).catch(() => {});
  else renderTimeline();
  for (const v of ["conductor", "timeline", "architecture", "archive", "todos"]) {
    $(`view-${v}`).hidden = v !== state.view;
    $(`tab-${v}`).setAttribute("aria-selected", String(v === state.view));
  }
  saveWidgetState();
}

// ------------------------------------------------------------------- events

document.body.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-track],[data-tab],[data-dtab],[data-thread],[data-reply],[data-resolve],[data-action],[data-plan],[data-dismiss],[data-sha],[data-archived]");
  if (!el) return;
  try {
    if (el.hasAttribute("data-plan") || el.hasAttribute("data-dismiss")) {
      const isPlan = el.hasAttribute("data-plan");
      const data = await callTool("request_action", {
        action: isPlan ? "architecture_plan" : "architecture_dismiss",
        candidateId: el.getAttribute(isPlan ? "data-plan" : "data-dismiss"),
      });
      await sendPrompt(data.prompt);
      return;
    }
    if (el.dataset.tab) {
      state.view = el.dataset.tab;
      renderAll();
    } else if (el.dataset.track) {
      state.selected = el.dataset.track;
      state.openThread = null;
      state.openDiff = null;
      renderAll();
      await loadDetail();
      subscribeTrack(state.selected);
      renderAll();
    } else if (el.dataset.dtab) {
      state.detailTab = el.dataset.dtab;
      renderAll();
    } else if (el.hasAttribute("data-archived")) {
      state.selected = el.getAttribute("data-archived");
      state.openThread = null;
      state.openDiff = null;
      state.view = "conductor";
      renderAll();
      await loadDetail();
      renderAll();
      return;
    } else if (el.hasAttribute("data-sha")) {
      const sha = el.getAttribute("data-sha");
      const diffKey = el.getAttribute("data-diff-key");
      state.openDiff = state.openDiff === diffKey ? null : diffKey;
      renderDetail();
      if (state.openDiff === diffKey && !state.diffs[sha]) {
        try {
          state.diffs[sha] = await callTool("get_task_diff", { trackId: state.selected, sha });
        } catch (err) {
          state.diffs[sha] = { error: err.message };
        }
        renderDetail();
      }
      return;
    } else if (el.hasAttribute("data-thread")) {
      const key = el.getAttribute("data-thread");
      state.openThread = state.openThread === key ? null : key;
      renderAll();
    } else if (el.hasAttribute("data-reply")) {
      const key = el.getAttribute("data-reply");
      const input = document.querySelector(`[data-reply-input="${key}"]`);
      const text = input?.value.trim();
      if (!text) return;
      await callTool("add_comment", { trackId: state.selected, anchor: key.split(":").slice(1).join(":"), text });
      state.openThread = key;
      await loadDetail();
      renderAll();
      document.querySelector(`[data-reply-input="${key}"]`)?.focus();
    } else if (el.hasAttribute("data-resolve")) {
      await callTool("resolve_comment", { trackId: state.selected, anchor: el.getAttribute("data-resolve") });
      state.openThread = null;
      await loadDetail();
      renderAll();
    } else if (el.dataset.action && el.dataset.action !== "new_track") {
      const data = await callTool("request_action", { action: el.dataset.action, trackId: state.selected });
      await sendPrompt(data.prompt);
    }
  } catch (err) {
    toast("Action failed: " + err.message);
  }
});

document.body.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !e.target.matches("[data-reply-input]")) return;
  e.preventDefault();
  document.querySelector(`[data-reply="${e.target.getAttribute("data-reply-input")}"]`)?.click();
});

$("newtrack").addEventListener("click", () => {
  const d = $("newdraft");
  d.hidden = !d.hidden;
  if (!d.hidden) $("draft-idea").focus();
});
$("draft-close").addEventListener("click", () => { $("newdraft").hidden = true; });
$("draft-types").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-type]");
  if (!chip) return;
  for (const c of $("draft-types").querySelectorAll("[data-type]")) c.classList.toggle("is-on", c === chip);
});
$("draft-go").addEventListener("click", async () => {
  const idea = $("draft-idea").value.trim();
  try {
    const data = await callTool("request_action", { action: "new_track", idea });
    $("newdraft").hidden = true;
    $("draft-idea").value = "";
    await sendPrompt(data.prompt);
  } catch (err) {
    toast("Failed: " + err.message);
  }
});
$("primaryBtn").addEventListener("click", async () => {
  try {
    const data = await callTool("request_action", { action: "implement_next", trackId: state.selected });
    await sendPrompt(data.prompt);
  } catch (err) {
    toast("Failed: " + err.message);
  }
});
for (const [id, action] of [["btnReview", "review"], ["btnHandoff", "handoff"], ["btnRevert", "revert"], ["btnArchive", "archive_track"]]) {
  $(id).addEventListener("click", async () => {
    try {
      const data = await callTool("request_action", { action, trackId: state.selected });
      await sendPrompt(data.prompt);
    } catch (err) {
      toast("Failed: " + err.message);
    }
  });
}
$("btnArchive").insertAdjacentHTML("afterbegin", icon("archive"));
async function runSetup() {
  try {
    const data = await callTool("request_action", { action: "setup" });
    await sendPrompt(data.prompt);
  } catch (err) {
    toast("Failed: " + err.message);
  }
}
$("refreshBtn").addEventListener("click", async () => {
  state.timelineLoaded = false;
  await refreshTracks().catch((err) => toast("Refresh failed: " + err.message));
  await loadDetail();
  renderAll();
});

for (const id of ["tab-conductor", "tab-timeline", "tab-architecture", "tab-archive", "tab-todos"]) {
  $(id).insertAdjacentHTML("afterbegin", icon({ "tab-conductor": "target", "tab-timeline": "calendar", "tab-architecture": "layers", "tab-archive": "archive", "tab-todos": "checklist" }[id]));
}
$("newtrack").insertAdjacentHTML("afterbegin", icon("plus"));
$("draft-close").insertAdjacentHTML("afterbegin", icon("x"));
$("draft-go").insertAdjacentHTML("afterbegin", icon("play"));
$("primaryBtn").insertAdjacentHTML("afterbegin", icon("play"));
$("btnReview").insertAdjacentHTML("afterbegin", icon("review"));
$("btnHandoff").insertAdjacentHTML("afterbegin", icon("handoff"));
$("btnRevert").insertAdjacentHTML("afterbegin", icon("revert"));
$("refreshBtn").insertAdjacentHTML("afterbegin", icon("refresh"));
$("velIcon").innerHTML = icon("trending");

// Subscribe to the selected track's data resources so plan ticks appear live.
const subscribed = new Set();
async function subscribeTrack(trackId) {
  if (!trackId || !app.getHostCapabilities()?.experimental?.["zcode/resourceSubscribe"]) return;
  for (const f of ["plan.md", "spec.md", "handoff.md", "comments.md"]) {
    const uri = `conductor://tracks/${trackId}/${f}`;
    if (subscribed.has(uri)) continue;
    subscribed.add(uri);
    try {
      await app.request({ method: "resources/subscribe", params: { uri } }, EMPTY);
    } catch {
      subscribed.delete(uri);
    }
  }
}

// --------------------------------------------------------------------- boot

async function boot() {
  window.__czpBooted = true;
  app.onhostcontextchanged = (ctx) => applyTheme(ctx);
  app.ontoolresult = (result) => {
    const data = parseJson(result.content);
    if (!data || typeof data !== "object") return;
    if (Array.isArray(data.tracks)) {
      state.tracks = data.tracks;
      state.summary = data.summary;
      state.initialized = true;
      renderAll();
    } else if (data.plan && data.id && data.id === state.selected) {
      state.detail = data;
      renderAll();
    }
  };
  try {
    await Promise.race([
      app.connect(),
      sleep(4000).then(() => { throw new Error("connect-timeout"); }),
    ]);
  } catch {
    $("banner").textContent = "This is the Conductor panel surface. Open it from the ZCode right dock to see live track state.";
    $("banner").classList.add("show");
    renderAll();
    return;
  }
  state.connected = true;
  const ctx = app.getHostContext();
  applyTheme(ctx);
  readWidgetState(ctx);
  loadVersion().then(renderHeader).catch(() => {});
  renderAll();
  try {
    await refreshTracks();
  } catch (err) {
    if (String(err.message).includes("not_initialized")) {
      state.initialized = false;
      const b = document.createElement("button");
      b.textContent = "Run /conductor:setup";
      b.addEventListener("click", () => runSetup());
      $("banner").append("Conductor is not initialized in this project — ", b);
      $("banner").classList.add("show");
    } else {
      // the server may still be warming up — retry once before giving up
      await sleep(1500);
      try {
        await refreshTracks();
      } catch (err2) {
        state.initialized = false;
        const b = document.createElement("button");
        b.textContent = "Retry";
        b.addEventListener("click", () => $("refreshBtn").click());
        $("banner").append(
          "Could not read conductor state (" + err2.message + "). The MCP server may still be starting — ", b);
        $("banner").classList.add("show");
      }
    }
  }
  const caps = app.getHostCapabilities();
  if (caps?.experimental?.["zcode/resourceSubscribe"]) {
    try {
      await app.request({ method: "resources/subscribe", params: { uri: "conductor://registry" } }, EMPTY);
      app.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => refreshSoon(n.params.uri));
    } catch {
      /* fall back to manual refresh */
    }
  }
  if (state.selected) subscribeTrack(state.selected);
  renderAll();
}

boot();
