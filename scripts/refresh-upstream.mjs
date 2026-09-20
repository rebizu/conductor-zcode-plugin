#!/usr/bin/env node
// Re-vendors skills/ from upstream conductor main and re-applies the one
// local adaptation (python vs python3 in conductor-setup/SKILL.md).
// Usage: node scripts/refresh-upstream.mjs
// Afterwards: update the commit hash in README.md, bump the manifest
// versions, and commit.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const UPSTREAM = "https://github.com/gemini-cli-extensions/conductor";
const PATCH = {
  file: "skills/conductor-setup/SKILL.md",
  from: "Run the automated directory resumption script: `python3 scripts/resume.py`",
  to: "Run the automated directory resumption script: `python scripts/resume.py` (on systems where only `python3` exists, use `python3 scripts/resume.py`)",
};

const root = join(import.meta.dirname, "..");
const tmp = mkdtempSync(join(tmpdir(), "conductor-upstream-"));
try {
  execFileSync("git", ["clone", "--depth", "1", UPSTREAM, tmp], { stdio: "inherit" });
  const commit = execFileSync("git", ["-C", tmp, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  rmSync(join(root, "skills"), { recursive: true, force: true });
  cpSync(join(tmp, "skills"), join(root, "skills"), { recursive: true });

  const patchPath = join(root, PATCH.file);
  let text = readFileSync(patchPath, "utf8");
  if (!text.includes(PATCH.to)) {
    if (!text.includes(PATCH.from)) {
      throw new Error(
        `Patch anchor not found in ${PATCH.file} — upstream changed the line. Review and adapt the PATCH constant.`,
      );
    }
    writeFileSync(patchPath, text.replace(PATCH.from, PATCH.to));
  }
  console.log("vendored skills/ from upstream commit:", commit);
  console.log("local adaptation re-applied:", PATCH.file);
  console.log("next: update the commit hash in README.md, bump versions, commit");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
