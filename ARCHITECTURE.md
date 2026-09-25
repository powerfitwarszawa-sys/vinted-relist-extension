# ARCHITECTURE.md

## High-level architecture
The extension uses Chrome Manifest V3 and is split into four layers:

1. Content layer — interacts with Vinted pages.
2. Background layer — manages queue state and message routing.
3. UI layer — popup and options page.
4. Shared core layer — contracts, storage, logging, errors.

## Main modules

### Content layer
- `page-observer` — identifies relevant pages and readiness.
- `listing-scanner` — extracts visible listings.
- `relist-runner` — executes the relist workflow.
- `overlay-controller` — displays controls inside the page.

### Background layer
- `service-worker` — central runtime entry.
- `message-router` — routes events and commands.
- `queue-store` — persists queue state.
- `scheduler-lite` — optional later extension point.

### UI layer
- `popup` — quick status and controls.
- `options` — settings like delay, jitter, safe mode.

### Shared core
- `contracts` — shared message types.
- `storage` — wrapper over `chrome.storage.local`.
- `logger` — structured local logs.
- `errors` — named error codes.

## Target product modules

The target product is organized into feature modules. The current implemented product module is `Relist`; other modules are planned and documented in `PRODUCT_MODULES.md`.

The roadmap modules are:

- `Relist` - active MVP module for scan, selection, queue, safe relist, backups, logs, and status.
- `AI messages` - planned module for conversation scanning, templates, and draft replies.
- `Offers / favoriters` - planned module for favoriter detection, discount rules, and controlled offer sending.
- `Follow / visibility` - planned module for paced follow/unfollow tasks.
- `Unified dashboard` - partial module; currently relist/status/backups/logs focused.
- `Multi-account / background foundations` - planned foundation for account-scoped storage and task ownership.

Do not move current MVP code into a new module folder until there is a concrete implementation reason. The immediate architecture goal is stable relist E2E, not a broad folder refactor.

## Data flow
1. User opens a relevant Vinted page.
2. Content script detects page readiness.
3. Scanner extracts listing metadata.
4. User selects listings and triggers relist.
5. Content layer sends command to background.
6. Background stores queue state.
7. Content runner executes relist steps.
8. Progress and errors are logged locally.
9. Popup reads current state and logs.

## Architecture rules
- Keep selectors isolated.
- Avoid direct storage access from many places; use a storage wrapper.
- Keep queue logic separate from DOM logic.
- Keep UI components dumb where possible.
- Prefer explicit contracts over ad hoc messages.
