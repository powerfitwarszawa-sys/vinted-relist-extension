# TASKS.md

## Phase 1 — Foundation
- [x] Create MV3 extension scaffold.
- [x] Add `manifest.json` with minimal permissions.
- [x] Add TypeScript project structure.
- [x] Create shared contracts and storage helpers.
- [x] Add logging utility.

## Phase 2 — Page integration
- [x] Detect relevant Vinted pages.
- [x] Inject content script safely.
- [x] Add basic overlay mount point.
- [x] Build listing scanner.
- [x] Normalize listing data model.

## Phase 3 — Relist engine
- [x] Create queue model.
- [x] Add batch relist runner (DOM executor wired via active-tab messaging).
- [x] Add delay and jitter handling.
- [x] Add pause/resume flow.
- [x] Persist queue state to local storage.

## Phase 4 — UI
- [x] Build popup dashboard.
- [x] Show queue status and recent logs.
- [x] Add options page with safe-mode controls.
- [x] Add actions: scan, clear queue, pause, resume.
- [x] Add selection model in popup so user chooses which listings to relist.

## Phase 5 — Hardening
- [x] Add structured error codes.
- [x] Improve selector abstraction (selectors validated on real Vinted page).
- [x] Add recovery behavior after refresh.
- [x] Add manual test checklist.
- [x] Update README with install steps.

## Current E2E follow-up
- [ ] Blocked pending manual E2E on logged-in Vinted: reload extension, rerun Scan, select one listing, click **Relist selected**, verify backup, and paste logs.
- [x] Fixed observed sample parsing issue where fallback titles included metadata/price and price parsed as `0 Ukrytewkatalogu`.
- [x] Added scan sample logging for up to 3 extracted listings so manual E2E can verify id/title/price/currency quality.
- [x] Manual scan confirmed on `https://www.vinted.pl/member/107890191`: fallback found 20 listing link containers and extracted 20 listings.
- [x] Fixed observed scan extraction issue where primary card selector found 0 items by adding a listing-link fallback with duplicate ID filtering.
- [x] Fixed observed service worker queue initialization error by replacing dynamic queue storage imports with static imports.
- [x] Fixed observed `Receiving end does not exist` scan failure by registering the content-script message bridge before dynamic module initialization and exposing content/core modules as Vinted-only web-accessible resources.
- [x] Fixed runtime module loading: build now rewrites relative ES module imports in `dist` to include `.js`, so popup/background/content modules can load in Chrome.
- [x] Fixed observed popup issue where clicking Scan could appear to do nothing by logging scan counts/failures and refreshing after action errors.
- [x] Fixed MVP blocker: popup had no way to enqueue listings or start relisting. Added **Relist** button (scan → add to queue → resume) and background navigation to each listing detail page before executing the relist action.
- [x] Added minimal selection model to the popup: checkbox list after Scan, only selected listings are queued, and the button shows the selected count.
- [x] Fixed real E2E issue: detail-page guard rejected Vinted slug URLs (`/items/<id>-<slug>`) because it compared exact pathnames. Now it compares listing IDs.
- [x] Fixed real E2E issue: stale queue items caused the wrong listing to open when user selected a different one. **Relist selected** now clears the queue before enqueueing the current selection.
- [x] Redesigned popup UI to match the Vinted items-list layout: dark header, toolbar, status bar, table rows with thumbnails, titles, prices, and status badges.
- [x] Fixed missing thumbnails: scanner now reads `currentSrc`, `src`, `data-src`, `data-lazy-src`, `data-original`, and `srcset`.
- [x] Fixed generic relist error message in popup: background now surfaces the actual `result.message` from the content script.
- [x] Fixed real E2E issue: detail-page marker `[data-testid="item-details"]` does not exist on Vinted. Replaced with fallback selector group.
- [x] Fixed real E2E issue: queue scheduled a step but service worker died before setTimeout fired. Replaced setTimeout with chrome.alarms so the service worker is woken for each step.
- [x] Fixed real E2E issue: navigation reaches detail page but relist button selector did not match. Added multi-selector + Polish text fallback for finding the relist button.
- [x] Added debug logging that lists available buttons on the detail page when the relist button is not found, so we can identify the real selector without DevTools.
- [x] Fixed log level: button list is now logged as info so it appears in the popup.
- [ ] Next manual E2E step: reload extension, rerun Scan, select one listing, click **Relist selected**, allow navigation, and paste the resulting logs (including the button list).

