#!/usr/bin/env node
// Conductor plan gate (PreToolUse, Bash): blocks `git commit` when the staged
// diff ticks [x] tasks in conductor plan files without their commit SHA.
//
// Enforcement, not handcuffs: a commit made with --no-verify passes (git skips
// its own hooks for those, and we deliberately allow them here too).
// This hook must never break the tool call: any internal error passes through.

import { spawnSync } from "node:child_process";

let raw = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try {
    main(raw);
  } catch {
    pass(); // the gate must never take the session down
  }
});

function pass() {
  process.exit(0);
}

function block(reason) {
  process.stderr.write(`✗ conductor plan gate — ${reason}\n`);
  process.exit(2); // PreToolUse deny: the reason surfaces in the conversation
}

function main(raw) {
  let payload = {};
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    /* non-JSON payload — fall through to the raw check below */
  }
  const command =
    payload?.tool_input?.command ??
    payload?.input?.command ??
    payload?.command ??
    "";

  if (!/\bcommit\b/.test(String(command))) return pass(); // only gate commits
  if (/--no-verify/.test(String(command))) return pass(); // documented bypass

  const cwd = process.env.ZCODE_PROJECT_DIR || process.cwd();
  const diff = git(cwd, [
    "diff",
    "--cached",
    "--",
    "conductor/tracks/*/plan.md",
    "conductor/archive/*/plan.md",
  ]);
  if (diff == null || diff.trim() === "") return pass(); // not a repo, or nothing staged

  const bad = diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .filter((l) => /^\+\s*-\s*\[[xX]\]/.test(l))
    .filter((l) => !/\*\*Track:/.test(l)) // registry entries are track-level, not task ticks
    .filter((l) => !/`[0-9a-f]{7,40}`/.test(l)); // canonical SHA format: `abc1234`

  if (bad.length === 0) return pass();

  block(
    `${bad.length} plan tick${bad.length === 1 ? "" : "s"} missing their commit SHA:\n` +
      bad.map((l) => "  " + l.slice(1).trim()).join("\n") +
      "\nEach [x] task line must end with the 7-char SHA of its completing commit in backticks, e.g. `- [x] Task: Do a thing \`abc1234\`` " +
      "(commit the code first if it does not exist yet), then re-commit.",
  );
}

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (r.error || r.status !== 0) return null;
  return r.stdout;
}
