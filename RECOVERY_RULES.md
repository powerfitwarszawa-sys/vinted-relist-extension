# RECOVERY_RULES.md

## Purpose
This file defines what agents must do when work stalls, a subtask fails, a model stops responding, or progress becomes unclear.

## Core recovery principle
Do not stay blocked indefinitely. If progress stops, preserve state, mark the blocker, restart the task flow in a controlled way, and continue with the next safe step.

## Stall detection rules
Treat work as stalled when any of the following is true:
- the same task loops without meaningful file changes,
- the active agent stops responding,
- implementation attempts fail repeatedly for the same reason,
- tests fail repeatedly without a new hypothesis,
- selectors or flows cannot be verified safely,
- the agent no longer knows the next concrete action.

## Recovery sequence
When stalled:
1. Write the current status to `WORKFLOW_STATE.md`.
2. Record the blocker, affected files, and latest hypothesis.
3. Mark the current task in `TASKS.md` as blocked or partial.
4. Attempt one controlled restart of the current task.
5. If the restart still fails, reduce scope and continue with the next safe, independent task.
6. Escalate to the user only if the blocker prevents all meaningful progress.

## Controlled restart rules
A controlled restart means:
- re-read all context files,
- re-state the current task in one paragraph,
- preserve completed work,
- avoid rewriting unrelated modules,
- retry with a smaller change set,
- document what changed compared to the failed attempt.

## Retry limits
- Maximum 2 implementation attempts for the same blocker.
- Maximum 2 selector fixes before escalation.
- Maximum 2 failing test cycles without a new diagnosis.
- After that, switch to recovery mode and move forward where possible.

## Forward progress rules
If the blocked task is not essential for the next independent task:
- skip it temporarily,
- create a follow-up TODO,
- continue with the next task that still advances the MVP.

Examples:
- If overlay styling is blocked, continue with queue storage.
- If one selector is unstable, continue with logging or popup status.
- If resume flow is blocked, continue with manual pause and queue persistence.

## Mandatory logging on failure
When a stall happens, agents must record:
- current task,
- what was attempted,
- why it failed,
- files touched,
- recommended next step,
- whether restart succeeded.

## Human escalation conditions
Ask the user only when:
- Vinted flow cannot be inferred safely,
- a permission change is required,
- all remaining tasks depend on the blocked task,
- there is risk of breaking working behavior without verification.

## Anti-freeze rule
No agent may remain indefinitely on the same task without either:
- producing a concrete code change,
- updating workflow state,
- restarting in controlled mode,
- or escalating with a clear blocker report.
