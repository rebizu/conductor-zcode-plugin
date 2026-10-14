# Changelog

All notable changes to the Conductor for ZCode plugin. This plugin versions
independently; the upstream version it was ported from is noted in the README.

## 0.12.0 — 2026-10-13

**Click a commit hash, see the diff:** every completed task's SHA in the plan
tree is now a button — clicking loads that commit's `git show` (message +
patch, ±/hunk coloring, capped at 64 KiB with a truncation note) inline under
the task. A "Revert this task" action in the diff footer hands a scoped
`conductor-revert` prompt to the conversation — the panel still never changes
anything itself.

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
