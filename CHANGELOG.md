# Changelog

All notable changes to the Conductor for ZCode plugin. This plugin versions
independently; the upstream version it was ported from is noted in the README.

## 0.15.0 — 2026-10-14

**Visible version + handoffs in the panel:**

- The panel header shows a version chip for the **installed plugin**
  (`v0.15.0`) plus the workspace the server is bound to (tooltip). A new
  `get_version` tool reports the plugin version, the running server's build
  version, and the workspace — and the chip warns when they disagree, the
  signature of a stale install.
- **handoff.md tab** in the track detail: the full session handoff — resume
  pointer, working state, decisions, gotchas, dead ends — rendered as
  markdown, not just the one-line resume banner.
- Blocked tasks surface in the track list as a red `N blocked` chip,
  completing the `[!]` loop.
- **Archive tab + archive action:** browse `conductor/archive/` tracks (with
  their plans and specs), and archive a completed track from the panel — the
  action hands the review-cleanup move to the conversation.
- **History feed:** the Timeline tab now ends with a unified chronological
  feed — starts, completions, handoffs and shipped summaries in date order —
  so what went before what is readable at a glance instead of buried in bar
  geometry.

## 0.14.0 — 2026-10-14

**Make the protocol self-enforcing:**

- **Auto-checkpoint handoffs:** the implement loop now updates the resume
  pointer in `handoff.md` in the same commit as every plan checkbox change
  (`[~]` flip and `[x]`+SHA completion). A crashed session can no longer lose
  the resume state; Decisions/Gotchas sections stay untouched, and the full
  `/conductor:handoff` ceremony still owns the file.
- **Blockers (`[!]`):** a checkbox convention for blocked tasks. The panel
  renders them with a red chip; `/conductor:status` reports them;
  `/conductor:next` never resumes straight into one — it offers unblocking,
  skipping, or switching tracks; `implement` pauses at a blocked task instead
  of working around it silently.
- **Router hardening:** `continue` and `/conductor:next` explicitly require
  invoking the target skill's full protocol from step 1 — the router itself
  never implements, skips handshakes, or edits plans.
- **Workflow-template conformance check** (`conductor-setup`): after the
  resumption check, the project's `workflow.md` is compared against the
  bundled template — missing sections (Amendment workflows, Checkpoint
  protocol, Quality Gates) and the missing **Record Task Commit SHA** step
  are flagged and offered as verbatim appends. This catches the template
  drift that left completed tasks without commit SHAs.

## 0.13.0 — 2026-10-14

**Step discipline that agents skipped in real use:**

- **Task boundary discipline** in `conductor-implement` (mandatory, in
  order): `[~]` flip before any code work; `[x]` + 7-char SHA on completion
  with a separate plan commit; the full Phase Checkpoint Checklist (coverage,
  tests, user-verified, git-notes report, `[checkpoint: <sha>]` heading
  marker) for phase-ending tasks; the todo mirror may never read `completed`
  against an open checkbox.
- **Plan-file edit rule:** anchor plan edits on unique context — phase
  heading plus full task text — after generic anchors inserted sections into
  the wrong phase.
- **Review Fixes placement rule:** the `## Review Fixes` phase always goes at
  the END of `plan.md`, anchored on the final checkpoint line.

## 0.12.0 — 2026-10-13

**Click a commit hash, see the diff:** every completed task's SHA in the plan
tree is now a button — clicking loads that commit's `git show` (message +
patch, ±/hunk coloring, capped at 64 KiB with a truncation note) inline,
**only under the clicked task** — tasks sharing one batch commit SHA no
longer all sprout loading rows. Clicking shows just the diff; reverts stay in
the conductor-revert skill.

## 0.11.0 — 2026-10-13

**Archived tracks are history, not ghosts:** `conductor/archive/<id>/` folders
(whether moved by review cleanup or by hand) now appear in the timeline lanes
and the Recently shipped list — always as completed, dated by their real git
history — while staying out of the planning list and registry views.
`get_track` also resolves archived ids again. Their metadata comes in many
shapes, so archived status is fixed to done and descriptions fall back
through `description` → `title` → folder name.

## 0.10.0 — 2026-10-13

