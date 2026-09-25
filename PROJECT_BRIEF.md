# PROJECT_BRIEF.md

## Project name
Vinted Local Relist Extension

## Goal
Build a local Chrome Extension (Manifest V3) for personal use that helps manage around 200 Vinted listings on one account. The first production goal is a stable MVP for batch relisting selected listings with local logs, pause/resume, safe delays, and a simple control panel.

## Product vision
The project should start as a narrow, stable tool that does one core job well: relist listings in controlled batches. The codebase must be modular so that later versions can add scheduler, backup, message templates, AI replies, and multi-account support without major rewrites.

## User profile
Single advanced technical user, comfortable with TypeScript, browser extensions, automation, debugging, terminal workflows, and local development.

## Main operating assumptions
- Local-only workflow.
- One main Vinted account in the first version.
- Approximately 200 active listings.
- No backend required in MVP.
- State stored locally in `chrome.storage.local`.
- Chrome Extension Manifest V3.
- Content-script-driven automation.

## Core business need
The user needs a faster and repeatable way to refresh or relist listings in batches, with control over speed and clear logs, instead of relying on limited third-party tools.

## Success criteria for MVP
The MVP is successful if it can:
- detect relevant Vinted pages,
- scan visible user listings,
- let the user select listings,
- run relist actions in batches,
- enforce delays and safe pacing,
- persist queue state locally,
- resume an interrupted queue,
- display logs and current status.

## Explicit non-goals for MVP
Do not build these in the first version unless specifically requested later:
- AI-generated messages,
- automatic offers,
- inbox automation,
- analytics backend,
- cloud sync,
- multi-account management,
- server-side orchestration,
- payment or subscription features.
