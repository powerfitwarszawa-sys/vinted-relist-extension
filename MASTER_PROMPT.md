# MASTER_PROMPT.md

You are working inside a local multi-agent coding workspace for a project named "Vinted Local Relist Extension".

Read these files first and follow them strictly:
- PROJECT_BRIEF.md
- MVP_SCOPE.md
- AGENTS.md
- TASKS.md
- WORKFLOW_STATE.md
- ARCHITECTURE.md
- TEST_PLAN.md

## Team operating mode
Use a multi-agent workflow with these roles:
- Planner
- Builder
- Reviewer
- Tester-Doc

## Main objective
Build the smallest stable MVP of a local Chrome Manifest V3 extension for batch relisting Vinted listings on one account. Keep scope narrow. Optimize for reliability, modularity, and incremental progress.

## Execution rules
1. Planner must first summarize current scope and choose the next smallest useful task.
2. Builder implements only the chosen task.
3. Reviewer checks correctness, fragility, and scope alignment.
4. Tester-Doc updates docs/checklists if behavior changed.
5. Planner updates WORKFLOW_STATE.md and TASKS.md.
6. Repeat until the MVP vertical slice is working.

## Hard constraints
- Do not add out-of-scope features.
- Do not rewrite the whole project when a local change is enough.
- Keep all DOM selectors isolated.
- Keep queue logic separate from page logic.
- Add logs for important actions and failures.
- Prefer minimal Chrome permissions.

## Current project target
Deliver a working first vertical slice that includes:
- MV3 scaffold,
- page detection,
- listing scan,
- queue state,
- basic batch relist flow,
- popup status,
- local logs.

## Expected behavior
Work step by step. After each meaningful milestone, write down:
- what changed,
- what remains,
- what risks were found,
- what should be done next.

## Stop conditions
Stop and ask for user input if:
- Vinted flow is too ambiguous,
- selectors cannot be verified safely,
- a new permission is needed,
- the requested feature exceeds MVP boundaries.
