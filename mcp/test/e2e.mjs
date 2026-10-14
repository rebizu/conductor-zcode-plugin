// End-to-end test: builds a fixture conductor project (with a real git repo),
// spawns dist/server.mjs with cwd=fixture, and drives it over stdio JSON-RPC.
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import assert from "node:assert";

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------- fixture setup
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "conductor-e2e-"));
const cond = path.join(fixture, "conductor");
fs.mkdirSync(path.join(cond, "tracks", "001_sdd-core"), { recursive: true });
fs.mkdirSync(path.join(cond, "tracks", "002_mcp-panel"), { recursive: true });

fs.writeFileSync(
  path.join(cond, "index.md"),
  "# Conductor\n\n- [Product Definition](./product.md)\n- [Tracks Registry](./tracks.md)\n- [Tracks Directory](./tracks/)\n",
);
for (const f of ["product.md", "tech-stack.md", "workflow.md"])
  fs.writeFileSync(path.join(cond, f), `# ${f}\n`);
fs.writeFileSync(
  path.join(cond, "changelog.md"),
  `# Changelog

<!-- conductor-changelog:v1 -->

## 2026-09-01 — 000_legacy — Pre-conductor work
- Shipped: the original monorepo baseline.
`,
);
fs.writeFileSync(
  path.join(cond, "tracks.md"),
  `# Tracks Registry

--- - [x] **Track: SDD core protocol port** *Link: [001](tracks/001_sdd-core/index.md)*
- [~] **Track: Conductor MCP App panel** *Link: [002](tracks/002_mcp-panel/index.md)*
`,
);
fs.writeFileSync(
  path.join(cond, "architecture-review.md"),
  `# Architecture Review

<!-- conductor-architecture:v1 -->

## [open] deep-1 — Collapse the order intake pipeline
- **Strength:** Strong
- **Files:** \`src/order/handler.ts\`, \`src/order/validator.ts\`
- **Problem:** Order intake is shallow: interface nearly matches the implementation.
- **Solution:** One order interface; validators become internals.
- **Source:** scan 2026-10-13
- **Disposition:** open

## [planned] deep-2 — Deepen the export pipeline
- **Strength:** Worth exploring
- **Files:** \`src/export.ts\`
- **Problem:** Pricing leaks across the seam.
- **Solution:** Export module absorbs the pricing wrappers.
- **Source:** scan 2026-10-12
- **Disposition:** planned → track 004 (2026-10-12)

## [dismissed] deep-3 — Split the config loader
- **Strength:** Speculative
- **Files:** \`src/config.ts\`
- **Problem:** None observed.
- **Solution:** None.
- **Source:** scan 2026-10-10
- **Disposition:** dismissed 2026-10-11 — deletion test fails; see ADR-0002
`,
);

const plan = (rows) =>
  `# Plan\n\n## Phase 1 · Scaffold\n\n` +
  rows.map(([state, label, sha]) => `- [${state}] Task: ${label}${sha ? ` \`${sha}\`` : ""}`).join("\n") +
  "\n";

fs.writeFileSync(path.join(cond, "tracks/001_sdd-core/spec.md"), "# Spec — SDD core\n\nPort the protocol.\n");
fs.writeFileSync(path.join(cond, "tracks/001_sdd-core/metadata.json"), JSON.stringify({ id: "001_sdd-core", status: "done" }));
fs.writeFileSync(path.join(cond, "tracks/001_sdd-core/index.md"), "# 001\n");
fs.writeFileSync(path.join(cond, "tracks/002_mcp-panel/spec.md"), "# Spec — MCP panel\n\n## Goals\n\n- Live registry\n- Plan tree\n");
fs.writeFileSync(path.join(cond, "tracks/002_mcp-panel/metadata.json"), JSON.stringify({ id: "002_mcp-panel", status: "in-progress" }));
fs.writeFileSync(path.join(cond, "tracks/002_mcp-panel/index.md"), "# 002\n");
fs.writeFileSync(
  path.join(cond, "tracks/002_mcp-panel/handoff.md"),
  `# Session Handoff — Conductor MCP App panel\n\n_Written 2026-10-12 18:42. Annotation only.\n\n## Resume pointer\n\n- **Phase:** Phase 1 · Scaffold\n- **Task:** "Write panel shell" (\`[~]\`)\n- **Next concrete action:** render the registry list\n`,
);

