# Vinted Local Relist Extension

A local Chrome Extension (Manifest V3) for personal batch relisting of Vinted listings. Built for one account and ~200 active listings.

Current version: **v0.3.1**.

## Features

- Scan the signed-in wardrobe through Vinted's existing browser session with pagination. The scanner first reads the public wardrobe, then checks the available seller-status queries for hidden, sold, reserved, and draft items; ignored or unavailable status queries are logged clearly. It falls back to visible profile cards when the read-only API scan is unavailable.
- Select listings via checkboxes in the popup.
- Popup scan summary identifies the data source (wardrobe API or visible-page fallback), shows source-status counts, and supports filtering by seller status without losing the current selection.
- Local relist preflight runs before the queue is cleared: malformed or duplicate listings are blocked, while non-active Vinted statuses are recorded as explicit warnings pending real E2E verification.
- Batch relist selected listings with navigation to each detail page.
- **Scheduled (automatic) relist cycle** — optionally bump a limited number of active listings on a configurable interval. The cycle uses the last saved scan, never interrupts a running or paused queue, respects a minimum time since the last relist, and logs every skipped cycle with its reason.
- **Persisted last scan** — the most recent wardrobe scan is saved locally, so the scheduled cycle and the options page can use it without re-scanning; the scan freshness is shown in the options page.
- Confirmed-success guard: a relist counts as successful only when the extension observes a new listing ID different from the original.
- Auto-refresh popup: status and logs update every 2s while the popup is open.
- Log management: view recent logs and clear them from the popup.
- **Backup snapshots with metadata** — every pre-relist backup stores the backup timestamp and, once the relist finishes, its outcome (new listing id on success, failure reason on error). The backups view shows the date and an "Odnowiona"/"Błąd" badge, and exports to **JSON or CSV**.
- Configurable delay and random jitter between relist actions.
- **Shared design tokens** — colors, radii, spacing, fonts, and shadows live in one `src/shared/tokens.css` consumed by the popup, dashboard, and options page, so the three surfaces can never drift visually.
- Thumbnails, titles, prices, and status badges in a Vinted-style table layout.
- Polish **Garderoba** popup aligned with the dashboard: compact light layout, clear queue state, manual scan/relist controls, status badges, and readable logs.
- Pause/resume and persistent local queue state.
- Fail-closed service-worker recovery: if Chrome interrupts an item while the external relist result is unknown, that item is marked as an uncertain error and is not retried automatically; safe restarts between items continue the batch.
- Automatic queue pause on Vinted API `401`, `403`, or `429` responses; remaining items continue only after an explicit Resume.
- Active-tab targeting so scan/relist actions operate on the Vinted tab you are currently using.
- Dashboard "Garderoba" view with a sidebar, searchable and sortable listing table, status filter, selection, a relist-only batch action, queue status, stats, backups, and product modules.
- Dashboard scan fallback: if no Vinted tab is available, the extension opens the configured profile page and scans it.
- API fallback for missing relist buttons: the content script can fetch item details, download listing photos from Vinted CDN, reupload photo copies through Vinted's photo API, create a Vinted draft, and then attempt guarded draft completion/publication. Publication is stopped unless every source photo has a fresh uploaded copy. The original listing is not deleted. Success is counted only when Vinted returns a new published item ID different from the original; otherwise the draft remains for manual review.
- Visible-DOM scan fallback runs only on the user's wardrobe page; it is blocked on detail/search/feed pages so recommended or third-party listings cannot enter the relist queue.

## Requirements

- Google Chrome (or Chromium) with Manifest V3 support.
- Node.js and npm for building the TypeScript sources.

## Install

1. Clone or copy this repository to your local machine.
2. Open a terminal in the project folder and install dependencies:

   ```bash
   npm install
   ```

3. Build the extension:

   ```bash
   npm run build
   ```

   The compiled files are written to `dist/`.

4. Open Chrome and navigate to `chrome://extensions/`.
5. Enable **Developer mode** in the top-right corner.
6. Click **Load unpacked** and select the project root folder, not `dist/`:

   ```text
   C:\Users\Irek\Documents\Projekty\vinted
   ```

   `manifest.json` lives in the project root and points Chrome to files under `dist/`.
7. Pin the extension to the toolbar for easy access.

## Usage

1. Open your Vinted profile page in the active tab.
2. Click the extension icon to open the **Garderoba** popup.
3. Click **Skanuj garderobę**. The extension first reads the paginated wardrobe through the current Vinted session, then shows statuses such as active, hidden, sold, reserved, or draft when returned by Vinted. If that scan is unavailable, it visibly falls back to the listings currently loaded on the profile page.
4. Select the listings you want to relist via the checkboxes.
5. Click **Relist selected** to start the batch. The extension navigates to each listing detail page and triggers the relist action.
6. Treat success as confirmed only when logs show the original ID and a different new listing ID. If Vinted keeps the same ID, the queue should show `relist-not-confirmed`.
7. If Vinted does not expose a relist button for an active listing, the extension downloads the listing photos from Vinted CDN, reuploads them, creates a draft via API, and attempts to publish it via draft completion. The original listing is not deleted. If completion fails, check Vinted drafts manually; the queue does not mark it as relisted.
8. Use **Pause**, **Clear**, and the status panel to control the run.
9. Use the **Clear logs** button to reset the log view.

## Options

Open the options page (via the popup **Ustawienia** link) to configure:

- **Delay** — base milliseconds between relist actions.
- **Jitter** — random extra milliseconds added to each delay.
- **maxConcurrent** — maximum concurrent relist operations (currently sequential, so 1).
- **API safety preset** — fills a conservative 3-minute base delay plus up to 1 minute of jitter for an API-fallback batch; values are only saved after confirmation.
- **Automatic relisting (auto-relist)** — enable the scheduled bump cycle and configure the interval, the maximum listings per cycle, and the minimum hours since the last relist. The page also shows the freshness of the saved wardrobe scan; without a fresh (≤ 7 days) scan the automatic cycle stays paused and explains why in the logs.

## Architecture

- `src/core/` — shared contracts, storage helpers, logging, queue model.
- `src/content/` — content script: Vinted page detection, listing scanner, relist DOM executor, selectors.
- `src/popup/` — popup dashboard: status, logs, scan/select/relist actions.
- `src/options/` — options page: delay, jitter, maxConcurrent configuration.
- `src/background/` — service worker: queue runner using `chrome.alarms`, navigation, retry logic, message routing.

## Product modules

See `PRODUCT_MODULES.md` for the target modular product map covering relist, AI messages, offers/favoriters, visibility tasks, unified dashboard, and multi-account foundations.

## Development

- Build once: `npm run build`
- Watch for changes: `npm run watch`

After rebuilding, reload the extension on `chrome://extensions/` and refresh the open Vinted tab so the updated content script is injected.

## Scope

This is a local MVP. It includes manual and scheduled (auto-relist) batch relisting with local backups, logs, and stats. It does not include AI replies, offers, inbox automation, multi-account support, analytics, or cloud sync.

Those features are tracked as post-MVP modules in `PRODUCT_MODULES.md` and should be implemented only after the relist flow is manually confirmed on the real Vinted page.
