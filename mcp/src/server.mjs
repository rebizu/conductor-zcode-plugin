#!/usr/bin/env node
// Conductor MCP server — exposes the project's conductor/ state as tools and
// resources, serves the panel UI, and pushes resource updates on file changes.
// Runs with cwd = the workspace project (see plugin.json mcpServers.cwd).
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PANEL_URI = "ui://conductor/panel.html";
const CONDUCTOR_DIR = path.join(process.cwd(), "conductor");
const TRACKS_DIR = path.join(CONDUCTOR_DIR, "tracks");

// ---------------------------------------------------------------- utilities

const readText = (p) => {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
};

// CRLF files would otherwise break `$`-anchored regexes (`.` never matches \r)
const normalizeMd = (s) => (s == null ? null : s.replace(/\r\n?/g, "\n"));

const jsonText = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});
const jsonError = (message) => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify({ error: message }) }],
});

const statusOf = (marker) =>
  marker.toLowerCase() === "x" ? "done" : marker === "~" ? "active" : "planned";

const fmtWhen = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;

const execFileP = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { cwd: process.cwd(), maxBuffer: 4 * 1024 * 1024 }, (err, stdout) =>
      resolve({ err, stdout }),
    );
  });

// ----------------------------------------------------------------- parsing

// Registry dialects seen in the wild:
//  A) `--- - [x] **Track: Desc** *Link: [label](./tracks/<id>/index.md)*`  (canonical upstream)
//  B) `- [x] **Track: Desc**` with `  *Link: [label](./archive/<id>/)*` on a following line
//  C) markdown table rows: `| [Desc](./tracks/<id>/index.md) | comp | in-progress | … |`
//  D) legacy `## [x] Track: Desc`
const STATUS_WORD = (w) => {
  w = w.toLowerCase();
  if (/(complete|done|shipped|finished|merged)/.test(w)) return "done";
  if (/(progress|active|wip|current|started)/.test(w)) return "active";
  return "planned";
};

