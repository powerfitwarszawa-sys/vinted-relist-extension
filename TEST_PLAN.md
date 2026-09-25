# TEST_PLAN.md

## Manual test checklist

### Installation
- [ ] Extension loads successfully in Chrome developer mode.
- [ ] No manifest errors appear.
- [ ] Popup opens correctly and renders the light Polish **Garderoba** layout without clipped controls at its normal Chrome width.
- [ ] Options page opens correctly.
- [ ] Popup JavaScript starts without module import errors.
- [ ] Options page **API safety preset** fills 180000 ms base delay and 60000 ms jitter, and values are saved only after clicking **Zapisz ustawienia**.

### Page detection
- [ ] Content script runs only on intended Vinted pages.
- [ ] Scan does not fail with `Receiving end does not exist` on a freshly reloaded Vinted profile page.
- [ ] Scan targets the currently active Vinted tab, not another background Vinted tab.
- [ ] Dashboard **Scan Page** resolves a real Vinted tab instead of the `chrome-extension://` dashboard tab.
- [ ] If no Vinted tab is open, dashboard **Scan Page** opens `https://www.vinted.pl/member/107890191`, waits for load, then scans it.
- [ ] Dashboard **Scan Page** renders non-empty listing rows with thumbnail, title, price, status, and action link after a successful scan.
- [ ] Dashboard listing selection remains stable after search or sort changes.
- [ ] Dashboard **Garderoba** view renders the sidebar, toolbar, table, and Polish labels correctly after extension reload.
- [ ] Dashboard status filter and sort control update only the visible listing rows; selected listings remain selected after filtering.
- [ ] Dashboard **Wykonaj** button remains disabled without a selection and starts the existing relist queue for selected listings only.
- [ ] Overlay does not duplicate after navigation.
- [ ] Logs show page detection status.

### Listing scan
- [x] Scanner detects visible listings on `https://www.vinted.pl/member/107890191` (20 listings returned in manual E2E).
- [ ] Logged-in wardrobe scan returns the full paginated item count and displays the result summary as `Wardrobe API scan completed`, rather than the visible-page fallback.
- [ ] Source status badges distinguish Vinted item state (active, hidden, sold, reserved, draft, or unknown) from queue lifecycle state (queued, running, success, error).
- [ ] A wardrobe scan log contains one explicit result for each private-status query (`hidden`, `sold`, `reserved`, `draft`): received count, zero items, unavailable, or ignored filter. It must not silently relabel a visible active item as a non-public status.
- [ ] If `/api/v2/wardrobe/{userId}/items` is unavailable, logs and dashboard summary explicitly say that the visible-page fallback was used.
- [x] If `[data-testid="feed-grid-item"]` returns 0, scanner falls back to listing links and logs the fallback count.
- [ ] Listing IDs/titles/prices/currency are captured consistently; verify the `Listing sample` log after Scan.
- [ ] Empty state is handled gracefully.
- [x] Visible-DOM fallback is allowed only on `user-listings` and blocked on detail/other pages (`relist-safety.test`).
- [x] Visible cards containing `Ukryte w katalogu` map to seller status `hidden` (`relist-safety.test`).
- [x] Pagination without total-page metadata follows the page size returned by Vinted (`relist-safety.test`).
- [ ] Clicking **Skanuj garderobę** creates visible popup log feedback with either returned listing count or a clear scan failure.
- [ ] Popup scan summary states whether data came from `API garderoby` or `Widoczna strona (fallback)` and includes all seller-status counts.
- [ ] Popup status filter shows only the selected source status without changing queue state or selected listings outside the visible filter.

