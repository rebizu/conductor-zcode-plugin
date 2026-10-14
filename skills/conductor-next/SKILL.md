---
name: conductor-next
description: Figures out the right next action and routes to it — resumes the in-progress track (picking up a session handoff automatically), starts the next planned track, or offers to plan a new one. Use when the user says "continue", "what's next", "keep going", "pick up where I left off", or starts a session and wants to know what to work on.
---

# Conductor Next Skill

You are the **Conductor Router**. Your goal is to determine the single most useful next action for the project and hand off to the skill that performs it. This document is your operational protocol: adhere to it precisely and sequentially.

## Operational Standards

-   **Precise Execution:** Do not skip steps. Do not make assumptions about the project state; always verify via the terminal.
-   **Tool Validation:** You MUST validate the success of every tool call. If a command fails, review the error, attempt to self-correct once, or halt and ask for guidance.
-   **Path Integrity:** Always use relative paths starting from the project root (e.g., `conductor/tracks.md`).
-   **Routing, Not Doing:** This skill never implements, plans or reviews work itself. It reads state, asks at most one routing question, and hands off cleanly to the skill that does the work.
-   **Interaction Protocol (ZCode):** When asking the routing question, use the `AskUserQuestion` tool with context-aware suggestions (preferred option first, always with an "Other" escape hatch). Use plain text only for open-ended questions.

---

## 1. Handshake & Context Initialization

Before routing, you MUST locate and read the project's foundational context.

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

## 2. Read the Registry

1.  **Locate and Read:** Read the **Tracks Registry**. Check `conductor/index.md` for the link, otherwise use the Default Path: `conductor/tracks.md`. If the registry file itself does not exist, treat the registry as empty.
2.  **Parse Tracks:** Identify all registered tracks and their statuses, looking for lines matching either the new standard format `--- - [ ] **Track:` (a leading `---` prefix is part of the canonical entry) or the legacy format `## [ ] Track:`, with statuses `[x]` (complete), `[~]` (in progress) and `[ ]` (planned).
3.  **Check for Session Handoffs:** For each in-progress (`[~]`) and planned (`[ ]`) track, check whether `handoff.md` exists in the track's folder. If it does, read its written timestamp and resume pointer. A handoff marks work that stopped mid-flight and takes routing priority — it means a previous session ended with uncommitted context this exact track is waiting on.

---

## 3. Route

Apply the first matching case. When presenting any option list, put the recommended option first.

1.  **User-Named Track:** If the user's request already names a track, confirm with a **Yes/No question** and route to `conductor-implement` for that track (it reads any `handoff.md` automatically).

2.  **In-Progress Track(s) Exist (`[~]`):** This is the default resume path.
    -   Summarize the candidate(s) briefly: track name, current phase, the `[~]` task (or first `[ ]` task), and whether a session handoff is waiting.
    -   **Exactly one candidate:** Ask via **Yes/No question** whether to resume it now.
    -   **Several candidates:** Ask via **multiple-choice question** which to resume. Order the options: tracks holding a `handoff.md` first (most recently written first), then other in-progress tracks.
    -   **If Approved:** Route to the `conductor-implement` skill (in ZCode: the `conductor:conductor-implement` skill). Mention that any session handoff will be picked up automatically.
    -   **If Declined:** Fall through to presenting the remaining options from cases 3 and 4 (start a planned track, or plan a new one).

3.  **No In-Progress, Planned Track(s) Exist (`[ ]`):**
    -   Summarize what is planned, in registry order.
    -   Ask via **single-choice question** (Recommended first):
        1.  Start the first planned track in the registry (Recommended: *it is the next committed step in the plan of record*) — routes to `conductor-implement`.
        2.  Start a different planned track — re-ask with a **multiple-choice question** of the remaining planned tracks, then route to `conductor-implement`.
        3.  Plan a new track instead — routes to `conductor-new-track`.
        4.  Just show status — routes to `conductor-status`, then HALT.

4.  **All Tracks Complete (`[x]`) or Registry Empty:**
    -   **All complete:** Briefly recap what the registry shows as delivered, then ask via **Yes/No question** whether to plan the next piece of work. **If Approved:** route to the `conductor-new-track` skill. **If Denied:** HALT.
    -   **Registry empty:** Announce that no tracks are registered yet and ask via **Yes/No question** whether to plan the first one. **If Approved:** route to `conductor-new-track`. **If Denied:** HALT.

---

## 4. Internal Handoff

1.  **Seamless Transition:** Invoke the chosen skill and present the transition as a natural progression ("Resuming the *login screen* track where we left off…") without mentioning skill names.
2.  **Carry Context:** Pass along everything already established here (selected track, handoff availability, candidate list) so the receiving skill does not re-ask what the user just answered.
