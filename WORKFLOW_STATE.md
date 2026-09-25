# WORKFLOW_STATE.md

## Current phase
Project version **v0.3.1**. Phase 19 hardens relist data integrity and UI queue safety: DOM fallback is wardrobe-only, photo publication requires a complete reupload, confirmed replacement IDs retain cooldown across scans, pagination follows the server page size, and a new UI action cannot replace pending work.

## Current task
Reload the extension and run one controlled real-listing E2E: scan the own wardrobe, verify hidden status badges, relist one active item with all photos, confirm a different new listing ID, rescan, and verify the replacement retains its cooldown. Also confirm starting a second batch while one is running shows an error without clearing the active queue.

## Last completed task
Completed Phase 19 safeguards with pure safety-policy tests and a real storage-backed cooldown regression. `npm run typecheck`, `npm run build`, and `npm test` pass (192 assertions); the new `relist-safety.ts` and changed `scan-cache.ts` pass scoped ESLint. Logged-in Chrome E2E remains manual.

## Active risks
- A mid-action service-worker restart cannot prove whether Vinted completed the external action. The queue now fails closed and requires manual verification rather than risking an automatic duplicate.
- Relist flow still needs one real detail-page test on the logged-in Vinted account.
- The auto-relist cycle and the backup-outcome recording are code-verified only; manually confirm the alarm fires, backups show outcomes after a real run, and the options saved-scan panel behaves.
- A real relist can only be marked successful if Vinted exposes/navigates to a new `/items/<id>` URL; otherwise the MVP correctly fails closed as `relist-not-confirmed`.
- The real relist button selector may still need adjustment from pasted button-list logs.
- API fallback and photo reupload/completion are code-verified only; the API fallback does not delete the original listing.
- The full wardrobe API scan is code-verified only; on any API failure the extension falls back to visible/current-DOM scanning and logs the reason.
- The saved scan snapshot is renewed only on manual scans; the automatic cycle refuses to run on a scan older than 7 days (reason logged).
- The extension must be reloaded in `chrome://extensions/` after this build; the visible version should be `v0.3.1`. Vinted tabs must be refreshed so the updated content script is injected.
- ESLint still reports a pre-existing backlog across source files; TypeScript, tests, and builds remain the current verification gate (see REFACTORING_ROADMAP.md, Tor C).
- AI messages, offers, follow/visibility, and multi-account remain post-MVP modules.

## Open decisions
- Whether the saved scan snapshot should be refreshed automatically (e.g. opening a background Vinted tab on a stale scan) or kept manual-only for safety.
- Whether to hide or delete the original listing after a successful API-fallback publish (deletion stays disabled by default).
- Whether to add CSV export to the dashboard backups tab (popup already has JSON + CSV).
- Which post-MVP module should be implemented first after manual relist E2E is confirmed: offers draft mode, AI message draft mode, or multi-account foundations.

## Notes for agents
- Stay inside the current scope: manual + scheduled relist on one local account.
- Prefer working end-to-end skeleton over deep but isolated modules.
- Every completed task must update this file.