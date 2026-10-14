# Conductor for ZCode

**Measure twice, code once.**

A ZCode port of the [Conductor](https://github.com/gemini-cli-extensions/conductor)
plugin (Apache-2.0, by the gemini-cli-extensions team, based on Keith
Ballinger's `.conductor`). Conductor enables **Spec-Driven Development**: it
turns the agent into a proactive project manager that follows a strict
protocol — **Context → Spec & Plan → Implement** — for every feature, bug fix
or chore.

This port keeps the upstream protocol intact and adapts it to ZCode:

- **ZCode todo-list integration (new in this port):** while implementing a
  track, every task in `plan.md` is mirrored into ZCode's native session todo
  list via the `TodoWrite` tool (one entry per task, phase-prefixed, statuses
  mapped `[ ]`→pending, `[~]`→in_progress, `[x]`→completed). The todo panel
  shows live progress; `plan.md` stays the durable source of truth and is
  kept in sync with checkboxes and commit SHAs as before.
- **Native question prompts:** all single-choice / multiple-choice / Yes-No
  questions are rendered with ZCode's `AskUserQuestion` tool (with an "Other"
  free-text escape hatch), replacing the upstream Antigravity GUI-modal rules.
- **ZCode skill discovery:** the optional third-party skill catalog installs
  into `.agents/skills/`, which ZCode discovers natively (workspace tier).
- **Session handoff (new in this port):** `/conductor:handoff` snapshots an
  in-progress track's resume pointer, working state and session-only
  decisions/gotchas into a git-tracked `handoff.md`. The `implement` and
  `status` skills pick it up automatically, so a fresh session (or another
  agent or machine) resumes exactly where the last one stopped. `plan.md`
  remains the source of truth; the handoff is an annotation that gets
  overwritten on each handoff and deleted once consumed.

## Components

| Command | Skill | What it does |
| :--------------------- | :----------------- | :----------------------------------------------- |
| `/conductor:setup` | `conductor-setup` | Scaffolds `conductor/` context (product, guidelines, tech stack, style guides, workflow, index). Run once per project. |
| `/conductor:new-track` | `conductor-new-track` | Plans a new track: interactive `spec.md` + `plan.md`, registry update, seeds the todo list. |
| `/conductor:implement` | `conductor-implement` | Executes the plan task by task (TDD per workflow), keeps `plan.md` and the todo list in sync. Mid-implementation discoveries go through an approval-gated plan-amendment protocol — the plan is never silently edited. Completing a track appends a plain-language summary to the project changelog (`conductor/changelog.md`). |
| `/conductor:next` | `conductor-next` | Routes to the right next action: resumes the in-progress track (reading any `handoff.md` automatically), starts the next planned track, or offers to plan a new one. |
| `/conductor:handoff` | `conductor-handoff` | Writes `conductor/tracks/<track_id>/handoff.md` — resume pointer, working state, decisions and gotchas — so a fresh session or agent can continue an in-progress track exactly where this one stopped. |
| `/conductor:status` | `conductor-status` | Progress report across the tracks registry and plans. |
| `/conductor:review` | `conductor-review` | Principal-engineer review against guidelines, style guides and plan. Findings are recorded as open tasks in the plan's `## Review Fixes` phase so they can be followed (or completed immediately with the Apply-Fixes flow); its depth check feeds architectural friction into the deepening backlog. |
| `/conductor:revert` | `conductor-revert` | Git-aware revert of a track, phase or single task (safe `git revert` or explicit hard reset). |
| `/conductor:architecture` | `conductor-architecture` | Architecture review: finds deepening opportunities (shallow → deep modules) in commit-history hot spots, records them in the git-tracked deepening backlog (`conductor/architecture-review.md`, visible in the panel's Architecture tab), renders a visual HTML report, and plans the chosen refactor as a track. Ported from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT). |

All skills also trigger from natural language, e.g. *"let's start a new track
for the login screen"*, *"implement the active plan"*, *"what's next?"*,
*"continue where I left off"*, *"revert the last
task"*.

Generated artifacts live in your project under `conductor/`:

```
conductor/
  index.md                  # the handshake: maps all context
  product.md  product-guidelines.md  tech-stack.md  workflow.md
  code_styleguides/         # copied from the plugin's template library
  tracks.md                 # registry of tracks
  tracks/<track_id>/        # spec.md, plan.md, metadata.json, index.md,
                            # handoff.md (session handoff, optional)
```

## Conductor panel (MCP App)

As of 0.6.0 the plugin ships an optional **MCP server + panel UI** — a live
dashboard docked in ZCode (open it manually from the right dock). The server
is read-mostly: it parses `conductor/` on every call, watches the directory,
and pushes resource updates so the panel reflects `plan.md` ticks the moment
the implement skill writes them. The only files it ever writes are
`comments.md` sidecars — `plan.md` and the registry stay owned by the skills.

- **Conductor tab** — registry with progress, per-track plan tree
  (`[ ]`/`[~]`/`[x]`, clickable commit SHAs that load the commit's diff),
  session-handoff resume banner, rendered
  `spec.md`, and comment threads anchored to plan tasks (stored in a
  git-tracked `conductor/tracks/<id>/comments.md`; `@conductor` mentions are
  picked up by the implement/review handshake). "Implement / Review /
  Handoff / Revert / New track" send the matching `/conductor:*` command into
  the conversation — the panel never implements anything itself.
- **Timeline tab** — one lane per track; commit dates come from resolving the
  SHAs recorded in `plan.md` through git (no new protocol, no invented
  estimates).
  Completed tracks also surface as a **Recently shipped** list
  (`conductor/changelog.md`, appended by the implement finalize step; done
  tracks missing entries are synthesized from the registry + git history).
  Archived tracks (`conductor/archive/`) appear in both as history — never in
  the planning list.
- **Architecture tab** — the deepening backlog from
  `conductor/architecture-review.md`: candidates from `/conductor:architecture`
  scans and from the review skill's depth check, each with strength and
  disposition. Open candidates offer "Plan as track" (hands a pre-filled
  `/conductor:new-track` prompt to the conversation) and "Dismiss" (asks for
  the reason, offers an ADR if it's load-bearing).
- **Todos tab** — the session todo mirror, same mapping as the `TodoWrite`
  integration.

Panel-only tools are hidden from the model (`visibility: ["app"]`); the
server is started with `cwd` set to your workspace, so it always reads the
project's real `conductor/` state.

### Building the panel

Runtime needs only `mcp/dist/` (committed). To rebuild after changing
`mcp/src/`:

```
cd mcp && npm install && npm run build && npm test
```

`npm run build` bundles `dist/server.mjs` (self-contained) and inlines the UI
into `dist/panel.html` (kept under the host's 4 MiB resource cap); `npm test`
runs an end-to-end suite against a generated fixture project. The panel's
small icon set is lucide-inspired (ISC license).

## Works together with the other local plugins

Conductor's core is **skills + commands**; the panel adds a read-mostly MCP
server (no hooks), so it still cannot interfere with the other plugins' hooks
or tools, and they cannot interfere with it. They compose well: Conductor's
spec-driven flow is token-hungry by design, and the other plugins claw those
tokens back:

- **rtk** rewrites Bash tool commands, shrinking the git/test output Conductor
  produces constantly (setup scans, TDD runs, review diffs).
- **headroom** compresses large tool results and file reads — helpful when
  Conductor re-reads specs, plans and style guides each phase.
- **caveman** compresses chat output if you want terse progress narration
  while Conductor walks its long protocol.

## Install (local marketplace)

1. In ZCode, open **Plugin Marketplace → Add → Add Plugin Marketplace** and
   paste this directory: `/home/reneb/_mycode/conductor-zcode-plugin`
   (the catalog is [marketplace.json](marketplace.json), market name
   `conductor-local`).
2. Open **Personal → conductor-local → conductor → Install**.
3. Manage it later under **Settings → Plugins**.

Then, in any project:

```
/conductor:setup        # once per project
/conductor:new-track    # plan a feature/bug/chore
/conductor:implement    # execute the plan (todo list mirrors progress)
/conductor:next         # continue: resume or start the right track
/conductor:handoff      # wrap up a session: snapshot state for the next one
/conductor:status | /conductor:review | /conductor:revert
/conductor:architecture # deepening opportunities → refactor track
```

## Notes & differences from upstream

- Upstream version at port time: `0.3.0` (skills metadata v1.0–1.1). This
  plugin versions itself independently from `0.4.0` on; the upstream version
  it was ported from is recorded here.
- The `/conductor:handoff` command and `conductor-handoff` skill are
  additions of this port (not in upstream `0.3.0`). They snapshot an
  in-progress track's session state into a git-tracked `handoff.md` that the
  `implement` and `status` skills pick up automatically.
- The `/conductor:next` command (`conductor-next` skill) and
  `conductor-implement`'s plan-amendment protocol are also additions of this
  port. `next` is the one-command continuation point: it reads the registry
  and any handoffs, then resumes the in-progress track, starts the next
  planned one, or offers to plan new work. The amendment protocol gives
  mid-implementation scope changes an explicit approve → apply → sync →
  commit path, so `plan.md` stays a truthful source of truth instead of
  being silently edited around.
- The Conductor panel (0.6.0) is built on the official MCP Apps SDK
  (`@modelcontextprotocol/ext-apps` 2.x, pinned in `mcp/package.json`). If
  the host lacks a capability the panel degrades gracefully: without
  resource subscriptions it falls back to manual refresh, without chat
  messaging an action copies its prompt to the clipboard instead.
- The `/conductor:architecture` command and `conductor-architecture` skill
  are a port of Matt Pocock's
  [`improve-codebase-architecture`](https://github.com/mattpocock/skills/tree/main/skills/engineering/improve-codebase-architecture)
  (MIT, © Matt Pocock). Conductor changes: the design vocabulary is inlined
  instead of a separate skill, and the grilling loop folds its decisions into
  a conductor track via the new-track flow — so approved deepening refactors
  get a spec, a phased plan and the usual implement/review/revert lifecycle.
  The HTML report stays in the OS temp directory; the durable artifact is the
  git-tracked deepening backlog (`conductor/architecture-review.md`), which
  the review skill's depth check also feeds and the panel's Architecture tab
  renders.
- The setup skill's resumption check runs its bundled `resume.py` via
  `python3`; if Python is unavailable the skill computes the same checklist
  manually, so setup works without Python too.
- The upstream Antigravity-specific rules file (`rules/conductor_antigravity.md`)
  is replaced by the `AskUserQuestion` guidance baked into every skill.

## License

Apache-2.0 — see [LICENSE](LICENSE) (from the upstream repository).