## Phase 6 — Premium polish (v0.2.0)
- [x] Finalized v0.2.0 visual popup polish: Vinted-style table, thumbnails, status badges, progress bar, preview modal, icons, and clearer controls
- [x] Corrected README install path: load the project root folder, not `dist/`
- [x] Optimized logger: in-memory cache + single storage write per log call
- [x] Enhanced click simulation: full MouseEvent sequence (pointerdown, mousedown, pointerup, mouseup, click)
- [x] Auto-refresh popup: status/logs update every 2s while popup is visible
- [x] Clear logs button in popup
- [x] Thumbnail extraction: background-image, picture element, data-lazy-src fallbacks
- [x] Expanded Vinted TLD coverage: .de, .co.uk, .nl, .be, .es, .it, .lt, .lv, .cz
- [x] Options page: maxConcurrent field, validation, tips section
- [x] Content script error logging: failures now logged to extension log system
- [x] Queue: chrome.alarms with storage reload on every alarm fire
- [x] Background: retry RELIST_ITEM 5x and treat message channel close as success only after confirming a new listing ID.
- [x] selectors.ts: added ITEM_EDIT_BUTTON, ITEM_DELETE_BUTTON, ITEM_OVERFLOW_MENU
- [ ] Next E2E test: reload, scan, select one listing, relist selected, paste logs

## Phase 7 - Pro hardening (v0.2.1)
- [x] Version synchronized across `manifest.json`, `package.json`, and popup footer as `v0.2.1 Pro`.
- [x] Popup received Pro visual polish: gradient header, Pro badge, safe/local/manual indicators, and refined controls.
- [x] Background scan/relist routing now uses the active Vinted tab instead of the first Vinted tab in the window.
- [x] Background now preserves content-script relist failure codes/messages instead of masking them as generic tab communication errors.
- [x] Queue `isProcessing` reset is protected with `finally` so failed persistence/scheduling cannot leave the queue stuck.
- [x] Remaining content-layer selector/fallback strings were moved into `src/content/selectors.ts`.
- [x] Build tooling is module-consistent: package is ESM and the CommonJS build helper is `scripts/build.cjs`.
- [x] Queue test timing updated for `chrome.alarms`; `npm test` passes 24/24.
- [ ] Manual relist E2E is still required on the real Vinted detail page after reloading the extension.

## Phase 8 - Product modularization planning
- [x] Added `PRODUCT_MODULES.md` with target modules: Relist, AI messages, Offers/favoriters, Follow/visibility, Unified dashboard, and Multi-account/background foundations.
- [x] Documented what already exists vs what is missing for each target module.
- [x] Updated `ARCHITECTURE.md` with target product module boundaries.
- [x] Updated `README.md` to point to the post-MVP module map.
- [x] Added `src/core/product-modules.ts` as the central typed product module registry.
- [x] Added a dashboard Modules tab that shows active, partial, and planned modules without enabling unfinished automation.
- [ ] Do not implement AI/offers/follow/multi-account modules until relist E2E is manually confirmed.

## Phase 9 - Relist completeness
- [x] Added batch `saveBackups` storage helper so multiple listing backups are saved with one storage write.
- [x] Background now saves a pre-relist backup for every listing passed to `ADD_TO_QUEUE`.
- [x] Removed duplicate popup preview backup; backup is now background-led for both popup and dashboard relist flows.
- [x] Added `tests/background-backup-test.mjs` and wired it into `npm test` to verify `ADD_TO_QUEUE` creates backups and queue items.
- [ ] Manually verify that queued listings appear in Backups before relist execution.

## Phase 10 - Dashboard polish (v0.2.2)
- [x] Added a dashboard command-center hero that shows active MVP scope, inactive planned modules, and the exact next manual relist E2E steps.
- [x] Refined dashboard and popup visual systems with warmer backgrounds, stronger headers, clearer primary buttons, responsive hero layout, status badges, listing rows, and log panels.
- [x] Synchronized visible version as `v0.2.2 Pro` across manifest, package metadata, popup, and README.
- [x] Fixed dashboard **Scan page** targeting: dashboard requests now resolve a real Vinted tab instead of trying to scan the `chrome-extension://` dashboard tab.
- [ ] Manual relist E2E is still required before implementing post-MVP automation modules.