const git = (args) =>
  spawnSync("git", ["-c", "user.email=t@t.local", "-c", "user.name=t", ...args], { cwd: fixture });
assert.equal(git(["init", "-q"]).status, 0, "git init");
// first commit: conductor skeleton without plan files
fs.writeFileSync(path.join(cond, "tracks/001_sdd-core/plan.md"), "# Plan\n");
fs.writeFileSync(path.join(cond, "tracks/002_mcp-panel/plan.md"), "# Plan\n");
assert.equal(git(["add", "-A"]).status, 0);
assert.equal(git(["commit", "-qm", "chore(conductor): skeleton"]).status, 0, "git commit");
const shaTask = git(["rev-parse", "HEAD"]).stdout.toString().trim();
// archived track: out of the registry, present under conductor/archive/
fs.mkdirSync(path.join(cond, "archive", "000_old_thing"), { recursive: true });
fs.writeFileSync(
  path.join(cond, "archive/000_old_thing/metadata.json"),
  JSON.stringify({ id: "000_old_thing", title: "Old thing shipped long ago", status: "done" }),
);
fs.writeFileSync(
  path.join(cond, "archive/000_old_thing/plan.md"),
  "# Plan\n\n## Phase 1 · Legacy\n\n- [x] Task: Do the old thing `" + shaTask + "`\n",
);
// now write real plans referencing the commit, and commit them
fs.writeFileSync(path.join(cond, "tracks/001_sdd-core/plan.md"), plan([["x", "Read registry", shaTask], ["x", "Parse plan tree", shaTask], ["x", "Docs follow-up", "deadbeefdeadbeefdeadbeef"]]));
fs.writeFileSync(
  path.join(cond, "tracks/002_mcp-panel/plan.md"),
  plan([["x", "Serve panel resource", shaTask], ["~", "Write panel shell", null], [" ", "Subscribe to updates", null], ["!", "Blocked: waiting on API creds", null]]),
);
assert.equal(git(["add", "-A"]).status, 0);
assert.equal(git(["commit", "-qm", "chore(conductor): plans"]).status, 0, "git commit 2");