**Project changelog:** `conductor/changelog.md` — the implement finalize step
appends a plain-language "what shipped" entry per completed track (newest
first, git-tracked). The panel's Timeline tab renders a **Recently shipped**
list; completed tracks missing entries are synthesized from the registry,
dated by their last folder commit.

## 0.9.0 — 2026-10-13

**Review deepening** (`conductor-review`):

- **Plan-hygiene check:** completed (`[x]`) tasks without a recorded commit
  SHA are flagged as findings — without SHAs the timeline has no dots and
  per-task revert can't locate the work.
- **Contract check ("review the change, not the diff"):** callers and callees
  of every changed function are pulled in and checked for broken assumptions.
- **Acceptance-criteria coverage matrix:** each `spec.md` criterion is mapped
  to the test covering it; uncovered criteria become findings and are listed
  in the report.
- **Explicit severity rubric** (Critical / High / Medium / Low) so reviews are
  consistent across sessions and agents.
- **Re-verification loop:** after Apply Fixes, the test suite is re-run and
  each finding re-checked before the fix commit is made; failed fixes revert
  and stay open as review tasks.

## 0.8.4 — 2026-10-13

**Review findings are follow-able:** `/conductor:review` records every finding
as a task in the track's `plan.md` under a `## Review Fixes` phase — open
(`[ ]`) when deferred, completed (`[x] <sha>`) when fixed immediately. Open
review fixes flip the registry back to `[~]` so `/conductor:next` and
`/conductor:implement` route to them; the panel plan tree, Todos badge and
todo mirror pick them up automatically. Track cleanup recommends Skip while
open review fixes remain.

## 0.8.3 — 2026-10-13

**Timeline for all tracks:** track-activity bars are derived from git history
of each track folder (`git log -- conductor/tracks/<id>`), so tracks whose
plans record no commit SHAs still appear. Bars extend to the present while the
plan is being actively edited. Commit-SHA dots still render when present, and
unknown SHAs are skipped individually instead of blanking the whole timeline.

## 0.8.2 — 2026-10-13

**Server crash hardening:** async `fs.watch` errors (e.g. inotify instance
limits) no longer kill the server — live updates degrade instead, and
`uncaughtException` / `unhandledRejection` are logged to stderr with the
process kept alive. Panel tool-call timeout raised 6s → 30s with one automatic
retry, and the error banner gained a Retry button.

## 0.8.1 — 2026-10-13

**Registry parser fixes** after auditing real-world conductor projects:
entries with the upstream `--- ` prefix, CRLF line endings, links on a
continuation line or into `conductor/archive/`, markdown-table rows with
status words, and ID-column tables (`| track-001 | Title | done | … |`) now
all parse. Verified against seven local projects.

## 0.8.0 — 2026-10-13

**Architecture review, incorporated:** candidates live in the git-tracked
deepening backlog `conductor/architecture-review.md`, rendered by the panel's
new **Architecture tab** (plan-as-track / dismiss actions, open-count badge).
`conductor-review` gained a Depth Check that feeds observations into the same
backlog, and offers a full scan when it accumulates.

## 0.7.0 — 2026-10-13

**`/conductor:architecture`** — port of Matt Pocock's
`improve-codebase-architecture` (MIT): deepening-opportunity scan over
commit-history hot spots, visual HTML report (temp dir), grilling loop folded
into a conductor track via the new-track flow. Design vocabulary inlined.

## 0.6.0 — 2026-10-13

**Conductor panel (MCP App):** `mcpServers` + `ui.surfaces` in the manifest,
a stdio server exposing `list_tracks` / `get_track` / `timeline` / comments /
`request_action` tools and subscribe-able resources with live file watching,
and a panel UI (Conductor / Timeline / Todos) with plan tree, `spec.md` view,
comment threads (`comments.md` sidecar), handoff resume banner, and
action buttons that hand `/conductor:*` prompts to the conversation. Built on
`@modelcontextprotocol/ext-apps` 2.x; page-only tools hidden from the model.

## 0.5.0 — 2026-10-13

- **`/conductor:next`** (`conductor-next`): routes to the right next action —
  resumes the in-progress track (handoffs first), starts the next planned
  track, or offers to plan new work.
- **Plan-amendment protocol** in `conductor-implement`: mid-implementation
  discoveries go through propose → approve → apply → sync → commit; the plan
  is never silently edited, and `[x]` history is never rewritten.