### Relist queue
- [ ] Relist preflight blocks a duplicate, missing-ID, missing-title, or missing-URL listing before the existing queue is cleared.
- [ ] Relist preflight logs a visible warning for hidden, sold, reserved, draft, or unknown seller status without silently changing the selection.
- [ ] Selected listings can be added to queue.
- [x] Adding listings to queue creates a pre-relist backup for every queued listing (`background-backup-test`: 9/9).
- [ ] Batch execution runs in order.
- [ ] Delay is respected.
- [ ] Jitter is applied when enabled.
- [ ] Pause stops progress cleanly.
- [ ] Resume continues from saved state.
- [x] Queue state-machine tests pass with `chrome.alarms` scheduling (`npm test`: 24/24).
- [ ] Relist failures surface the original content-script code/message in popup logs.
- [ ] A relist attempt that leaves the page on the same listing ID returns `relist-not-confirmed`, not success.
- [ ] A successful relist log/message includes the original listing ID and a new listing ID, and the two IDs are different.
- [ ] If content-script messaging disconnects during navigation, background confirms the tab URL changed to a different `/items/<id>` before returning success.
- [ ] If the DOM relist button is missing, API fallback logs `/api/v2/users/current` session status before attempting draft creation.
- [x] API fallback draft creation was manually observed by user: Vinted created a draft.
- [ ] API fallback creates a draft, then attempts `/api/v2/item_upload/drafts/{draftId}/completion`.
- [ ] API fallback reuploads source photos through `/api/v2/photos`; logs show `Reuploading N photo(s)`, `Downloaded photo X/N ...`, and `Uploaded photo X/N as id ...`.
- [x] API draft publication is blocked unless all source photos were reuploaded (`relist-safety.test`).
- [ ] API completion success returns/logs a new item id different from the original and counts as relist success.
- [ ] API completion failure leaves the draft for manual review, returns `api-draft-only`, and does not count as relist success.
- [ ] API fallback does not delete the original listing.
- [ ] API fallback failure on 401/403/429 surfaces a clear log message and does not retry repeatedly.
- [x] API `401`, `403`, or `429` records the current item failure, pauses the remaining queue, and requires a manual Resume before another item runs (queue regression test).
- [ ] Options draft mode opens the listing for manual review but does not mark the queue item as success.

### Logging
- [ ] Success actions create logs.
- [ ] Failures create logs with error codes.
- [ ] Logs remain visible after popup reopen.

### Recovery
- [ ] Refreshing the page does not corrupt state.
- [ ] Interrupted queue can be resumed where possible.
- [x] A persisted `running` item after service-worker restart is marked as an uncertain error and is not executed again automatically (`queue-test`).
- [x] A service-worker restart between items preserves the running batch and recreates a missing alarm (`queue-test`).
- [x] A completed batch does not block the same listing ID from a later auto-relist cycle (`queue-test`).
- [x] A confirmed replacement listing ID keeps the relist cooldown after the next saved scan (`scan-cache.test`).
- [ ] Service worker restores queue without `import() is disallowed on ServiceWorkerGlobalScope`.

## Selector validation plan

All Vinted DOM selectors are isolated in `src/content/selectors.ts`. Before the MVP can run reliably, each selector below must be verified on a real Vinted page in the target locale/account.

### Selectors to verify

| Selector constant | Purpose | Validated value | Notes |
|---|---|---|---|
| `USER_LISTINGS_CONTAINER` | Container of the user's listing grid/list | `.feed-grid` | Validated on vinted.pl member page. |
| `LISTING_ITEM` | Individual listing card | `[data-testid="feed-grid-item"]` | Validated on vinted.pl member page. |
| `LISTING_TITLE` | Listing title inside a card | `[data-testid="item-title"]` | Best-effort; scanner falls back to link title, image alt, or link text. |
| `LISTING_PRICE` | Listing price inside a card | `[data-testid="item-price"]` | Best-effort; scanner falls back to any text content. |
| `LISTING_LINK` | Link to listing detail page | `a[href*="/items/"]` | Validated; used to derive the listing id and URL. |
| `LISTING_DETAIL_PAGE_MARKER` | Confirms a listing detail page | `[data-testid="item-title"], [data-testid="item-details-title"], [data-testid="item-description"], h1` | Fallback group used because `[data-testid="item-details"]` was not present in real E2E. |
| `RELIST_BUTTON` | Triggers the relist action | `button[data-testid="relist-button"], button[data-testid="item-action-relist"]` plus test-id/text fallback | Still needs final real detail-page confirmation from pasted button-list logs. |
| `RELIST_CONFIRM_BUTTON` | Confirms the relist action | `''` (empty) | Not present in the tested flow; the runner skips confirmation when this is empty. |