## Phase 11 - Dashboard scan fallback (v0.2.3)
- [x] Added `tabs` permission so background can reliably find Vinted tabs from the dashboard page.
- [x] Dashboard scan now opens the configured profile `https://www.vinted.pl/member/107890191` when no Vinted tab is available, waits for load, and scans that tab.
- [x] Updated dashboard and popup Vinted links to the confirmed profile URL instead of `/member/items`.
- [x] Synchronized visible version as `v0.2.3 Pro`.
- [x] Fixed dashboard render helper bug: shared `createElement()` now appends `children`, so scan rows, module cards, logs, queue rows, and backup rows render real content.
- [x] Improved dashboard scan list readability with scan summary, thumbnail column, simpler labels, styled status badges, and stable selection across filter/sort.
- [ ] Reload the extension in Chrome and manually verify dashboard **Scan Page** returns readable listing rows.

## Phase 12 - Vinted API fallback research and implementation
- [x] Analyzed installed extension at `C:\Users\Irek\AppData\Local\Google\Chrome\User Data\Default\Extensions\ljefajifldflgjhipnfabbhjbbhnhoho\6.70_0` for high-level behavior only; do not copy proprietary code/assets.
- [x] Observed that the external extension uses Vinted API endpoints instead of relying only on DOM clicks for relist-like actions.
- [x] Add a small local Vinted API helper with explicit logs and typed responses.
- [x] Detect Vinted base URL from the active/target tab.
- [x] Read CSRF token from the loaded Vinted page or page HTML.
- [x] Include `anon_id` cookie when available, or document if unavailable.
- [x] Add API diagnostics command/log path for `/api/v2/users/current`.
- [x] Added paginated, read-only `/api/v2/wardrobe/{userId}/items` scan for the signed-in wardrobe, with visible-DOM fallback and explicit source logs.
- [x] Added a separate `sourceStatus` model so Vinted item state (active/hidden/sold/reserved/draft) is never confused with relist queue state.
- [x] Expanded wardrobe scan to read Vinted's available private seller-status queries (`hidden`, `sold`, `reserved`, `draft`) after the public wardrobe, with duplicate/ignored-filter detection and explicit per-status logs.
- [ ] Manually verify the wardrobe API response count and source-status mapping on the logged-in account; Vinted may expose different fields or statuses by locale/account state.
- [x] Add detail fetch for `/api/v2/item_upload/items/{itemId}`.
- [ ] Save richer pre-relist backups from API item details when available.
- [x] Implement own MVP API relist fallback: fetch details, build draft payload, create draft, then stop in draft-only mode first.
- [x] Fixed false-positive relist success: DOM runner now returns success only when a new listing ID different from the original is confirmed.
- [x] Fixed false-positive navigation success: background now confirms the tab moved to a different listing ID after content-script disconnect before returning success.
- [x] API draft-only fallback no longer counts as relist success; it returns `api-draft-only` for manual review.
- [x] Draft mode no longer counts as relist success; it opens the page for review and returns `relist-not-confirmed`.
- [x] Stats now increment relisted totals only for successful relist results, not failed/manual-review attempts.
- [x] Draft-only fallback verified manually by user: Vinted created a draft.
- [x] Added guarded publish flow via `/api/v2/item_upload/drafts/{draftId}/completion`; success requires a new item id different from the original.
- [x] Fixed observed completion blocker: Vinted rejected reused photo IDs with `validation_error` on `field:"photos"`. API fallback now downloads source photo URLs, uploads new photo copies via `/api/v2/photos`, and uses the new photo IDs for draft creation/completion.
- [x] Fixed dashboard error visibility issue where the user could see only `Error` plus the close button. Dashboard now normalizes empty/generic errors and falls back to failed queue item errors or latest WARN/ERROR logs.
- [x] Fixed observed `Reuploaded photos: 0/3` blocker path: photo downloads now use no-cookie CDN fetch first, then a background `FETCH_PHOTO` fallback with minimal Vinted CDN host permissions (`*.vinted.net`, `*.vinted-cdn.com`) and concrete per-photo download/upload logs.
- [ ] Only after publish flow is verified: decide whether deleting the original item is acceptable for MVP, and keep deletion disabled by default until manually confirmed.
- [x] Surface API 401/403/429 failures through clear logs without adding background retry storms.
- [x] Pause the queue automatically on API 401/403/429 instead of continuing a larger batch; the failed item is retained, the pause reason is logged, and manual Resume continues with the next item.
- [x] Build now emits current `dist/core/errors.js` and `dist/core/queue.js` artifacts so core and queue tests cannot silently import stale code.
- [x] Added conservative API-flow delay guidance in Options: an opt-in preset sets 3 minutes base delay plus up to 1 minute of jitter, without silently overwriting existing saved settings.
- [ ] Expand Vinted TLD coverage only if needed for this account; avoid adding broad permissions without a reason.
- [x] Document that this implementation is newly written and only inspired by observed public/runtime behavior.
- [ ] Reload extension and manually test one active listing where the DOM relist button is missing; expected result is a new published listing id if completion succeeds, or a draft left for manual review if completion fails.
- [ ] Manual regression check: if Vinted keeps the same listing ID after an attempted relist, the queue must show failure `relist-not-confirmed`, not success.
- [ ] Manual success check: a true relist must show old ID and new ID in logs, and the new ID must be different.
- [ ] Manual photo reupload check: logs should show `Reuploading N photo(s)`, `Downloaded photo X/N ...`, `Uploaded photo X/N as id ...`, then completion success or the next concrete Vinted error.