function resolveTrackDir(linkPath) {
  // link may point at a file (…/index.md) or a directory (…/archive/slug/)
  let p = path.normalize(path.join(CONDUCTOR_DIR, decodeURIComponent(linkPath.replace(/^\.\//, "")).replace(/[?].*$/, "")));
  if (path.extname(p)) p = path.dirname(p);
  return p;
}

function readTracksRegistry() {
  const raw = readText(path.join(CONDUCTOR_DIR, "tracks.md"));
  if (raw == null) return { exists: false, tracks: [] };
  const lines = normalizeMd(raw).split("\n");
  const tracks = [];
  const push = (status, description, linkPath, legacy, precomputed = null) => {
    let dir = precomputed?.dir ?? null;
    let id = precomputed?.id ?? null;
    if (!dir && linkPath) {
      dir = resolveTrackDir(linkPath);
      if (!fs.existsSync(dir)) dir = null;
    }
    if (!id && dir) id = path.basename(dir);
    tracks.push({ id, description, status, legacy, linkPath: linkPath || null, dir });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // A/B: checkbox + **Track: …**, link on the same or a following line
    let m = line.match(/\[([ xX~])\]\s+\*\*Track:\s*(.+?)\*\*(.*)$/);
    if (m) {
      let link = m[3] ? m[3].match(/\]\(([^)]+)\)/) : null;
      if (!link) {
        for (let j = 1; j <= 2 && i + j < lines.length && !link; j++) {
          link = lines[i + j].match(/\*Link:\s*\[[^\]]*\]\(([^)]+)\)/) || null;
        }
      }
      push(statusOf(m[1]), m[2].trim(), link ? link[1] : null, false);
      continue;
    }
    // C: table row with a linked title and a status word cell
    let t = line.match(/^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|(.+)\|$/);
    if (t) {
      const sw = t[3].match(/\b(complete|done|shipped|in-progress|in progress|active|wip|pending|planned)\b/i);
      if (sw) {
        push(STATUS_WORD(sw[1]), t[1].trim(), t[2], false);
        continue;
      }
    }
    // E: table row with a bare ID column: `| track-001 | Title | done | … |`
    let e = line.match(/^\|\s*([A-Za-z][\w-]*)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (e && !/^(id|status|state)$/i.test(e[1]) && !/^(status|state)$/i.test(e[3])) {
      const dir = path.join(TRACKS_DIR, e[1]);
      if (fs.existsSync(dir)) {
        push(STATUS_WORD(e[3]), e[2].trim(), null, false, { id: e[1], dir });
        continue;
      }
    }
    // D: legacy heading
    let l = line.match(/^##\s+\[([ xX~])\]\s+Track:\s*(.+?)\s*$/);
    if (l) push(statusOf(l[1]), l[2], null, true);
  }
  return { exists: true, raw, tracks };
}

function parsePlan(md) {
  md = normalizeMd(md);
  const phases = [];
  let current = null;
  for (const line of md.split("\n")) {
    const h = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (h && h[1].length <= 3) {
      current = { name: h[2], tasks: [] };
      phases.push(current);
      continue;
    }
    const t = line.match(/^(\s*)[-*]\s+\[([ xX~])\]\s+(.+?)\s*$/);
    if (t && current) {
      const label = t[3].replace(/^Task:\s*/i, "");
      const sha = (t[3].match(/`([0-9a-f]{7,40})`/) || [])[1] || null;
      current.tasks.push({
        state: statusOf(t[2]),
        label,
        sha,
        subtask: !/^Task:/i.test(t[3].trim()) && t[1].length >= 2,
      });
    }
  }
  return phases
    .filter((p) => p.tasks.length > 0)
    .map((p) => ({
      name: p.name,
      tasks: p.tasks,
      done: p.tasks.filter((t) => t.state === "done").length,
    }));
}

function parseHandoff(md, stat) {
  md = normalizeMd(md);
  if (md == null) return null;
  const written = (md.match(/_?Written\s+(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})/) || [])[1] || null;
  let resume = (md.match(/## Resume pointer[\s\S]*?\*\*Task:\*\*[ \t]*(.+)/i) || [])[1] || null;
  if (resume) {
    resume = resume
      .trim()
      .replace(/\s*\([`'"]?\[[ xX~]\][`'"]?\)\s*$/, "")
      .replace(/^["“]/, "")
      .replace(/["”]\.?$/, "")
      .trim();
  }
  return {
    written,
    resumeTask: resume,
    modifiedIso: stat ? stat.mtime.toISOString() : null,
  };
}

// comments.md sidecar — git-tracked, human-editable, anchored per task index.
// Format:
//   ## [open|resolved] <phaseIdx>:<taskIdx> — <label>
//   - **YYYY-MM-DD HH:MM · Author** — text (continuation lines indented 2 spaces)
function parseComments(md) {
  md = normalizeMd(md);
  if (md == null) return [];
  const threads = [];
  // split with captures yields [pre, state, anchor, label, body, state, ...]
  const parts = md.split(/^##\s+\[(open|resolved)\]\s+(\S+)\s+—\s+(.*)$/m);
  for (let i = 1; i + 3 <= parts.length; i += 4) {
    const state = parts[i];
    const anchor = parts[i + 1];
    const label = parts[i + 2];
    const body = parts[i + 3] || "";
    const entries = [];
    for (const m of body.matchAll(/^- \*\*(.+?)\s+·\s+(.+?)\*\*\s+—\s+([\s\S]*?)(?=\n- \*\*|\n## |\s*$)/gm)) {
      entries.push({ when: m[1].trim(), author: m[2].trim(), text: m[3].trim() });
    }
    threads.push({ anchor, label: label.trim(), state, entries });
  }
  return threads;
}

function serializeComments(trackId, threads) {
  const lines = [`# Comments — ${trackId}`, "", "<!-- conductor-comments:v1 -->", ""];
  for (const t of threads) {
    lines.push(`## [${t.state}] ${t.anchor} — ${t.label}`, "");
    for (const e of t.entries) lines.push(`- **${e.when} · ${e.author}** — ${e.text}`, "");
    if (t.entries.length === 0) lines.push("");
  }
  return lines.join("\n");
}

function trackFilePaths(trackId) {
  return ["plan.md", "spec.md", "handoff.md", "comments.md", "index.md", "metadata.json"].map(
    (f) => `conductor://tracks/${trackId}/${f}`,
  );
}

function readTrackSummary(t) {
  const dir = t.dir;
  const plan = parsePlan(readText(path.join(dir, "plan.md")) || "");
  const tasks = plan.flatMap((p) => p.tasks).filter((x) => !x.subtask);
  const handoffStat = fs.statSync(path.join(dir, "handoff.md"), { throwIfNoEntry: false });
  const handoff = parseHandoff(readText(path.join(dir, "handoff.md")), handoffStat);
  const metadata = readText(path.join(dir, "metadata.json"));
  let meta = null;
  try {
    meta = metadata ? JSON.parse(metadata) : null;
  } catch {
    /* best-effort */
  }
  return {
    id: t.id,
    description: t.description,
    status: t.status,
    dir: path.relative(process.cwd(), dir),
    phases: plan.length,
    done: tasks.filter((x) => x.state === "done").length,
    total: tasks.length,
    hasHandoff: !!handoff,
    handoffWritten: handoff?.written || null,
    meta,
  };
}

function resolveTrack(trackId) {
  const { tracks } = readTracksRegistry();
  const t = tracks.find((x) => x.id === trackId) || null;
  if (!t) {
    // archived tracks are out of the registry but still readable
    const dir = path.join(TRACKS_DIR, "..", "archive", trackId);
    if (trackId && !trackId.includes("..") && fs.existsSync(dir))
      return { track: { id: trackId, description: trackId, status: "done", dir } };
    return { error: `Track '${trackId}' not found in conductor/tracks.md` };
  }
  if (!t.dir || !fs.existsSync(t.dir)) return { error: `Track directory for '${trackId}' is missing` };
  return { track: t };
}

// conductor/archive/<id>/ — moved out of the registry by review cleanup or by
// hand. Archived tracks are shipped history: they appear in the timeline and
// changelog (always "done"), never in the planning list.
function listArchivedTracks() {
  const archiveDir = path.join(CONDUCTOR_DIR, "archive");
  if (!fs.existsSync(archiveDir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(archiveDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(archiveDir, entry.name);
    if (!fs.existsSync(path.join(dir, "plan.md")) && !fs.existsSync(path.join(dir, "metadata.json"))) continue;
    let meta = null;
    try {
      meta = JSON.parse(readText(path.join(dir, "metadata.json")) || "null");
    } catch {
      /* metadata is optional */
    }
    const plan = parsePlan(readText(path.join(dir, "plan.md")) || "");
    const tasks = plan.flatMap((p) => p.tasks).filter((x) => !x.subtask);
    out.push({
      id: entry.name,
      description: meta?.description || meta?.title || entry.name,
      status: "done",
      dir,
      plan,
      done: tasks.filter((x) => x.state === "done").length,
      total: tasks.length,
    });
  }
  return out;
}

// ---------------------------------------------------------------- git dates

async function gitDates(shas) {
  if (shas.length === 0) return {};
  const { err, stdout } = await execFileP("git", [
    "show",
    "-s",
    "--format=%H|%cI",
    ...shas,
  ]);
  const map = {};
  if (!err) {
    for (const line of stdout.trim().split("\n")) {
      const [sha, iso] = line.split("|");
      if (sha && iso) map[sha] = iso;
    }
  }
  // resolve stragglers individually — one unknown SHA (history rewrite,
  // squash, another machine) must not blank out the whole timeline
  for (const sha of shas) {
    if (map[sha]) continue;
    const r = await execFileP("git", ["show", "-s", "--format=%H|%cI", sha]);
    if (!r.err) {
      const [h, iso] = r.stdout.trim().split("|");
      if (iso) map[sha] = iso;
    }
  }
  return map;
}

async function gitTrackSpan(relDir) {
  const { err, stdout } = await execFileP("git", [
    "log",
    "--format=%cI",
    "--",
    relDir,
  ]);
  if (err || !stdout.trim()) return null;
  const dates = stdout.trim().split("\n");
  return { firstIso: dates[dates.length - 1], lastIso: dates[0], commits: dates.length };
}

// architecture-review.md — the deepening backlog shared by the
// conductor-architecture skill, conductor-review and the panel.
// Format:
//   ## [open|planned|dismissed] deep-N — Title
//   - **Strength:** Strong | Worth exploring | Speculative
//   - **Files:** `path`, `path`
//   - **Problem:** one sentence
//   - **Solution:** one sentence
//   - **Source:** scan <date> | review of track <id> (<date>)
//   - **Disposition:** open | planned → <track ref> | dismissed <date> — <reason>
function parseArchitectureReview(md) {
  md = normalizeMd(md);
  if (md == null) return null;
  const candidates = [];
  const parts = md.split(/^##\s+\[(open|planned|dismissed)\]\s+(\S+)\s+—\s+(.*)$/m);
  for (let i = 1; i + 3 <= parts.length; i += 4) {
    const state = parts[i];
    const id = parts[i + 1];
    const title = parts[i + 2].trim();
    const body = parts[i + 3] || "";
    const fields = {};
    for (const m of body.matchAll(/^- \*\*(Strength|Files|Problem|Solution|Source|Disposition):\*\*\s*(.*)$/gm)) {
      fields[m[1].toLowerCase()] = m[2].trim();
    }
    candidates.push({
      id,
      state,
      title,
      strength: fields.strength || null,
      files: fields.files || null,
      problem: fields.problem || null,
      solution: fields.solution || null,
      source: fields.source || null,
      disposition: fields.disposition || state,
    });
  }
  return candidates;
}

function nextCandidateId(md) {
  const candidates = parseArchitectureReview(md) || [];
  let max = 0;
  for (const c of candidates) {
    const m = c.id.match(/^deep-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `deep-${max + 1}`;
}

function serializeCandidate(c) {
  const lines = [`## [${c.state}] ${c.id} — ${c.title}`, ""];
  if (c.strength) lines.push(`- **Strength:** ${c.strength}`);
  if (c.files) lines.push(`- **Files:** ${c.files}`);
  if (c.problem) lines.push(`- **Problem:** ${c.problem}`);
  if (c.solution) lines.push(`- **Solution:** ${c.solution}`);
  if (c.source) lines.push(`- **Source:** ${c.source}`);
  lines.push(`- **Disposition:** ${c.disposition}`, "");
  return lines.join("\n");
}

const ARCH_FILE = "architecture-review.md";
const CHANGELOG_FILE = "changelog.md";

// changelog.md — project-level "what shipped" log, one entry per completed
// track, appended by the implement skill's finalize step.
// Format:
//   ## YYYY-MM-DD — <track_id> — <track description>
//   - Shipped: one or two plain sentences.
function parseChangelog(md) {
  md = normalizeMd(md);
  if (md == null) return [];
  const entries = [];
  const parts = md.split(/^##\s+(\d{4}-\d{2}-\d{2})\s+—\s+(\S+)\s+—\s+(.*)$/m);
  for (let i = 1; i + 3 <= parts.length; i += 4) {
    const date = parts[i];
    const trackId = parts[i + 1];
    const title = parts[i + 2].trim();
    const body = parts[i + 3] || "";
    const shipped = (body.match(/^- Shipped:\s*(.+)$/m) || [])[1] || null;
    entries.push({ date, trackId, title, shipped: shipped ? shipped.trim() : null, synthesized: false });
  }
  return entries;
}

// ------------------------------------------------------------------- server

const server = new McpServer({ name: "conductor", version: "0.6.0" });
const UI_META = { ui: { resourceUri: PANEL_URI } };
const APP_ONLY = { ui: { resourceUri: PANEL_URI, visibility: ["app"] } };

if (!fs.existsSync(CONDUCTOR_DIR)) {
  console.error(`[conductor-mcp] No conductor/ directory under ${process.cwd()} — tools will report not_initialized.`);
}

registerAppTool(
  server,
  "list_tracks",
  {
    title: "List Conductor tracks",
    description:
      "Parse conductor/tracks.md and every track's plan.md. Returns track ids, statuses, progress counts and handoff presence. Prefer reading the files directly when you need full content.",
    inputSchema: {},
    _meta: UI_META,
  },
  async () => {
    if (!fs.existsSync(CONDUCTOR_DIR)) return jsonError("not_initialized");
    const reg = readTracksRegistry();
    const tracks = reg.tracks
      .filter((t) => t.id)
      .map(readTrackSummary)
      .filter((s) => fs.existsSync(path.join(process.cwd(), s.dir)));
    return jsonText({
      project: path.basename(process.cwd()),
      tracks,
      summary: {
        tracks: tracks.length,
        done: tracks.reduce((a, t) => a + t.done, 0),
        total: tracks.reduce((a, t) => a + t.total, 0),
        active: tracks.filter((t) => t.status === "active").length,
      },
    });
  },
);

registerAppTool(
  server,
  "get_track",
  {
    title: "Get track detail",
    description: "Full view of one track: parsed plan tree, spec text, handoff summary and comment threads.",
    inputSchema: { trackId: z.string() },
    _meta: APP_ONLY,
  },
  async ({ trackId }) => {
    const r = resolveTrack(trackId);
    if (r.error) return jsonError(r.error);
    const dir = r.track.dir;
    const planRaw = readText(path.join(dir, "plan.md")) || "";
    const specStat = fs.statSync(path.join(dir, "spec.md"), { throwIfNoEntry: false });
    const spec = readText(path.join(dir, "spec.md"));
    const handoffStat = fs.statSync(path.join(dir, "handoff.md"), { throwIfNoEntry: false });
    return jsonText({
      id: r.track.id,
      description: r.track.description,
      status: r.track.status,
      plan: parsePlan(planRaw),
      spec: spec == null ? null : { text: spec, modifiedIso: specStat?.mtime.toISOString() ?? null },
      handoff: parseHandoff(readText(path.join(dir, "handoff.md")), handoffStat),
      comments: parseComments(readText(path.join(dir, "comments.md"))),
    });
  },
);

registerAppTool(
  server,
  "timeline",
  {
    title: "Track timeline data",
    description:
      "Map every completed task's commit SHA in plan.md to its commit date via git, for timeline rendering. One lane per track.",
    inputSchema: { trackId: z.string().optional() },
    _meta: APP_ONLY,
  },
  async ({ trackId }) => {
    if (!fs.existsSync(CONDUCTOR_DIR)) return jsonError("not_initialized");
    const reg = readTracksRegistry();
    const registryIds = new Set(reg.tracks.map((x) => x.id));
    const archived = listArchivedTracks().filter((a) => !registryIds.has(a.id));
    const selected = trackId
      ? reg.tracks.filter((t) => t.id === trackId)
      : [...reg.tracks.filter((t) => t.id), ...archived.map((a) => ({ id: a.id, description: a.description, status: a.status, dir: a.dir, archived: true }))];
    const lanes = [];
    for (const t of selected) {
      if (!t.dir) continue;
      const plan = parsePlan(readText(path.join(t.dir, "plan.md")) || "");
      const points = [];
      plan.forEach((p, pi) => {
        p.tasks.forEach((task, ti) => {
          if (task.state === "done" && task.sha && !task.subtask)
            points.push({ sha: task.sha, label: task.label, phaseIdx: pi, taskIdx: ti });
        });
      });
      const dates = await gitDates(points.map((p) => p.sha));
      for (const p of points) p.iso = dates[p.sha] || null;
      const handoffStat = fs.statSync(path.join(t.dir, "handoff.md"), { throwIfNoEntry: false });
      // every registered track has folder history, even when its plan records no SHAs
      const span = await gitTrackSpan(path.relative(process.cwd(), t.dir));
      if (span) {
        // an actively edited plan extends the bar even before the next commit
        const planStat = fs.statSync(path.join(t.dir, "plan.md"), { throwIfNoEntry: false });
        if (planStat && planStat.mtime.toISOString() > span.lastIso) span.lastIso = planStat.mtime.toISOString();
      }
      lanes.push({
        id: t.id,
        description: t.description,
        status: t.status,
        archived: !!t.archived,
        points: points.filter((p) => p.iso),
        span,
        handoff: handoffStat ? handoffStat.mtime.toISOString() : null,
      });
    }
    return jsonText({
      lanes,
      todayIso: new Date().toISOString(),
    });
  },
);

registerAppTool(
  server,
  "add_comment",
  {
    title: "Add plan comment",
    description:
      "Append a comment to a track's git-tracked comments.md sidecar. Anchor is '<phaseIndex>:<taskIndex>' into the parsed plan tree. plan.md itself is never modified.",
    inputSchema: {
      trackId: z.string(),
      anchor: z.string().regex(/^\d+:\d+$/),
      text: z.string().min(1),
      author: z.string().optional(),
    },
    _meta: APP_ONLY,
  },
  async ({ trackId, anchor, text, author }) => {
    const r = resolveTrack(trackId);
    if (r.error) return jsonError(r.error);
    const file = path.join(r.track.dir, "comments.md");
    const threads = parseComments(readText(file));
    const [pi, ti] = anchor.split(":").map(Number);
    const plan = parsePlan(readText(path.join(r.track.dir, "plan.md")) || "");
    const label = plan[pi]?.tasks[ti]?.label || "task";
    let thread = threads.find((t) => t.anchor === anchor);
    if (!thread) {
      thread = { anchor, label, state: "open", entries: [] };
      threads.push(thread);
    }
    thread.state = "open";
    thread.entries.push({ when: fmtWhen(new Date()), author: author || "user", text: text.trim() });
    suppressWatch.add(file);
    fs.writeFileSync(file, serializeComments(trackId, threads) + "\n");
    notifyUris(trackFilePaths(trackId));
    return jsonText({ ok: true, anchor, state: "open" });
  },
);

registerAppTool(
  server,
  "resolve_comment",
  {
    title: "Resolve or reopen plan comment",
    description: "Mark a comment thread in comments.md resolved (or reopen it).",
    inputSchema: { trackId: z.string(), anchor: z.string(), resolved: z.boolean().optional() },
    _meta: APP_ONLY,
  },
  async ({ trackId, anchor, resolved = true }) => {
    const r = resolveTrack(trackId);
    if (r.error) return jsonError(r.error);
    const file = path.join(r.track.dir, "comments.md");
    const threads = parseComments(readText(file));
    const thread = threads.find((t) => t.anchor === anchor);
    if (!thread) return jsonError(`No comment thread at anchor ${anchor}`);
    thread.state = resolved ? "resolved" : "open";
    suppressWatch.add(file);
    fs.writeFileSync(file, serializeComments(trackId, threads) + "\n");
    notifyUris(trackFilePaths(trackId));
    return jsonText({ ok: true, anchor, state: thread.state });
  },
);

const ACTIONS = {
  implement_next: (id) => `/conductor:implement ${id} — resume, picking up the session handoff if present`,
  review: (id) => `/conductor:review ${id}`,
  revert: (id) => `/conductor:revert ${id}`,
  handoff: (id) => `/conductor:handoff ${id}`,
  new_track: (_id, idea) => `Let's plan a new track: ${idea || "(describe the work)"}`,
  setup: () => `/conductor:setup`,
};

function candidatePrompt(c, mode) {
  const files = c.files ? ` Files: ${c.files}.` : "";
  if (mode === "plan") {
    return `Let's plan a new track from architecture candidate ${c.id}: deepening "${c.title}" — ${c.solution || c.problem}.${files} When the track is registered, mark ${c.id} as [planned] in conductor/architecture-review.md with the track id.`;
  }
  return `Dismiss architecture candidate ${c.id} ("${c.title}") in conductor/architecture-review.md: ask me for the reason, record it in the candidate's Disposition line, and offer an ADR in docs/adr/ if the reason is load-bearing.`;
}

registerAppTool(
  server,
  "get_task_diff",
  {
    title: "Commit diff for a plan task",
    description:
      "The full `git show` of a task's recorded commit — message plus patch — for display in the panel. Read-only; large patches are truncated.",
    inputSchema: {
      trackId: z.string(),
      sha: z.string().regex(/^[0-9a-f]{7,40}$/),
    },
    _meta: APP_ONLY,
  },
  async ({ trackId, sha }) => {
    const r = resolveTrack(trackId);
    if (r.error) return jsonError(r.error);
    const show = await execFileP("git", ["show", "--format=medium", sha]);
    if (show.err) return jsonError(show.err.message.split("\n")[0]);
    const text = show.stdout;
    const cut = text.indexOf("diff --git");
    const message = cut >= 0 ? text.slice(0, cut).trim() : text.trim();
    let diff = cut >= 0 ? text.slice(cut) : "";
    let truncated = false;
    const MAX = 64000;
    if (diff.length > MAX) {
      diff = diff.slice(0, MAX) + "\n… truncated";
      truncated = true;
    }
    return jsonText({ sha, message, diff, truncated });
  },
);

registerAppTool(
  server,
  "request_action",
  {
    title: "Build a chat prompt for a conductor action",
    description:
      "Returns the exact chat prompt that hands the requested action (implement/review/revert/revert-task/handoff/new track/setup/architecture candidate) to the conductor skills. The panel sends it to the conversation.",
    inputSchema: {
      action: z.enum([...Object.keys(ACTIONS), "architecture_plan", "architecture_dismiss", "revert_task"]),
      trackId: z.string().optional(),
      idea: z.string().optional(),
      candidateId: z.string().optional(),
      sha: z.string().optional(),
      label: z.string().optional(),
    },
    _meta: APP_ONLY,
  },
  async ({ action, trackId, idea, candidateId, sha, label }) => {
    if (action === "architecture_plan" || action === "architecture_dismiss") {
      const file = path.join(CONDUCTOR_DIR, ARCH_FILE);
      const candidates = parseArchitectureReview(readText(file)) || [];
      const c = candidates.find((x) => x.id === candidateId);
      if (!c) return jsonError(`No candidate '${candidateId}' in ${ARCH_FILE}`);
      return jsonText({ action, prompt: candidatePrompt(c, action === "architecture_plan" ? "plan" : "dismiss") });
    }
    if (action === "revert_task") {
      if (!trackId || !sha) return jsonError("revert_task needs trackId and sha");
      const r = resolveTrack(trackId);
      if (r.error) return jsonError(r.error);
      return jsonText({
        action,
        prompt: `Revert the task "${label || sha}" from track ${trackId} — its commit is ${sha}. Use the conductor-revert flow to revert exactly that unit of work and update plan.md accordingly.`,
      });
    }
    if (trackId && action !== "new_track" && action !== "setup") {
      const r = resolveTrack(trackId);
      if (r.error) return jsonError(r.error);
    }
    return jsonText({ action, prompt: ACTIONS[action](trackId, idea) });
  },
);

registerAppTool(
  server,
  "get_architecture_review",
  {
    title: "Get architecture review backlog",
    description:
      "Parse conductor/architecture-review.md — deepening candidates recorded by the conductor-architecture skill and conductor-review, with their disposition (open/planned/dismissed).",
    inputSchema: {},
    _meta: APP_ONLY,
  },
  async () => {
    if (!fs.existsSync(CONDUCTOR_DIR)) return jsonError("not_initialized");
    const file = path.join(CONDUCTOR_DIR, ARCH_FILE);
    const candidates = parseArchitectureReview(readText(file));
    if (candidates == null) return jsonText({ exists: false, candidates: [] });
    return jsonText({
      exists: true,
      candidates,
      open: candidates.filter((c) => c.state === "open").length,
    });
  },
);

registerAppTool(
  server,
  "get_changelog",
  {
    title: "Get project changelog",
    description:
      "Parse conductor/changelog.md — one 'what shipped' entry per completed track, appended by the implement skill. Completed tracks missing from the file are synthesized from the registry (dated by their last folder commit) and flagged synthesized.",
    inputSchema: {},
    _meta: APP_ONLY,
  },
  async () => {
    if (!fs.existsSync(CONDUCTOR_DIR)) return jsonError("not_initialized");
    const explicit = parseChangelog(readText(path.join(CONDUCTOR_DIR, CHANGELOG_FILE)));
    const seen = new Set(explicit.map((e) => e.trackId));
    const entries = [...explicit];
    const reg = readTracksRegistry();
    const registryIds = new Set(reg.tracks.map((x) => x.id));
    const doneSources = [
      ...reg.tracks.filter((x) => x.id && x.status === "done"),
      ...listArchivedTracks().filter((a) => !registryIds.has(a.id)),
    ];
    for (const t of doneSources) {
      if (seen.has(t.id)) continue;
      const span = await gitTrackSpan(path.relative(process.cwd(), t.dir || ""));
      entries.push({
        date: span ? span.lastIso.slice(0, 10) : null,
        trackId: t.id,
        title: t.description,
        shipped: null,
        synthesized: true,
      });
    }
    entries.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return jsonText({ exists: explicit.length > 0, entries });
  },
);

registerAppTool(
  server,
  "set_candidate_disposition",
  {
    title: "Set architecture candidate disposition",
    description:
      "Update a candidate in conductor/architecture-review.md: mark it planned (optionally with the track ref) or dismissed (with reason), or reopen it.",
    inputSchema: {
      id: z.string(),
      disposition: z.enum(["open", "planned", "dismissed"]),
      note: z.string().optional(),
    },
    _meta: APP_ONLY,
  },
  async ({ id, disposition, note }) => {
    if (!fs.existsSync(CONDUCTOR_DIR)) return jsonError("not_initialized");
    const file = path.join(CONDUCTOR_DIR, ARCH_FILE);
    const candidates = parseArchitectureReview(readText(file));
    if (candidates == null) return jsonError(`${ARCH_FILE} does not exist`);
    const c = candidates.find((x) => x.id === id);
    if (!c) return jsonError(`No candidate '${id}' in ${ARCH_FILE}`);
    c.state = disposition;
    const today = fmtWhen(new Date()).slice(0, 10);
    if (disposition === "open") c.disposition = "open";
    else if (disposition === "planned") c.disposition = `planned → ${note || "track pending"} (${today})`;
    else c.disposition = `dismissed ${today}${note ? ` — ${note}` : ""}`;
    const body = candidates.map(serializeCandidate).join("\n");
    suppressWatch.add(file);
    fs.writeFileSync(
      file,
      `# Architecture Review\n\n<!-- conductor-architecture:v1 -->\n\n${body}`,
    );
    notifyUris(["conductor://architecture-review"]);
    return jsonText({ ok: true, id, state: c.state, disposition: c.disposition });
  },
);

// ---------------------------------------------------------------- resources

registerAppResource(
  server,
  "Conductor Panel",
  PANEL_URI,
  { mimeType: RESOURCE_MIME_TYPE },
  async () => ({
    contents: [{ uri: PANEL_URI, mimeType: RESOURCE_MIME_TYPE, text: readText(path.join(DIST_DIR, "panel.html")) || "" }],
  }),
);

registerAppResource(
  server,
  "Tracks Registry",
  "conductor://registry",
  { mimeType: "text/markdown" },
  async () => ({
    contents: [
      { uri: "conductor://registry", mimeType: "text/markdown", text: readText(path.join(CONDUCTOR_DIR, "tracks.md")) || "" },
    ],
  }),
);

registerAppResource(
  server,
  "Architecture Review",
  "conductor://architecture-review",
  { mimeType: "text/markdown" },
  async () => ({
    contents: [
      {
        uri: "conductor://architecture-review",
        mimeType: "text/markdown",
        text: readText(path.join(CONDUCTOR_DIR, ARCH_FILE)) || "",
      },
    ],
  }),
);

registerAppResource(
  server,
  "Project Changelog",
  "conductor://changelog",
  { mimeType: "text/markdown" },
  async () => ({
    contents: [
      {
        uri: "conductor://changelog",
        mimeType: "text/markdown",
        text: readText(path.join(CONDUCTOR_DIR, CHANGELOG_FILE)) || "",
      },
    ],
  }),
);

const trackFiles = [
  ["plan.md", "Implementation plan", "text/markdown"],
  ["spec.md", "Specification", "text/markdown"],
  ["handoff.md", "Session handoff", "text/markdown"],
  ["comments.md", "Plan comments", "text/markdown"],
];
for (const [file, name, mime] of trackFiles) {
  server.registerResource(
    `track-${file}`,
    new ResourceTemplate(`conductor://tracks/{id}/${file}`, { list: undefined }),
    { name: `Track ${name}`, mimeType: mime },
    async (uri, { id }) => {
      const text = readText(path.join(TRACKS_DIR, String(id), file));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: mime,
            ...(text == null
              ? { text: "" }
              : { text }),
          },
        ],
      };
    },
  );
}

// ------------------------------------------------------------ subscriptions

server.server.setRequestHandler("resources/subscribe", async () => ({}));
server.server.setRequestHandler("resources/unsubscribe", async () => ({}));

// -------------------------------------------------------------- file watch

const suppressWatch = new Set();
const pendingUris = new Set();
let flushTimer = null;

function uriForWatchPath(relPath) {
  const norm = relPath.split(path.sep).join("/");
  if (norm === "tracks.md" || norm === "index.md") return ["conductor://registry"];
  if (norm === ARCH_FILE) return ["conductor://architecture-review"];
  if (norm === CHANGELOG_FILE) return ["conductor://changelog"];
  const m = norm.match(/^tracks\/([^/]+)\/(.+)$/);
  if (m) return [`conductor://tracks/${m[1]}/${m[2]}`];
  return ["conductor://registry"];
}

function notifyUris(uris) {
  for (const uri of uris) pendingUris.add(uri);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushNotifications, 250);
}

function flushNotifications() {
  const uris = [...pendingUris];
  pendingUris.clear();
  for (const uri of uris) {
    server.server.sendResourceUpdated({ uri }).catch(() => {});
  }
  if (uris.some((u) => u === "conductor://registry")) {
    server.server.sendResourceListChanged().catch(() => {});
  }
}

function startWatch() {
  if (!fs.existsSync(CONDUCTOR_DIR)) return;
  try {
    const watcher = fs.watch(CONDUCTOR_DIR, { recursive: true }, (_event, filename) => {
      try {
        if (!filename) return;
        const abs = path.join(CONDUCTOR_DIR, filename);
        if (suppressWatch.has(abs)) {
          suppressWatch.delete(abs);
          return;
        }
        notifyUris(uriForWatchPath(filename));
      } catch (err) {
        console.error(`[conductor-mcp] watch callback failed: ${err.message}`);
      }
    });
    // an async watcher error (e.g. inotify limit exhausted) must not kill the
    // process — degrade to no live updates instead
    watcher.on("error", (err) => {
      console.error(`[conductor-mcp] watcher error (live updates disabled): ${err.message}`);
      try { watcher.close(); } catch { /* already closed */ }
    });
  } catch (err) {
    console.error(`[conductor-mcp] watch failed: ${err.message}`);
  }
}

// --------------------------------------------------------------------- main

async function main() {
  // a stdio server that dies silently leaves every tool call hanging — log and stay up
  process.on("uncaughtException", (err) => {
    console.error(`[conductor-mcp] uncaught exception (kept alive): ${err.stack || err}`);
  });
  process.on("unhandledRejection", (reason) => {
    console.error(`[conductor-mcp] unhandled rejection (kept alive): ${reason}`);
  });
  await server.connect(new StdioServerTransport());
  startWatch();
  console.error("[conductor-mcp] connected over stdio");
}

main().catch((err) => {
  console.error("[conductor-mcp] fatal:", err);
  process.exit(1);
});
