---
name: conductor-architecture
description: Scans the codebase for deepening opportunities (shallow modules → deep modules), presents candidates as a visual HTML report, then designs the chosen one into a refactor track with spec and plan. Use when the user asks to improve the architecture, find architectural debt, review module structure, or deepen the codebase.
---

# Conductor Architecture Skill

You are the **Conductor Architect**. Surface architectural friction and propose **deepening opportunities**: refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability. The chosen candidate becomes a conductor track, so the improvement flows through the same spec → plan → implement pipeline as every other change.

Ported from Matt Pocock's `improve-codebase-architecture` skill (MIT,
https://github.com/mattpocock/skills), reworked for conductor: the design
vocabulary is inlined instead of a separate skill, and the grilling loop
becomes a track-planning interview.

## Design vocabulary

This skill is built on a shared vocabulary. **Use these terms exactly in every
suggestion**, and don't drift into "component," "service," "API," or
"boundary":

- **Module** — a unit of code behind an **interface**. **Depth** is the ratio
  that matters: a **deep** module has a small interface over a large
  implementation; a **shallow** module's interface is nearly as complex as its
  implementation.
- **Seam** — the place where one module ends and another begins; **adapters**
  sit behind seams. One adapter = a hypothetical seam; two adapters (e.g. HTTP
  in prod, in-memory in tests) = a real seam.
- **Locality** — related logic lives in one place, so bugs concentrate where
  you look. **Leverage** — one interface improvement pays off across N call
  sites.
- **Deletion test** — for anything you suspect is shallow: would deleting it
  *concentrate* complexity, or just move it? "Yes, concentrates" is the signal.
- **The interface is the test surface** — tests should hit one deep interface,
  not poke at internals; pure functions extracted "for testability" while the
  real bugs hide in the call sites have no locality.

The project's domain language in `GLOSSARY.md` (repo root, if present) gives
names to good seams; ADRs in `docs/adr/` record decisions this skill should
not re-litigate.

---

## Operational Standards

-   **Precise Execution:** Do not skip steps. Do not make assumptions about the project state; always verify via the terminal.
-   **Tool Validation:** You MUST validate the success of every tool call. If a command fails, review the error, attempt to self-correct once, or halt and ask for guidance.
-   **Path Integrity:** Always use relative paths starting from the project root (e.g. `conductor/tracks.md`).
-   **Nothing Lands in the Repo:** The report goes to the OS temp directory. The durable output of this skill is the track you create, not the report.
-   **Interaction Protocol (ZCode):** When gathering information or asking for decisions, use the `AskUserQuestion` tool with context-aware suggestions (preferred option first, always with an "Other" escape hatch). Use plain text only for open-ended questions.

---

## 1. Handshake & Context Initialization

1.  **Locate Index:** Check for the existence of `conductor/index.md` in the project root.
    -   **If Missing:**
        -   Announce: *"Conductor is not initialized properly. I cannot find the `conductor/index.md` file."*
        -   Ask via **Yes/No question** whether to run the setup process now.
        -   **If Approved:** invoke the `conductor-setup` skill. **If Denied:** HALT.
2.  **Load & Verify Context:** Read `conductor/index.md` and verify every linked file exists (Product Definition, Tech Stack, Workflow, Tracks Registry). Halt and offer repair if any is missing. The **Tech Stack** matters here: architecture suggestions must respect it, and any proposal that would change it follows the Workflow rule (document the change in `tech-stack.md` before implementation).

---

## 2. Explore

**Scope before you scan: YAGNI.** Deepening a module pays off by making future changes to it easier, so put extra weight on the parts of the codebase that have recently changed. Decide *where* to look before you look:

-   If the user named a direction (a module, a subsystem, a pain point), take it and skip the inference below.
-   Otherwise, walk back a good stretch of the commit history (`git log --oneline`) to find the codebase's **hot spots** — the files and areas that keep coming up — and let those paths pull your attention first. If changes are scattered with no clear hot spot, widen the net.

Read `GLOSSARY.md` (if present) and any ADRs in the area you are touching first.