## Phase 13 - Garderoba dashboard (v0.2.3)
- [x] Reworked the dashboard into an independent, reference-inspired **Garderoba** layout with sidebar navigation, neutral visual system, and clear local-data status.
- [x] Added a Polish listing toolbar with search, status filtering, price/title/ID sorting, and an explicit relist-only batch action.
- [x] Kept only existing, wired capabilities interactive: scan, selected relist, queue, pause/resume, backups, log activity, and module plan.
- [x] Kept AI editing, automatic messages, offers, and autopilot out of the dashboard because they are not implemented MVP capabilities.
- [x] Passed `npm run typecheck`, `npm test` (86 assertions), and `npm run build`.
- [ ] Reload the extension and manually verify the new **Garderoba** dashboard before relying on it for relist E2E.

## Tooling follow-up
- [x] Migrated ESLint from the unsupported legacy `.eslintrc.json` format to `eslint.config.js`, so `npm run lint` executes under ESLint 10.
- [ ] Address the existing lint backlog separately: the first working ESLint 10 run reports 185 errors across many pre-existing source files; do not mass-refactor it alongside relist MVP changes.

## Phase 14 - Popup Garderoba polish (v0.2.3)
- [x] Reworked the extension popup into a compact, light Polish **Garderoba** view aligned with the dashboard visual system.
- [x] Preserved every existing wired control (scan, selected relist, pause/resume, clear, search, sorting, bulk price preview, logs, navigation links, and single-listing confirmation).
- [x] Localized visible popup action and queue-state labels without changing the relist workflow.
- [x] Passed `npm run build` and `npm test` (105 assertions).
- [ ] Reload the extension and visually verify the popup in Chrome, including its no-listings, selected-listings, paused-queue, and error states.

