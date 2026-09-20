---
name: conductor:implement
description: Execute the tasks in the active conductor track's plan
---

Invoke the `conductor:conductor-implement` skill via the Skill tool and follow its protocol exactly. Pass along any scoping instructions (track, phase, or task to work on) as its input:

$ARGUMENTS

While implementing, keep the session todo list in lockstep with the track's plan.md: before the first task, mirror every pending `- [ ]` task into the session todos in plan order (one todo per task, phase names as prefix); mark a todo completed at the same moment you flip its checkbox to `[x]` in plan.md; add todos for any phases appended later (e.g. `Review Fixes`). The todo list and plan.md must never disagree.
