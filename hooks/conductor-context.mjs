// Conductor SessionStart context injector.
//
// Upstream conductor keeps all project state in parseable files (tracks.md
// checkbox registry, per-track plan.md) but nothing loads it automatically,
// so every fresh session starts unaware of the project. This hook prints a
// compact summary when the working directory is a conductor project and
// prints nothing otherwise. Pure file reads; never throws, never blocks.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

process.exitCode = 0;
const quiet = () => process.exit(0);

try {
  const root = process.cwd();
  const registryPath = join(root, "conductor", "tracks.md");
  if (!existsSync(registryPath)) quiet();

  const registry = readFileSync(registryPath, "utf8");
  const trackLine = /^- \[( |~|x)\] \*\*Track: (.+?)\*\*(.*)$/gm;
  const tracks = [];
  let m;
  while ((m = trackLine.exec(registry)) !== null) {
    const link = m[3].match(/\]\(([^)]+)\)/);
    tracks.push({ state: m[1], desc: m[2].trim(), link: link ? link[1].trim() : null });
  }
  if (tracks.length === 0) quiet();

  const complete = tracks.filter((t) => t.state === "x").length;
  const inProgress = tracks.filter((t) => t.state === "~").length;
  // Prefer a track already in progress; otherwise the next one not started.
  const active = tracks.find((t) => t.state === "~") ?? tracks.find((t) => t.state === " ");

  const out = [];
  out.push('<conductor-context source="conductor/tracks.md">');
  out.push(
    `Conductor project: ${tracks.length} track(s), ${complete} complete` +
      (inProgress ? `, ${inProgress} in progress` : "") +
      ".",
  );
  if (active) {
    out.push(
      `Active track: "${clip(active.desc, 90)}" (${active.state === "~" ? "in progress" : "not started"}).`,
    );
    appendPlanSummary(out, registryPath, active);
    out.push('Continue with /conductor:implement, overview with /conductor:status.');
  } else {
    out.push('All tracks complete. Start a new one with /conductor:new-track "description".');
  }
  out.push(
    "Project context lives in conductor/: product.md, product-guidelines.md, tech-stack.md, workflow.md.",
  );
  out.push("</conductor-context>");
  console.log(out.join("\n"));
} catch {
  quiet();
}

// Best-effort pending-task count from the active track's plan.md. The
// implement protocol does not pin the plan's task syntax, so treat any
// missing or unexpected file as "no detail" rather than an error.
function appendPlanSummary(out, registryPath, track) {
  if (!track.link) return;
  const trackDir = dirname(resolve(dirname(registryPath), track.link));
  const planPath = join(trackDir, "plan.md");
  if (!existsSync(planPath)) return;
  const plan = readFileSync(planPath, "utf8");
  const pending = [...plan.matchAll(/^\s*[-*] \[ \] (.+)$/gm)].map((x) => x[1].trim());
  if (pending.length === 0) return;
  const done = [...plan.matchAll(/^\s*[-*] \[[x~]\]/gm)].length;
  out.push(
    `Next task: ${clip(pending[0], 90)} (${pending.length} of ${pending.length + done} plan tasks pending).`,
  );
}

function clip(text, max) {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}