## Phase 15 - Stabilization, refactoring, and UI consistency
- [x] Added `REFACTORING_ROADMAP.md`: a staged 30-task MVP roadmap for functional reliability, visual consistency, source refactoring, lint cleanup, tests, and manual Chrome verification.
- [x] Centralized source/queue status labels, source-status resolution, and scan-summary helpers in `src/core/listing-status.ts`; removed duplicate implementations from popup, dashboard, and content script.
- [x] Extended typed scan response with structured source/summary data and displayed it consistently in popup and dashboard.
- [x] Added popup status filtering and status counts without adding new Vinted actions; selection is retained across popup filter and sort redraws.
- [x] Added local relist preflight in popup, dashboard, and background routing. It blocks malformed/duplicate data before clearing a queue and logs warnings for non-active seller statuses without silently dropping them.
- [x] Added a runtime-checked, typed DOM lookup helper and migrated the popup element cache, including action buttons and the log-clear control.
- [x] Migrated the dashboard to the same typed DOM cache; removed its unused generic cache and unsafe HTML-element casts.
- [x] Migrated the options page to the same typed DOM helper, covering the settings form, fields, status message, and API-delay action.
- [x] Extracted shared, tested listing-selection helpers; popup and dashboard now preserve selections outside the current search/status filter.
- [x] Extracted dashboard scan, queue, backup, and activity-log row renderers into a presentation-only module.
- [ ] Decide the final non-active-status relist policy only after logged-in Vinted E2E confirms behaviour for hidden, sold, reserved, draft, and unknown items.
- [x] Split the remaining popup renderers into `popup-row-renderers.ts` (listing rows, queue rows, log rows, backup rows, backup export button, and a shared empty-state helper); popup.ts now uses `createPopupEmptyState` for its empty logs/listings/backups placeholders instead of inline `innerHTML`.
- [ ] Resolve ESLint findings by module: shared/core first, content second, UI/background third. Baseline: 188 errors, 115 warnings.
- [x] Added direct automated tests for the extracted status helpers and scan summary; retain the manual logged-in Vinted scan/relist E2E gate.

## Phase 16 - Scheduled auto-relist (v0.3.0)
- [x] Activated the previously dead auto-relist wiring: the periodic background alarm (`vbr-auto-relist`) is now created, synced on startup and on settings change (`storage.onChanged`), and handled in the alarm listener.
- [x] Added persisted last-scan snapshot (`src/core/scan-cache.ts`, key `vbr:lastScan`): the background saves every successful scan so scheduled cycles and the options page can use it without re-scanning.
- [x] Added pure, unit-tested cycle decisions in `src/core/auto-relist.ts`: `evaluateAutoRelistGate` (disabled setting / busy queue / missing or stale >7 days scan) and `hasPendingQueueItems`; clarified that explicit `unknown` seller statuses are never auto-bumped (conservative automation).
- [x] Successful relists now update `lastRelisted` inside the saved scan, so the next cycle does not re-pick the same items; stats and backups flow through the same pipeline as manual batches.
- [x] Added options-page section "Automatyczne podbijanie": enable toggle, interval (min), max per cycle, min hours since last relist, plus a live scan-freshness panel (GET_SCAN message).
- [x] Automatic cycle never interrupts a running or paused queue; every skipped cycle logs its reason.
- [x] Build now emits `dist/core/auto-relist.js`; added `tests/auto-relist.test.mjs` (27 assertions) wired into `npm test`.
- [x] Version synchronized as `v0.3.0` across `manifest.json`, `package.json`, popup footer, and README; `product-modules.ts` no longer lists scheduled relist as missing.
- [x] Passed `npm run typecheck`, `npm test` (167 assertions), and `npm run build`.
- [ ] Manual Chrome verification: enable auto-relist in options, scan once, confirm the saved-scan panel, let one cycle run, and verify the queue + logs behave as expected.

## Phase 17 - Typed messaging, backup metadata, and shared design tokens (v0.3.1)
- [x] Migrated popup and dashboard messaging to the typed `sendMessage` wrapper from `src/shared/messaging.ts` (MessageResponseMap in contracts); removed local `send<T>`/`assertOkShape` helpers and all ad hoc `as { ok?... }` casts.
- [x] Added `BackupEntry` contract (backedUpAt, relistResult, relistNote); `saveBackups` stamps every backup with the timestamp; `getBackups` normalizes pre-v0.3.0 entries; new `markBackupResult` records the outcome on the most recent backup per id.
- [x] Background executor now records the relist outcome into the matching backup after every attempt, so the backups view shows what happened (Odnowiona/Błąd with note) alongside the backup date.
- [x] Popup and dashboard backup rows show backup date and outcome badges; popup gained a second export button (CSV with UTF-8 BOM) next to the JSON export.
- [x] Added `src/shared/tokens.css` as the single source of truth for colors, radii, spacing, fonts, and shadows; popup/dashboard local `:root` variables now map onto `--ui-*` tokens and the options page was fully migrated to tokens (button accent unified to the red Garderoba accent).
- [x] Build copies `dist/shared/tokens.css`; all three HTML pages link it before their local stylesheet; added a `status-badge--backup` style used by the dashboard backup rows.
- [x] Version synchronized as `v0.3.1` across `manifest.json`, `package.json`, popup footer, and README.
- [x] Passed `npm run typecheck`, `npm test` (167 assertions), and `npm run build`.
- [ ] Manual Chrome verification: reload the extension, open Kopie in the popup, check dates/badges on backup rows and both export buttons; open the dashboard and options to confirm the unified look.