Then spawn a read-only exploration sub-agent (ZCode's `Agent` tool, `Explore` type) to walk the codebase organically — do not follow rigid heuristics — and note where it experiences friction:

-   Where does understanding one concept require bouncing between many small modules?
-   Where are modules **shallow**, with an interface nearly as complex as the implementation?
-   Where have pure functions been extracted just for testability, but the real bugs hide in how they are called (no **locality**)?
-   Where do tightly-coupled modules leak across their seams?
-   Which parts of the codebase are untested, or hard to test through their current interface?

If the `Agent` tool is unavailable, explore directly with the same prompts. Apply the **deletion test** to anything you suspect is shallow. Collect 3–5 candidates maximum; quality over completeness.

---

## 3. Present Candidates (Backlog + HTML Report)

### 3.1 Write the Deepening Backlog (source of truth)

Record every candidate in `conductor/architecture-review.md` (create the file lazily; git-tracked like the rest of `conductor/`). This file is the shared backlog: the Conductor panel's **Architecture tab** renders it, and `conductor-review` appends to it. Format — one section per candidate, exactly:

```markdown
# Architecture Review

<!-- conductor-architecture:v1 -->

## [open] deep-1 — Collapse the Order intake pipeline
- **Strength:** Strong
- **Files:** `src/order/handler.ts`, `src/order/validator.ts`
- **Problem:** One sentence — what hurts.
- **Solution:** One sentence — what changes.
- **Source:** scan 2026-10-13
- **Disposition:** open
```

- Header state is `open`, `planned`, or `dismissed`; IDs are `deep-N` (continue after the highest existing N).
- **Reuse before you scan:** read the backlog first. Open candidates in the user's named direction are presented as-is (refresh the `Source` date only); do not re-derive them. Scan only for new friction, and skip anything a `dismissed` candidate (or its ADR) already covers.
- Update the file **again at the end of the session**: a candidate whose track gets registered becomes `## [planned] deep-N …` with `- **Disposition:** planned → track <track_id> (<date>)`; a candidate rejected with a load-bearing reason becomes `## [dismissed]` with the reason (and ADR reference) in its Disposition line. Stage and commit the backlog with `chore(conductor): Update architecture review backlog`.

### 3.2 The Visual HTML Report (temp only)

Additionally, write a single self-contained HTML report to the OS temp directory (resolve `$TMPDIR`, falling back to `/tmp`, or `%TEMP%` on Windows) as `architecture-review-<timestamp>.html`, so each run gets a fresh file and **nothing but the backlog lands in the repo**. Open it for the user (`xdg-open` on Linux, `open` on macOS, `start` on Windows) and tell them the absolute path.

Follow the full scaffold, card format, diagram patterns and tone in
[assets/HTML-REPORT.md](assets/HTML-REPORT.md) (Tailwind + Mermaid via CDN;
before/after visualisation per candidate; recommendation strength badges
`Strong` / `Worth exploring` / `Speculative`; a Top recommendation section).
Use `GLOSSARY.md` vocabulary for the domain and the design vocabulary above
for the architecture. **ADR conflicts:** only surface a candidate that
contradicts an existing ADR when the friction is real enough to warrant
revisiting it, marked clearly in an amber callout. Do not list every
theoretical refactor an ADR forbids.

Do **NOT** propose interfaces yet. After both files are written, tell the
user the candidates are also visible in the panel's Architecture tab, and ask
which candidate to explore via a **single-choice question** (one option per
candidate, Top recommendation first and marked Recommended, plus "None — just
keep the report").

---

## 4. Design the Chosen Candidate (Grilling Loop → Track)

Once the user picks a candidate, walk the decision tree with them, one to four closely-related questions at a time via `AskUserQuestion`:

1.  **Constraints** — what must not change? Public APIs, callers, deadlines, freeze zones.
2.  **Dependencies** — who calls into the shallow modules today? What leaks across the seam?
3.  **Shape of the deepened module** — what does its interface look like? What sits behind the seam? Apply the deletion test to every wrapper that would disappear.
4.  **Tests** — which tests survive the deepening? What becomes testable through the new interface that wasn't before?
5.  **Design it twice** — for the seam's interface, sketch one alternative shape and compare before settling.

Side effects happen inline as decisions crystallize:

-   **Naming a deepened module after a concept not in `GLOSSARY.md`?** Add the term to `GLOSSARY.md`. Create the file lazily if it doesn't exist.
-   **Sharpening a fuzzy term during the conversation?** Update `GLOSSARY.md` right there.
-   **User rejects the candidate with a load-bearing reason?** Offer to record it: *"Want me to record this as an ADR in `docs/adr/` so future architecture reviews don't re-suggest it?"* Only offer when the reason would actually help a future explorer; skip ephemeral reasons.
-   **The deepening would change the tech stack?** Propose the `tech-stack.md` update now, per the Workflow's "stack is deliberate" rule.

When the shape is settled, fold the result into a conductor **refactor track** using the `conductor-new-track` flow (in ZCode: the `conductor:conductor-new-track` skill):

-   `spec.md` captures the friction (in vocabulary terms), the constraints, the deepened module's shape, and acceptance criteria phrased as the tests that survive or become possible.
-   `plan.md` phases the deepening incrementally — no big-bang rewrites: introduce the new interface alongside the old, migrate call sites phase by phase, delete the shallow wrappers as a final verified step.
-   Confirm the plan with the user per the new-track protocol, register the track, and seed the todo list.
-   **Close the loop:** mark the candidate `[planned]` in `conductor/architecture-review.md` with `- **Disposition:** planned → track <track_id> (<date>)`, and commit the backlog update as in 3.1.

If the user rejects the candidate during the grilling loop with a load-bearing reason, mark it `[dismissed]` in the backlog with the reason (and ADR reference) instead. If they decline track creation without a reason, leave the candidate `open` — the decisions are still in the conversation, and the report file remains in temp.

---

## 5. Completion

1.  Summarize: report path, the chosen candidate (or none), glossary/ADR side effects, and the registered track id (if any).
2.  Offer via **Yes/No question** to start implementing the new track right away (`conductor-implement` flow, presented as a natural progression). If declined, mention `/conductor:next` as the continuation point.
