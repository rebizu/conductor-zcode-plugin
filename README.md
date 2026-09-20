# conductor-zcode-plugin

[Conductor](https://github.com/gemini-cli-extensions/conductor) (Spec-Driven Development) packaged as a [ZCode](https://zcode.z.ai) plugin: turns the agent into a proactive project manager that follows a strict **Context → Spec & Plan → Implement** lifecycle for every feature or bug.

Upstream ships skills for Antigravity and a Claude Code marketplace manifest, but no ZCode manifest — this repo wraps the Apache-2.0 licensed skill files into ZCode plugin format. Upstream's Antigravity-specific visual UX adapter (`rules/conductor_antigravity.md`) is not included; ZCode gets the plain text-menu interaction style natively.

## What the plugin provides

| Component | Source | Purpose |
| --- | --- | --- |
| `skills/conductor-setup` | upstream `skills/conductor-setup` | `/conductor:setup` — run once per project: scaffolds `conductor/product.md`, `product-guidelines.md`, `tech-stack.md`, `workflow.md`, `tracks.md`, `code_styleguides/` |
| `skills/conductor-new-track` | upstream | `/conductor:new-track` — starts a feature/bug track, generates `spec.md` + `plan.md` |
| `skills/conductor-implement` | upstream | `/conductor:implement` — works through the active track's plan, checking off tasks |
| `skills/conductor-status` | upstream | `/conductor:status` — high-level progress overview |
| `skills/conductor-revert` | upstream | `/conductor:revert` — git-aware revert of a track, phase, or task |
| `skills/conductor-review` | upstream | `/conductor:review` — reviews completed work against guidelines and the plan |
| `commands/*.md` | this repo | Thin slash-command wrappers (`/conductor:setup` etc.) that invoke the corresponding skill; supports natural-language triggering too |

The `conductor/` artifacts live inside each project (workspace scope), so context is versioned with the repo and shared across the team — same as upstream.

## Prerequisites

None beyond ZCode itself. `skills/conductor-setup/scripts/resume.py` runs under Python (`python --version` — 3.x) if the setup skill's resumption check needs it; the skill works without it when Python is absent.

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

Natural language works too: "let's start a new track to add a login screen", "start implementing the active plan", "revert the last completed task" — the skill descriptions trigger automatically.

> Note: like upstream, Conductor reads and analyzes project context, specs and plans, which increases token consumption on large projects.

## Vendored files and refreshing

`skills/` is vendored verbatim from upstream `main` at commit `6e8f9a860bcdd6a2c423473c12e745200688c633` (v0.3.0), with one local adaptation:

- `skills/conductor-setup/SKILL.md` — the resume-script call was changed from `python3 scripts/resume.py` to `python scripts/resume.py` (Windows PATH reality; the parenthetical keeps the `python3` fallback documented). Re-apply this line after refreshing from upstream.

To refresh the vendored skills, re-copy `skills/` from upstream and re-apply the adaptation above.

License note: vendored skills are Apache-2.0 (upstream `LICENSE`, copied here as `LICENSE-conductor`).

## Related

- Upstream conductor: https://github.com/gemini-cli-extensions/conductor
- Sibling plugins: https://github.com/rebizu/headroom-zcode-plugin, https://github.com/rebizu/caveman-zcode-plugin, https://github.com/rebizu/rtk-zcode-plugin
- ZCode plugin docs: https://zcode.z.ai/en/docs/plugin