// ---------------------------------------------------------------- rpc client
class Rpc {
  constructor(child) {
    this.child = child;
    this.pending = new Map();
    this.notifs = [];
    this.buf = "";
    this.nextId = 1;
    child.stdout.on("data", (d) => {
      this.buf += d.toString();
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id !== undefined && !msg.method) {
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
          }
        } else if (String(msg.method).startsWith("notifications/")) {
          this.notifs.push(msg);
        }
      }
    });
  }
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  async waitNotif(method, match, ms = 5000) {
    const t0 = Date.now();
    for (;;) {
      const n = this.notifs.find((x) => x.method === method && (!match || match(x)));
      if (n) return n;
      if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${method}`);
      await sleep(40);
    }
  }
}

const child = spawn("node", [path.join(DIST, "server.mjs")], { cwd: fixture, stdio: ["pipe", "pipe", "inherit"] });
const rpc = new Rpc(child);
let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

try {
  // initialize handshake
  const init = await rpc.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e", version: "0.0.0" },
  });
  assert.equal(init.serverInfo.name, "conductor");
  ok("initialize handshake");

  // version: build version, manifest version, workspace binding
  const ver = JSON.parse((await rpc.request("tools/call", { name: "get_version", arguments: {} })).content[0].text);
  assert.equal(ver.pluginVersion, "0.15.0");
  assert.equal(ver.buildVersion, "0.15.0");
  assert.equal(ver.cwd, fixture);
  assert.equal(ver.conductorDir, path.join(fixture, "conductor"));
  ok("get_version: plugin + build version, workspace binding");
  rpc.notify("notifications/initialized", {});

  const tools = await rpc.request("tools/list", {});
  const names = tools.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["add_comment", "get_architecture_review", "get_changelog", "get_task_diff", "get_track", "get_version", "list_archived", "list_tracks", "request_action", "resolve_comment", "set_candidate_disposition", "timeline"]);
  ok("tools/list: 12 tools");

  // list_tracks
  const lt = JSON.parse((await rpc.request("tools/call", { name: "list_tracks", arguments: {} })).content[0].text);
  assert.equal(lt.tracks.length, 2);
  assert.equal(lt.summary.total, 7);
  assert.equal(lt.summary.done, 4);
  const t2 = lt.tracks.find((t) => t.id === "002_mcp-panel");
  assert.equal(t2.status, "active");
  assert.equal(t2.hasHandoff, true);
  assert.equal(t2.blocked, 1, "blocked task counted");
  assert.match(t2.handoffWritten, /2026-10-12 18:42/);
  ok("list_tracks: registry parsed, counts + handoff");

  // get_track
  const gt = JSON.parse(
    (await rpc.request("tools/call", { name: "get_track", arguments: { trackId: "002_mcp-panel" } })).content[0].text,
  );
  assert.equal(gt.plan.length, 1);
  assert.equal(gt.plan[0].tasks.length, 4);
  assert.equal(gt.plan[0].tasks[0].sha, shaTask);
  assert.equal(gt.plan[0].tasks[3].state, "blocked", "[!] parses as blocked");
  assert.equal(gt.plan[0].tasks[1].state, "active");
  assert.equal(gt.handoff.resumeTask, "Write panel shell");
  assert.equal(gt.comments.length, 0);
  assert.match(gt.spec.text, /# Spec — MCP panel/);
  assert.match(gt.handoff.text, /## Resume pointer/);
  assert.match(gt.handoff.text, /Write panel shell/);
  ok("get_track: plan tree, sha, handoff, spec");

  // timeline
  const tl = JSON.parse((await rpc.request("tools/call", { name: "timeline", arguments: {} })).content[0].text);
  const lane1 = tl.lanes.find((l) => l.id === "001_sdd-core");
  const lane2 = tl.lanes.find((l) => l.id === "002_mcp-panel");
  assert.equal(lane1.points.length, 2, "unknown SHA dropped, known ones kept");
  assert.ok(lane1.points.every((p) => p.iso), "points have commit dates");
  assert.ok(lane1.span && lane1.span.commits >= 1, "lane1 span from git history");
  assert.ok(lane2.span && lane2.span.commits >= 1, "lane2 span from git history");
  assert.equal(lane2.points.length, 1);
  assert.ok(lane2.points[0].iso, "point has commit date");
  assert.ok(lane2.handoff);
  ok("timeline: spans + per-SHA resilience (bogus SHA skipped)");

  // changelog: explicit entries + synthesized done tracks
  const cl = JSON.parse((await rpc.request("tools/call", { name: "get_changelog", arguments: {} })).content[0].text);
  assert.equal(cl.entries.length, 3, "explicit + synthesized done + archived");
  const legacy = cl.entries.find((e) => e.trackId === "000_legacy");
  assert.equal(legacy.synthesized, false);
  assert.match(legacy.shipped, /monorepo baseline/);
  const synth = cl.entries.find((e) => e.trackId === "001_sdd-core");
  assert.ok(synth && synth.synthesized === true, "done track synthesized");
  assert.ok(synth.date, "synthesized entry dated from git span");
  assert.ok(cl.entries[0].date >= cl.entries[cl.entries.length - 1].date, "sorted newest first");
  const archivedEntry = cl.entries.find((e) => e.trackId === "000_old_thing");
  assert.ok(archivedEntry && archivedEntry.synthesized, "archived track synthesized into changelog");
  ok("changelog: explicit + synthesized done + archived tracks, sorted");

  // archived browsing + archive action
  const la = JSON.parse((await rpc.request("tools/call", { name: "list_archived", arguments: {} })).content[0].text);
  assert.equal(la.tracks.length, 1);
  assert.equal(la.tracks[0].id, "000_old_thing");
  assert.equal(la.tracks[0].done, 1);
  assert.ok(la.tracks[0].lastIso, "archived track dated from git");
  const at = JSON.parse((await rpc.request("tools/call", { name: "get_track", arguments: { trackId: "000_old_thing" } })).content[0].text);
  assert.match(at.plan[0].tasks[0].label, /Do the old thing/);
  const arq = JSON.parse(
    (await rpc.request("tools/call", { name: "request_action", arguments: { action: "archive_track", trackId: "002_mcp-panel" } }))
      .content[0].text,
  );
  assert.match(arq.prompt, /conductor\/archive\/002_mcp-panel/);
  assert.match(arq.prompt, /conductor\/tracks\.md/);
  ok("archive: list_archived + get_track + archive_track prompt");

  // task diff + revert-task prompt
  const gd = JSON.parse(
    (await rpc.request("tools/call", { name: "get_task_diff", arguments: { trackId: "002_mcp-panel", sha: shaTask } }))
      .content[0].text,
  );
  assert.match(gd.diff, /diff --git/);
  assert.match(gd.message, /chore\(conductor\): skeleton/);
  assert.equal(gd.truncated, false);
  const bad = JSON.parse(
    (await rpc.request("tools/call", { name: "get_task_diff", arguments: { trackId: "002_mcp-panel", sha: "deadbeefdead" } }))
      .content[0].text,
  );
  assert.ok(bad.error, "unknown sha errors cleanly");
  ok("task diff: git show + clean errors on unknown sha");
  // archived tracks: in timeline + changelog, out of the planning list
  assert.equal(lt.tracks.filter((x) => x.id === "000_old_thing").length, 0, "archived not in planning list");
  const archivedLane = tl.lanes.find((l) => l.id === "000_old_thing");
  assert.ok(archivedLane, "archived lane present in timeline");
  assert.equal(archivedLane.status, "done");
  assert.equal(archivedLane.points.length, 1);
  assert.equal(archivedLane.archived, true);
  ok("archived tracks: history views only");

  // comments round-trip
  const ac = JSON.parse(
    (
      await rpc.request("tools/call", {
        name: "add_comment",
        arguments: { trackId: "002_mcp-panel", anchor: "0:1", text: "@conductor does the subscription survive remount?" },
      })
    ).content[0].text,
  );
  assert.equal(ac.ok, true);
  const ac2 = JSON.parse(
    (
      await rpc.request("tools/call", {
        name: "add_comment",
        arguments: { trackId: "002_mcp-panel", anchor: "0:1", text: "It does — widget state replays.", author: "ZCode" },
      })
    ).content[0].text,
  );
  assert.equal(ac2.ok, true);
  const gt2 = JSON.parse(
    (await rpc.request("tools/call", { name: "get_track", arguments: { trackId: "002_mcp-panel" } })).content[0].text,
  );
  assert.equal(gt2.comments.length, 1);
  assert.equal(gt2.comments[0].anchor, "0:1");
  assert.equal(gt2.comments[0].entries.length, 2);
  assert.equal(gt2.comments[0].state, "open");
  const rc = JSON.parse(
    (await rpc.request("tools/call", { name: "resolve_comment", arguments: { trackId: "002_mcp-panel", anchor: "0:1" } }))
      .content[0].text,
  );
  assert.equal(rc.state, "resolved");
  const commentsFile = fs.readFileSync(path.join(cond, "tracks/002_mcp-panel/comments.md"), "utf-8");
  assert.match(commentsFile, /## \[resolved\] 0:1 — Write panel shell/);
  assert.match(commentsFile, /- \*\*.*· ZCode\*\* — It does/);
  ok("comments: add/reply/resolve round-trip in comments.md");

  // request_action
  const ra = JSON.parse(
    (await rpc.request("tools/call", { name: "request_action", arguments: { action: "implement_next", trackId: "002_mcp-panel" } }))
      .content[0].text,
  );
  assert.match(ra.prompt, /\/conductor:implement 002_mcp-panel/);
  ok("request_action prompt");

  // architecture backlog: parse + dispositions + candidate prompts
  const ar = JSON.parse((await rpc.request("tools/call", { name: "get_architecture_review", arguments: {} })).content[0].text);
  assert.equal(ar.exists, true);
  assert.equal(ar.candidates.length, 3);
  assert.equal(ar.open, 1);
  const c1 = ar.candidates.find((c) => c.id === "deep-1");
  assert.equal(c1.state, "open");
  assert.equal(c1.strength, "Strong");
  assert.match(c1.problem, /shallow/);
  const sd = JSON.parse(
    (
      await rpc.request("tools/call", {
        name: "set_candidate_disposition",
        arguments: { id: "deep-1", disposition: "planned", note: "track 005_deepen-order" },
      })
    ).content[0].text,
  );
  assert.equal(sd.state, "planned");
  assert.match(sd.disposition, /track 005_deepen-order/);
  const backlogFile = fs.readFileSync(path.join(cond, "architecture-review.md"), "utf-8");
  assert.match(backlogFile, /## \[planned\] deep-1 — Collapse the order intake pipeline/);
  assert.match(backlogFile, /planned → track 005_deepen-order/);
  assert.match(backlogFile, /## \[dismissed\] deep-3/);
  const rp = JSON.parse(
    (await rpc.request("tools/call", { name: "request_action", arguments: { action: "architecture_dismiss", candidateId: "deep-2" } }))
      .content[0].text,
  );
  assert.match(rp.prompt, /Dismiss architecture candidate deep-2/);
  ok("architecture backlog: parse, disposition write, candidate prompt");

  // resources
  const rl = await rpc.request("resources/list", {});
  const uris = rl.resources.map((r) => r.uri);
  assert.ok(uris.includes("ui://conductor/panel.html"), "panel resource listed");
  assert.ok(uris.includes("conductor://registry"), "registry resource listed");
  assert.ok(uris.includes("conductor://architecture-review"), "architecture backlog resource listed");
  const backlogRes = await rpc.request("resources/read", { uri: "conductor://architecture-review" });
  assert.match(backlogRes.contents[0].text, /deep-2/);
  const panel = await rpc.request("resources/read", { uri: "ui://conductor/panel.html" });
  const panelText = panel.contents[0].text;
  assert.match(panel.contents[0].mimeType, /^text\/html/);
  assert.ok(panelText.includes("Conductor") && panelText.includes("<style>"));
  assert.ok(panelText.length < 4 * 1024 * 1024, "panel under 4 MiB");
  const planRes = await rpc.request("resources/read", { uri: "conductor://tracks/002_mcp-panel/plan.md" });
  assert.match(planRes.contents[0].text, /Task: Serve panel resource/);
  ok("resources: panel + registry + track template reads");

  // subscription + live update
  await rpc.request("resources/subscribe", { uri: "conductor://registry" });
  fs.appendFileSync(path.join(cond, "tracks.md"), "\n");
  await rpc.waitNotif("notifications/resources/updated", (n) => n.params.uri === "conductor://registry");
  await rpc.request("resources/unsubscribe", { uri: "conductor://registry" });
  await rpc.request("resources/subscribe", { uri: "conductor://architecture-review" });
  fs.appendFileSync(path.join(cond, "architecture-review.md"), "\n");
  await rpc.waitNotif("notifications/resources/updated", (n) => n.params.uri === "conductor://architecture-review");
  await rpc.request("resources/unsubscribe", { uri: "conductor://architecture-review" });
  ok("resources/subscribe + file-watch update notification");

  console.log(`\nPASS — ${passed} groups asserted. fixture: ${fixture}`);
} finally {
  child.kill();
}
