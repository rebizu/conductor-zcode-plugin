---
name: conductor-status
description: Displays the current progress of the project by parsing the Tracks Registry and individual track plans. Use when the user asks for project status, track progress, or what is next.
---

# Conductor Status Skill

You are an AI agent. Your primary function is to provide a status overview of the project by parsing the Tracks Registry and individual track plans.

## Operational Standards

-   **Precise Execution:** Do not skip steps. Do not make assumptions about the project state; always verify via the terminal.
-   **Tool Validation:** You MUST validate the success of every tool call. If a command fails, review the error, attempt to self-correct once, or halt and ask for guidance.
-   **Path Integrity:** Always use relative paths starting from the project root (e.g., `conductor/tracks.md`).
-   **Interaction Protocol (ZCode):** When gathering information or asking for decisions, use the `AskUserQuestion` tool with context-aware suggestions (preferred option first, always with an "Other" escape hatch). Use plain text only for open-ended questions.

---

## 1. Handshake & Context Initialization

Before starting the status overview process, you MUST locate and read the project's foundational context.

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

## 2. Status Overview Protocol

Follow this sequence to provide a status overview.

### 2.1 Read Project Plan
1.  **Locate and Read:** Read the content of the **Tracks Registry**. Check `conductor/index.md` for the link, otherwise use the Default Path: `conductor/tracks.md`.
2.  **Locate and Read Tracks:**
    -   Parse the **Tracks Registry** to identify all registered tracks and their paths.
        *   **Parsing Logic:** When reading the **Tracks Registry** to identify tracks, look for lines matching either the new standard format `--- - [ ] **Track:` (a leading `---` prefix is part of the canonical entry) or the legacy format `## [ ] Track:`.
    -   For each track, resolve and read its **Implementation Plan**. Check the track's `index.md` for the link, otherwise use the Default Path: `conductor/tracks/<track_id>/plan.md`.

### 2.2 Parse and Summarize Plan
1.  **Parse Content:**
    -   Identify major project phases/sections (e.g., top-level markdown headings).
    -   Identify individual tasks and their current status by looking for checkbox markers: `[x]` for completed, `[~]` for in-progress, `[!]` for blocked, and `[ ]` for pending.
2.  **Generate Summary:** Create a concise summary of the project's overall progress. This should include:
    -   The total number of major phases.
    -   The total number of tasks.
    -   The number of tasks completed, in progress, and pending.

### 2.3 Present Status Overview
1.  **Output Summary:** Present the generated summary to the user in a clear, readable format. The status report must include:
    -   **Current Date/Time:** The current timestamp.
    -   **Project Status:** A high-level summary of progress (e.g., "On Track", "Behind Schedule", "Blocked").
    -   **Current Phase and Task:** The specific phase and task currently marked as in progress.
    -   **Next Action Needed:** The next task listed as pending.
    -   **Blockers:** Any tasks marked `[!]` in `plan.md`, with their blocker reason.
    -   **Session Handoff:** Whether the in-progress track has a `handoff.md` in its track folder and, if so, the date it was written.
    -   **Phases (total):** The total number of major phases.
    -   **Tasks (total):** The total number of tasks.
    -   **Progress:** The overall progress of the plan, presented as tasks_completed/tasks_total (percentage_completed%).

### 2.4 Sync ZCode's Todo List (optional)
1.  If the `TodoWrite` tool is available and the session todo list is stale relative to the active (in-progress) track's `plan.md` — or empty while a task is marked `[~]` — offer to refresh it, or simply refresh it when the user asks for an accurate view.
2.  Rebuild the list with one entry per task (phase-prefixed), mapping `[ ]` → `pending`, `[~]` → `in_progress`, `[x]` → `completed`. `TodoWrite` replaces the whole list, so always send the complete list.
3.  `plan.md` remains the source of truth; the todo list is only the live mirror.
