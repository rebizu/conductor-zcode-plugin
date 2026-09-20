# conductor-zcode-plugin

[Conductor](https://github.com/gemini-cli-extensions/conductor) (Spec-Driven Development) packaged as a [ZCode](https://zcode.z.ai) plugin: turns the agent into a proactive project manager that follows a strict **Context → Spec & Plan → Implement** lifecycle for every feature or bug — and makes the project context *active* by injecting a track summary at every session start.

Upstream ships skills for Antigravity and a Claude Code marketplace manifest, but no ZCode manifest — this repo wraps the Apache-2.0 licensed skill files into ZCode plugin format and adds a session-start hook and lifecycle router that upstream lacks. Upstream's Antigravity-specific visual UX adapter (`rules/conductor_antigravity.md`) is not included; ZCode gets the plain text-menu interaction style natively.

## What the plugin provides

| Component | Source | Purpose |
| --- | --- | --- |
| `skills/conductor-setup` | upstream `skills/conductor-setup` | `/conductor:setup` — run once per project: scaffolds `conductor/product.md`, `product-guidelines.md`, `tech-stack.md`, `workflow.md`, `tracks.md`, `code_styleguides/` |
| `skills/conductor-new-track` | upstream | `/conductor:new-track` — starts a feature/bug track, generates `spec.md` + `plan.md` |
| `skills/conductor-implement` | upstream | `/conductor:implement` — works through the active track's plan, checking off tasks |
| `skills/conductor-status` | upstream | `/conductor:status` — high-level progress overview |
| `skills/conductor-revert` | upstream | `/conductor:revert` — git-aware revert of a track, phase, or task |
| `skills/conductor-review` | upstream | `/conductor:review` — reviews completed work against guidelines and the plan |
| `skills/conductor` | this repo | Lifecycle router — routes overall or ambiguous intent ("continue where we left off") to the right protocol |
| `hooks/conductor-context.mjs` | this repo | SessionStart hook: prints a compact summary (active track, next task, counts) when the project has `conductor/`; silent no-op otherwise |
| `commands/*.md` | this repo | Thin slash-command wrappers (`/conductor:setup` etc.) that invoke the corresponding skill |
| `scripts/refresh-upstream.mjs` | this repo | Re-vendors `skills/` from upstream main and re-applies the local `python` adaptation |

The `conductor/` artifacts live inside each project (workspace scope), so context is versioned with the repo and shared across the team — same as upstream.

## SessionStart context injection

Upstream conductor is *pull-only*: a fresh session knows nothing about the project until you run a command. The hook closes that gap. When a session starts in a directory containing `conductor/tracks.md`, the agent receives a few lines like:

```text
<conductor-context source="conductor/tracks.md">
Conductor project: 3 track(s), 1 complete, 1 in progress.
Active track: "Add a dark mode toggle to the settings page" (in progress).
Next task: Add toggle to settings page (3 of 5 plan tasks pending).
Continue with /conductor:implement, overview with /conductor:status.
Project context lives in conductor/: product.md, product-guidelines.md, tech-stack.md, workflow.md.
</conductor-context>
```

It is a pure file read with no dependencies (`node` only), prints nothing outside conductor projects, and never blocks the session. Disable it by disabling the plugin's hook in ZCode settings.

## Prerequisites

- `node` on PATH — the SessionStart hook runs on it (v18+).
- Python (`python --version`, 3.x) — only for the setup skill's `resume.py` resumption check; setup works without it.

## Install (local marketplace)

1. In ZCode: **Settings → Plugins** → **Discover** tab → **`+`** → add this directory (e.g. `D:\_code\conductor-zcode-plugin`).
2. Find **conductor** under the `conductor-local` marketplace → **Install** (new installs are enabled by default).
3. Restart ZCode — skills, commands and hooks snapshot at session start.

## Usage

```txt
/conductor:setup                                # once per project
/conductor:new-track "Add dark mode toggle"     # spec + plan
/conductor:implement                            # execute the plan
/conductor:status                               # progress overview
/conductor:review                               # audit against guidelines
/conductor:revert                               # undo track/phase/task
```

Natural language works too: "let's start a new track to add a login screen", "continue where we left off", "revert the last completed task" — the skill descriptions trigger automatically, with the router skill catching the ambiguous cases.

> Note: like upstream, Conductor reads and analyzes project context, specs and plans, which increases token consumption on large projects.

## Works with the other token-saving plugins

Conductor is the token-hungry one; the sibling plugins claw the tokens back:

- **rtk** — its PreToolUse hook compresses git command output automatically, and `conductor-implement` / `conductor-revert` / `conductor-review` are git-heavy (status, log, diff on every task boundary).
- **caveman** — its cavecrew subagents (`cavecrew-investigator`, `cavecrew-builder`, `cavecrew-reviewer`) compress the read/build/review phases of implement and review; caveman mode also shrinks the conductor protocols' own announcements.
- **headroom** — `headroom_compress` / `headroom_retrieve` handle large structured dumps (dependency trees, build logs) that implementation phases tend to pull in.

No configuration needed — install all four and they compose.

## Vendored files and refreshing

`skills/conductor-*` are vendored verbatim from upstream `main` at commit `6e8f9a860bcdd6a2c423473c12e745200688c633` (v0.3.0), with one local adaptation:

- `skills/conductor-setup/SKILL.md` — the resume-script call was changed from `python3 scripts/resume.py` to `python scripts/resume.py` (Windows PATH reality; the parenthetical keeps the `python3` fallback documented).

To refresh: `node scripts/refresh-upstream.mjs` — re-clones upstream, replaces `skills/`, and re-applies the adaptation. Then update the commit hash here, bump the manifest versions, and commit.

License note: vendored skills are Apache-2.0 (upstream `LICENSE`, copied here as `LICENSE-conductor`).

## Related

- Upstream conductor: https://github.com/gemini-cli-extensions/conductor
- Sibling plugins: https://github.com/rebizu/headroom-zcode-plugin, https://github.com/rebizu/caveman-zcode-plugin, https://github.com/rebizu/rtk-zcode-plugin
- ZCode plugin docs: https://zcode.z.ai/en/docs/plugin
