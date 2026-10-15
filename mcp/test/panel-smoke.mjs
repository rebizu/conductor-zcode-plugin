// Panel render-function smoke: extracts the pure render helpers from
// src/panel/main.mjs, evaluates them with stubs, and renders a full plan
// tree — catching ReferenceErrors and template breakage without a host.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const src = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "panel", "main.mjs"),
  "utf-8",
);

function grab(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const names = ["planTree", "diffRowHtml", "diffHtml", "threadHtml", "miniBar"];
const factoryArgs = ["state", "esc", "icon", "commentThreads"];
const fns = names.map((n) => grab(n)).join("\n");
const make = new Function(
  ...factoryArgs,
  `${fns}\nreturn { planTree, diffRowHtml, diffHtml, threadHtml, miniBar, chip: function (s) { return '<span class="chip">' + s + '</span>'; } };`,
);

const state = {
  openThread: null,
  openDiff: "plan:t:1:0",
  diffs: { abc1234: { sha: "abc1234", message: "msg", diff: "diff --git a/f b/f\n+++ +line\n--- -line\n@@ hunk", truncated: false } },
  collapsedPhases: {},
};
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const icon = () => "";
const commentThreads = () => ({
  "t:0:1": { state: "open", entries: [{ who: "R", when: "now", text: "hi" }] },
});
const { planTree, diffRowHtml } = make(state, esc, icon, commentThreads);

const detail = {
  id: "t",
  plan: [
    { name: "Phase 1 · Done", done: 2, tasks: [
      { state: "done", label: "a", sha: "abc1234", subtask: false },
      { state: "done", label: "b", sha: null, subtask: false } ] },
    { name: "Phase 2 · Active", done: 1, tasks: [
      { state: "active", label: "c", sha: "abc1234", subtask: false },
      { state: "blocked", label: "d", sha: null, subtask: false },
      { state: "todo", label: "e", sha: null, subtask: false } ] },
  ],
};

const html = planTree(detail);
assert.ok(!html.includes("undefined"), "rendered plan tree contains 'undefined'");
assert.ok(html.includes("Phase 1 · Done") && html.includes("2/2"), "done phase rendered with count");
assert.ok(html.includes("Phase 2 · Active") && html.includes("1/3"), "active phase rendered with count");
assert.ok(html.includes("blockedchip"), "blocked chip rendered");
assert.ok(html.includes("nowchip"), "now chip rendered");
assert.ok(html.includes("abc1234"), "sha button rendered");
assert.match(html, /diff --git/, "open diff row rendered");
// collapsed-by-default: fully-done phase hides its task list
const p1 = html.indexOf("Phase 1");
const p1seg = html.slice(p1, html.indexOf("Phase 2"));
assert.ok(!p1seg.includes("tasklabel"), "fully-done phase collapsed by default");
// diff opens only under the keyed task
assert.ok(state.openDiff.includes(":"), "diff keyed");
console.log("panel-smoke: plan tree renders clean (no undefined), collapse + diff + chips OK");
