// Plan-gate hook tests: feed sample PreToolUse payloads to the gate script in
// a temp git repo and assert pass (0) / block (2) behavior.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(ROOT, "..", "..", "hooks", "plan-gate.mjs");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "conductor-gate-"));
const cond = path.join(fixture, "conductor", "tracks", "t1");
fs.mkdirSync(cond, { recursive: true });
fs.writeFileSync(path.join(fixture, "conductor", "tracks.md"), "# Tracks Registry\n");

const git = (args) => spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: fixture });
assert.equal(git(["init", "-q"]).status, 0);

function commitWip() {
  git(["commit", "-qm", "wip"]);
}

function runGate(command) {
  const payload = JSON.stringify({ tool_name: "Bash", tool_input: { command } });
  const r = spawnSync("node", [GATE], {
    input: payload,
    cwd: fixture,
    env: { ...process.env, ZCODE_PROJECT_DIR: fixture },
    encoding: "utf-8",
  });
  return { code: r.status, stderr: r.stderr };
}
let passed = 0;
const ok = (n) => { passed++; console.log(`  ✓ ${n}`); };

// 1. non-commit command passes
let r = runGate("ls -la");
assert.equal(r.code, 0); ok("non-commit passes");

// 2. commit with a valid [x] tick (SHA present) passes
fs.writeFileSync(path.join(cond, "plan.md"), "# Plan\n\n- [x] Task: Do a thing `abc1234`\n");
assert.equal(git(["add", "-A"]).status, 0);
r = runGate("git commit -m test");
assert.equal(r.code, 0, "valid tick blocked: " + r.stderr); ok("valid tick passes");
commitWip();

// 3. commit adding a SHA-less [x] tick blocks
fs.writeFileSync(path.join(cond, "plan.md"), "# Plan\n\n- [x] Task: Do a thing `abc1234`\n- [x] Task: Do another thing\n");
assert.equal(git(["add", "-A"]).status, 0);
r = runGate("git commit -m test");
assert.equal(r.code, 2);
assert.match(r.stderr, /plan gate/);
assert.match(r.stderr, /Do another thing/);
ok("SHA-less tick blocked with reason");
commitWip();

// 3b. SHA in the wrong format (parens) also blocks
fs.writeFileSync(path.join(cond, "plan.md"), "# Plan\n\n- [x] Task: Do a thing (abc1234)\n");
assert.equal(git(["add", "-A"]).status, 0);
r = runGate("git commit -m test");
assert.equal(r.code, 2);
assert.match(r.stderr, /in backticks/);
ok("parens-form SHA blocked with format hint");
commitWip();

// 4. registry-style **Track: lines are not task ticks
fs.writeFileSync(path.join(fixture, "conductor", "tracks.md"), "# Tracks Registry\n\n- [x] **Track: Something shipped** *Link: [x](tracks/t1/index.md)*\n");
assert.equal(git(["add", "-A"]).status, 0);
r = runGate("git commit -m test");
assert.equal(r.code, 0, "registry line should not block: " + r.stderr); ok("registry **Track: lines exempt");
commitWip();

// 5. --no-verify bypass passes
fs.writeFileSync(path.join(cond, "plan.md"), "# Plan\n\n- [x] Task: Do another thing\n");
assert.equal(git(["add", "-A"]).status, 0);
r = runGate("git commit --no-verify -m test");
assert.equal(r.code, 0); ok("--no-verify bypass passes");
commitWip();

// 6. payload without a command passes
r = runGate("nonsense");
assert.equal(r.code, 0); ok("payload without command passes");

console.log(`\nplan-gate: ${passed} cases OK`);