### How to verify manually

1. Open the relevant Vinted page in Chrome.
2. Open DevTools → Elements.
3. Search for the placeholder selector (e.g., `[data-testid="item-card"]`).
4. If no match, inspect the real element and copy a stable selector (prefer `data-testid`, then unique class, then attribute).
5. Update `src/content/selectors.ts` with the verified selector.
6. Rebuild (`npm run build`) and reload the extension.
7. Trigger the corresponding action and check logs for the expected result code.

### Failure cases to capture

| Scenario | Expected error code | Expected log level |
|---|---|---|
| Placeholder selector matches nothing on the real page. | `detail-marker-missing`, `relist-button-missing`, etc. | `warn` or `error` |
| Selector matches an element that is not the intended one. | `relist-action-error` or unexpected page behavior. | `error` |
| Selector is stable but element is not yet rendered (async load). | `relist-button-missing` or timeout. | `warn` |
| Relist confirmation dialog uses a different selector. | `relist-button-missing` (if confirm not found) then success. | `debug` |
| Page locale changes the DOM structure. | Any of the above. | `warn`/`error` |
| Relist click keeps the same listing ID. | `relist-not-confirmed` | `warn` |
| API creates a draft but completion fails. | `api-draft-only` | `warn` |
| API completion rejects photos. | `api-draft-only`; logs should show photo download path, photo reupload count, and the concrete `/completion` error. | `warn` |

### Expected logs/results after validation

- On scan: `info` logs showing the number of potential items found and how many were extracted.
- On scan with results: an `info` log shows up to 3 extracted listing samples with id, title, price, and currency.
- Listing samples must not show metadata-heavy titles or fake currency such as `Ukrytewkatalogu`; expected price examples should parse as `40 zł`, `50 zł`, etc.
- On scan fallback: a `warn` log shows the primary listing selector matched 0 and how many listing-link containers were found.
- On popup Scan click: a visible log entry shows the returned listing count, or a failure log explains why the scan did not reach the content script.
- On dashboard Scan Page with no existing Vinted tab: an `info` log shows the profile tab was opened for scan, followed by normal scan logs.
- If content module loading fails, the content bridge returns a visible `Content script failed to handle message` error instead of a silent missing receiver.
- On successful relist: `success` code and an `info` log that shows `original <oldId>, new <newId>` or `Oferta <oldId> odnowiona jako <newId>`.
- On attempted relist where the visible listing ID stays the same: `relist-not-confirmed` and a `warn` log with original ID and current ID.
- On API fallback completion success: `success`; message/log includes original id, draft id, and new published item id.
- On API fallback completion failure: `api-draft-only`; the message includes the created draft id and must not be counted as relist success.
- On API fallback photo handling: logs show whether URLs came from `item_upload/items` or fallback `/api/v2/items`, whether each photo downloaded directly or via background `FETCH_PHOTO`, how many photos were uploaded, and whether completion retried with the original upload session.
- On wrong page: `not-on-detail-page` code and a `warn` log showing current vs. expected path.
- On missing relist button: `relist-button-missing` code and a `warn` log with the selector used.
- When no confirmation button is configured: a `debug` log indicating the confirmation step is skipped.
- On content-script/background communication failure: `tab-communication-error` or `content-error` and an `error` log.

## Known unknowns
- Exact relist UI steps may differ between listing states.
- Some actions may need waits for async UI updates.
- Locale-specific labels may require selector fallback strategy.
