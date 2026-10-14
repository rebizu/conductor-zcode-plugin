---
name: conductor-handoff
description: Writes a session handoff note (conductor/tracks/<track_id>/handoff.md) capturing the active track's resume pointer, working state, decisions and gotchas, so a fresh session or another agent can resume exactly where this one stopped. Use when the user wraps up a session, says "hand off", "end of day", "continue tomorrow", "save the context", or is about to run out of context mid-track.
---

# Conductor Handoff Skill

You are the **Conductor Handoff Writer**. Your goal is to capture the current session's working state for one active track in a durable handoff note, so a future session can resume the track exactly where this one stopped. This document is your operational protocol: adhere to it precisely and sequentially.

## Operational Standards

-   **Precise Execution:** Do not skip steps. Do not make assumptions about the project state; always verify via the terminal.
-   **Tool Validation:** You MUST validate the success of every tool call. If a command fails, review the error, attempt to self-correct once, or halt and ask for guidance.
-   **Path Integrity:** Always use relative paths starting from the project root (e.g., `conductor/tracks.md`).
-   **Annotation, Not Truth:** The handoff note is an annotation. The track's `plan.md` (checkboxes and commit SHAs) always remains the single source of truth. Where the note and the files disagree, the files win — and the note gets overwritten at the next handoff.
-   **Interaction Protocol (ZCode):** When gathering information or asking for decisions, you MUST provide either **single-choice** or **multiple-choice** options based on context-aware suggestions. If a specific option is preferred based on project standards or best practices, list it first, suffix it with '(Recommended: *<explanation>*)' providing a brief, context-rich explanation in italics inside the parentheses. You MUST always include a custom or "Other" option to allow user-defined input (ZCode's `AskUserQuestion` tool provides this automatically). Avoid asking raw, open-ended questions without suggestions.
-   **Native Question Tool:** In ZCode, render all single-choice, multiple-choice and Yes/No questions with the `AskUserQuestion` tool so they appear as native selectable options in the client. Use plain chat text only for open-ended questions (free-form descriptions) or when `AskUserQuestion` is unavailable.
-   **Sequential Questioning (CRITICAL):** When interacting via standard text chat (no `AskUserQuestion` tool available), you MUST ask questions strictly one at a time and wait for the user's response before proceeding to the next question. Do NOT output multiple questions in a single chat response.

---

## 1. Handshake & Context Initialization

Before writing the handoff, you MUST locate and read the project's foundational context.

1.  **Locate Index:** Check for the existence of `conductor/index.md` in the project root.
    -   **If Missing:**
        -   Announce: *"Conductor is not initialized properly. I cannot find the `conductor/index.md` file."*
        -   Ask the user using a **Yes/No question** if they would like to run the setup process now to initialize Conductor.
        -   **If Approved:** Internally invoke the `conductor-setup` skill (in ZCode: the `conductor:conductor-setup` skill).
        -   **If Denied:** HALT and await further instructions.

2.  **Load & Verify Context:** Read `conductor/index.md` and use the provided links to locate the core files:
    -   **Tracks Registry** (`tracks.md`)
    -   **Product Definition** (`product.md`)
    -   **Tech Stack** (`tech-stack.md`)
    -   **Workflow** (`workflow.md`)
    -   **Health Check:** You MUST verify that every linked file actually exists. If ANY of these core files are missing, HALT immediately. Announce which file is missing and ask the user if they would like to run the setup process to repair the environment.

---

## 2. Track Selection

Adhere to this sequence to identify the track to hand off.

1.  **Check for User Input:** First, check if the user provided a track name in their request.

2.  **Locate and Parse Tracks Registry:**
    -   Locate the **Tracks Registry** (Default: `conductor/tracks.md`).
    -   **Parsing Logic:** Look for lines matching either the new standard format `--- - [ ] **Track:` (a leading `---` prefix is part of the canonical entry) or the legacy format `## [ ] Track:`, and read each track's status (`[ ]`, `[~]`, `[x]`) and folder link.

3.  **Select Track:**
    -   **If a track name was provided:**
        -   Search for a match in the parsed registry.
        -   **If a unique match is found:** Confirm with a **Yes/No question**.
        -   **If no match or ambiguous:** Ask the user to clarify via an **open question** or a **multiple-choice** list of in-progress tracks.
    -   **If no track name was provided:** select among tracks marked `[~]` (in progress):
        -   **Exactly one:** Propose it and confirm with a **Yes/No question**.
        -   **Several:** Present a **multiple-choice** list.
        -   **None:** Announce that handoff notes are intended for in-progress work. If the registry has incomplete (`[ ]`) tracks, ask via a **Yes/No question** whether to hand off one of those anyway (they may hold uncommitted planning decisions), otherwise HALT. If the registry is empty or missing, announce that no tracks are available and HALT.

---

## 3. Gather Session State

Adhere to this sequence to collect what the note must contain.

1.  **Load Track Plan:** Identify the track folder from the registry to get the `<track_id>` (check the track's `index.md` for links, or use the default path `conductor/tracks/<track_id>/`). Read the track's `plan.md` and identify the current phase and the task marked `[~]` (in progress). If no task is `[~]`, set the resume pointer to the first `[ ]` task. If that task is marked `[!]` (blocked), say so in the **Next concrete action** (e.g. "blocked on X — unblock first").

2.  **Working State:** Run `git branch --show-current` and `git status`. Record the branch name, and for each uncommitted or modified file, its path and — if inferable — why it is dirty (e.g., WIP for the current task, unrelated change). This matters because the next session may start on a dirty tree and must not misread WIP as its own.

3.  **Test State:** Record the last known test result for the track. If the **Workflow** defines a test command and no result is known from this session, ask via a **Yes/No question** whether to run the test suite once now. Do NOT block the handoff on failures — record them as-is.

4.  **Tacit Knowledge:** Compile from the session so far:
    -   **Decisions:** choices made in conversation that are not yet recorded in `spec.md`/`plan.md`, each with its rationale.
    -   **Gotchas:** environment quirks, flaky tests, required env vars, workarounds discovered.
    -   **Dead ends:** approaches tried and rejected, with the reason, so the next session does not retry them.

5.  **User Confirmation:** In plain chat, ask the user one **open question**: what else from this session should the next session know that is not captured above? Incorporate the answer. If the user has nothing to add, continue.

---

## 4. Write the Handoff Note

1.  **Announce Action:** Announce that you are writing `conductor/tracks/<track_id>/handoff.md` and that it is an annotation: `plan.md` remains the source of truth.

2.  **Overwrite the File (CRITICAL):** Write the note to `conductor/tracks/<track_id>/handoff.md`, replacing any previous version wholesale. NEVER append to an existing handoff — a stale accreting note contradicts the plan.

3.  **Template:** Use exactly this structure, filling every section (write "None" rather than omitting a section):

    ```markdown
    # Session Handoff — <track_description>

    _Written <YYYY-MM-DD HH:MM>. Annotation only — `plan.md` checkboxes and
    commit SHAs are the source of truth. Delete this file once consumed._

    ## Resume pointer

    - **Phase:** <phase title>
    - **Task:** "<task title>" (`[~]`)
    - **Next concrete action:** <one imperative sentence>

    ## Done since the last checkpoint

    - <work completed and its commit SHA(s) since the last `[x]` task, if any>

    ## Working state

    - **Branch:** `<branch>` — <clean | N uncommitted files>
        - `<path>` — <why it is dirty>
    - **Tests:** <passing | failing (<which>) | not run this session>

    ## Decisions & gotchas (not yet in spec.md / plan.md)

    - **<decision or gotcha>** — <rationale / detail>

    ## Dead ends — do not retry

    - <approach tried and rejected> — <why>
    ```

---

## 5. Commit

1.  Stage ONLY the handoff file (`git add conductor/tracks/<track_id>/handoff.md`) and commit: `chore(conductor): Add session handoff for track '<track_description>'`.
    -   **CRITICAL:** The working tree likely holds the user's WIP — that work is *described* in the note, never committed by the handoff. Never use `git add -A` or `git add .`.

---

## 6. Close Out

1.  **Confirm:** Present a short summary of the note (resume pointer, dirty files, test state).
2.  **Resume Instructions:** Tell the user how to continue: in a fresh session (or on another machine/agent), run `/conductor:implement <track>` — the implementer reads `handoff.md` automatically, and offers to delete it once the pointed-to task is completed. `/conductor:status` also reports the note.