## Phase 17b - Scan diagnostics fixes (v0.3.1)
- [x] Fixed logger staleness bug: `getLogs()` returned an in-memory cache after the first read, so log entries written by the content script were invisible to the popup/dashboard for the whole lifetime of the service worker. `getLogs` now always re-reads storage, and `log()` merges with the freshest stored entries before writing so concurrent writers never wipe each other's lines. Verified with a Node smoke test (external write visible immediately, own write merges).
- [x] Fixed DOM-scan abort: `scanVisibleListings()` returned zero immediately when the primary grid container (`.feed-grid`) was missing. It now falls back to a whole-document link scan (`a[href*="/items/"]` with dedupe), so a Vinted markup change no longer hides all listings.
- [x] Real Chrome symptom addressed: repeated "Scan completed with 0 listing(s)" with no content-script logs visible in the popup; after these fixes the popup shows the content-side diagnostics that reveal the exact reason (API error text or container fallback counts).
- [x] Passed `npm run typecheck`, `npm test` (167 assertions), and `npm run build`.
- [ ] In Chrome: reload the extension, hard-refresh the Vinted tab (F5) so the new content script is injected, rerun the scan, and paste the log lines — they now show the true scan reason if listings are still missing.

## Phase 18 - Queue restart safety and repeated cycles
- [x] Prevent a relist with an unknown outcome from running twice after a Manifest V3 service-worker restart: an interrupted `running` item is now marked as an explicit uncertain error and the queue pauses for manual verification.
- [x] Preserve automatic progress when the service worker restarts safely between items; a missing queue alarm is recreated and the next queued item continues.
- [x] Compact a finished batch when a new idle cycle is added, so auto-relist can process the same listing ID again after its cooldown instead of treating old terminal history as an active duplicate.
- [x] Added queue regressions for interrupted-action recovery, between-step restart, and reuse of a terminal listing ID (`queue-test`: 38 assertions).
- [x] Passed `npm run typecheck`, `npm run build`, and `npm test` (174 assertions).
- [ ] In Chrome: start a two-item batch, close/reopen the popup between items, and confirm the second item continues without clicking Resume. A true mid-action service-worker interruption should pause with an uncertain-result error instead of retrying that item.

## Phase 19 - Relist data-integrity and UI safety
- [x] Restrict whole-document DOM scan fallback to `user-listings`; API failure on detail/feed/other pages now returns a visible error instead of collecting unrelated `/items/` links.
- [x] Preserve the `Ukryte w katalogu` marker as `sourceStatus: hidden` in visible-card scans.
- [x] Stop API draft creation/publication unless every source photo was reuploaded successfully; partial and zero-photo uploads now fail closed.
- [x] Carry a structured `newListingId` through DOM, API, and navigation-confirmed relist results; persist a bounded ID cooldown history so the replacement ID keeps its `lastRelisted` timestamp after a new scan.
- [x] Use the API response page size for wardrobe pagination when total page metadata is absent, instead of assuming Vinted honored `per_page=96`.
- [x] Popup and dashboard now refuse to clear a running/paused/pending queue; dashboard checks every clear/add/resume response before showing success.
- [x] Re-enable the popup select-all checkbox when listing rows exist and preserve a valid `0 h` auto-relist cooldown setting.
- [x] Added `relist-safety.test.mjs` and `scan-cache.test.mjs` and wired both into `npm test`.
- [x] Passed `npm run typecheck`, `npm run build`, and `npm test` (192 assertions); new core safety/cache modules pass scoped ESLint.
- [ ] Manual Chrome E2E: reload extension, scan the own wardrobe, verify hidden badges, run one relist with all photos, and confirm the replacement ID is not selected by the next automatic cycle.

## Prioritization rule
Always finish the smallest useful vertical slice first. Do not start Phase 5 before Phases 1–4 are minimally working.
