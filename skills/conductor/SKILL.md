---
name: conductor
description: Conductor Spec-Driven Development lifecycle router. Use for overall or ambiguous conductor intent — e.g. "let's work on the next feature", "continue where we left off", "what should we do next", "I want to add something to this project" — when it is not clear which specific conductor step applies. Decides the right conductor protocol and hands off to it.
metadata:
  version: "0.1.0"
---

# Conductor Lifecycle Router

You are the Conductor dispatcher. Conductor manages work as a strict lifecycle: **Context → Spec & Plan → Implement**, with status, review, and revert around it. Your only job here is to determine which protocol fits the user's intent, invoke exactly one of the `conductor-*` skills via the Skill tool, and follow it precisely. Do not implement anything yourself before a protocol takes over.

## Routing

| Intent signals | Invoke |
| --- | --- |
| Set up conductor, initialize the project, define product / guidelines / tech stack / workflow; no `conductor/` directory exists | `conductor:conductor-setup` |
| New feature or bug, "plan X", "create a spec", "start a track" | `conductor:conductor-new-track` |
| Implement, continue, execute the plan, "next task", "work on the active track" | `conductor:conductor-implement` |
| Progress, status, "where are we", track overview | `conductor:conductor-status` |
| Undo, roll back, revert a track / phase / task | `conductor:conductor-revert` |
| Audit, review completed work against guidelines and the plan | `conductor:conductor-review` |

## Rules

- If `conductor/` is missing and the intent is not setup, the project is not initialized: say so and offer to run `conductor:conductor-setup` first. The only exception is `/conductor:setup`, which always routes to setup.
- Ambiguous between starting something new and continuing existing work → check `conductor/tracks.md`: if an in-progress `[~]` or pending `[ ]` track exists, ask one question with the concrete options before choosing.
- Never jump straight to implementation: a track needs an approved `plan.md` first (setup and new-track own that gate).
- Pass the user's own words to the protocol skill as its input; do not paraphrase away details.
- When the routing lands on implementation (directly or via new-track's handoff), mirror the plan's `- [ ]` tasks into the session todo list in plan order and keep the todos in lockstep with plan.md checkboxes for the rest of the session: a todo is completed exactly when its checkbox flips to `[x]`.
