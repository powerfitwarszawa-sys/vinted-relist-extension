# Product Modules

This document organizes the extension as a modular Vinted seller tool inspired by the functional shape of products like Redrip. It is a target product map, not an instruction to implement every module at once.

Current rule: the working MVP remains the relist-first local Chrome MV3 extension until the real relist E2E flow is manually confirmed.

## Product Direction

The product should automate repeated seller workflows on one Vinted account first, then grow through isolated modules:

- Relist module: listing scan, selection, queue, safe relist execution, backup, status, logs.
- AI messages module: templates and AI-assisted reply drafts for buyer conversations.
- Offers / favoriters module: detect favoriters and send controlled price offers.
- Follow / visibility module: controlled follow/unfollow visibility tasks.
- Unified dashboard module: one operator panel for items, conversations, offers, tasks, and results.
- Multi-account / background foundations: architecture that can later isolate account state and scheduled work.

## Module Principles

- Each module owns one seller workflow.
- Shared code lives in `src/core/`: contracts, queue primitives, storage wrappers, logging, errors.
- Vinted DOM access stays in `src/content/` and selectors stay in `src/content/selectors.ts` or future module-specific selector files.
- Background stays the orchestrator: queue, alarms, routing, tab navigation, recovery.
- Popup/dashboard stay dumb: they read status and dispatch explicit messages.
- New modules must add typed contracts before UI.
- Every automated action must have delay/rate controls, structured logs, and per-item success/error result.
- Features that affect real buyers should default to draft/manual approval first.

## Target Code Layout

Current code is still MVP-shaped. The target layout should be introduced gradually when a module is actually implemented:

```text
src/
  core/
    contracts.ts
    errors.ts
    logger.ts
    product-modules.ts         # current product module registry
    queue.ts
    storage.ts
    task-types.ts              # future shared task model
  background/
    background.ts              # current orchestrator
    module-router.ts           # future message routing split
    scheduler.ts               # future scheduled task registry
  content/
    selectors.ts               # current shared selectors
    page-detector.ts
    listing-scanner.ts
    relist-runner.ts
    inbox-scanner.ts           # future messages module
    favoriters-scanner.ts      # future offers module
    profile-runner.ts          # future follow module
  modules/
    relist/
      README.md
      contracts.ts
      service.ts
    messages/
      README.md
      contracts.ts
    offers/
      README.md
      contracts.ts
    visibility/
      README.md
      contracts.ts
    accounts/
      README.md
      contracts.ts
  popup/
  dashboard/
  options/
```

Do not move current MVP files into this structure until there is a concrete implementation reason. Premature relocation would increase risk before the relist flow is confirmed.

## 1. Relist Module

### Target Scope

- Scan listings from a user profile.
- Select one or many listings.
- Batch relist with per-item status.
- Queue with safe delay and jitter.
- Pause/resume.
- Preview selected listing before execution.
- Draft mode that opens the listing without publishing.
- Scheduled relist / auto mode at a configured interval.
- `lastRelisted` timestamp.
- Backup before relist.
- Final success/error per item.

### Current State

Implemented or partially implemented:

- Visible listing scan on profile pages.
- Fallback listing extraction by listing links.
- Title, price, currency, URL, thumbnail, description best-effort extraction.
- Selection model in popup.
- Relist queue with per-item status.
- Delay and jitter from settings.
- Pause/resume.
- Queue persistence in `chrome.storage.local`.
- Queue recovery with `chrome.alarms`.
- Preview modal for single selected listing.
- Draft mode setting exists.
- Pre-relist backup for every listing added to queue.
- `lastRelisted` stored on success.
- Success/error per item in queue status.
- Logs and popup status.
- Full dashboard page exists, but is still relist-focused.

### Missing / Needs Confirmation

- Real detail-page relist E2E confirmation is still pending.
- Real relist button selector may still need one more adjustment from user logs.
- Scheduled relist / auto mode is not implemented.
- Full-profile scrolling/loading is not implemented; scan is visible-DOM only.
- Draft mode needs explicit manual test.

### Recommended Next Steps

1. Finish real manual E2E for one listing.
2. Fix only observed relist selector/runner issue if the test fails.
3. Test draft mode explicitly.
4. Add scheduled relist only after manual relist is proven stable.

## 2. AI Messages Module

### Target Scope

- Read buyer conversations.
- Generate reply drafts.
- Support reusable templates.
- Allow tone settings.
- Include listing context in the answer.
- Mark whether a reply was AI-generated, manually edited, or manually approved.
- Prepare language handling for multiple locales.

### Current State

Not implemented.

Relevant foundations already present:

- Local storage wrapper.
- Structured logs.
- Options page pattern.
- Popup/dashboard routing pattern.
- Message contract pattern.

### Missing

- Inbox page detection.
- Conversation scanner.
- Message thread data model.
- Template storage.
- AI provider configuration.
- Draft vs auto-send safety mode.
- Reply approval UI.
- Send-message runner.
- Rate limits and logging per reply.
- Privacy boundary for message content.

### Recommended First Version

Do not auto-send. Build a draft-only assistant:

- Scan current conversation.
- Show suggested reply in dashboard.
- User clicks copy or approve.
- Log `draft-created`, `approved`, `sent`, `failed`.

## 3. Offers / Favoriters Module

### Target Scope

- Detect users who favorited an item.
- Send personalized price offers.
- Apply discount rules.
- Enforce frequency and safety limits.
- Log result per offer.

### Current State

Not implemented.

Relevant foundations already present:

- Queue engine can be generalized later.
- Delay/jitter settings pattern exists.
- Per-item status pattern exists.
- Logs and structured errors exist.

### Missing

- Favoriters page detection.
- Favoriter/user extraction.
- Offer rule model.
- Discount calculation.
- Offer queue type.
- Frequency cap storage.
- Offer-sending runner.
- Per-recipient result logs.

### Recommended First Version

Start with manual-review offers:

- Extract favoriters for one item.
- Calculate suggested discount.
- Queue drafts, not immediate sends.
- Require user confirmation before each send.

## 4. Follow / Visibility Module

### Target Scope

- Batch follow/unfollow selected profiles.
- Pace limits.
- Queue and per-profile status.
- Logs for success and failure.

### Current State

Not implemented.

Relevant foundations already present:

- Queue state machine.
- Background alarm scheduling.
- Content runner pattern.
- Structured logs.

### Missing

- Profile search/list scanner.
- Follow/unfollow selectors.
- Profile task model.
- Rate-limit policy.
- Safety stop conditions.
- UI for selecting profiles.

### Recommended First Version

Build only a controlled profile queue:

- User selects profiles visible on the current page.
- Run follow/unfollow with strict delay.
- Stop on repeated selector failures.

## 5. Unified Dashboard Module

### Target Scope

- Unified view for items, conversations, offers, task statuses, and automation results.
- Summary stats:
  - relists today,
  - successes,
  - errors,
  - active tasks.
- Account/queue health overview.

### Current State

Partially implemented:

- Popup has Pro-polished relist control UI.
- Dashboard page exists.
- Dashboard displays listings, queue, stats, backups, logs.
- Dashboard displays the product module registry and inactive planned modules.
- Stats model exists but is relist-oriented.

### Missing

- Conversations tab.
- Offers tab.
- Visibility/follow tab.
- Unified task list across task types.
- Filter by module/status.
- Account context display.
- Better stats model by module/action type.

### Recommended First Version

Keep dashboard simple:

- Keep inactive modules visible as "planned", not as fake working features.
- Add conversation/offer/visibility tabs only when their typed contracts exist.
- Keep relist as the only active task type until confirmed.

## 6. Multi-account / Background Execution Foundations

### Target Scope

- Prepare architecture for multiple accounts.
- Isolate queue and storage by account.
- Support scheduled tasks in the background.
- Track which account/tab/session owns a task.

### Current State

Partially implemented foundations:

- MV3 service worker.
- `chrome.alarms`-based queue wakeups.
- Local storage wrapper.
- Active-tab routing.
- Single queue state.

### Missing

- Account identity model.
- Account-scoped storage keys.
- Account selector in UI.
- Per-account queues.
- Per-account logs/stats.
- Scheduler registry for multiple task types.
- Conflict rules when multiple Vinted tabs/accounts are open.

### Recommended First Version

Add foundations only after relist E2E:

- `AccountContext` type.
- Storage key namespacing.
- Current account detection from Vinted page.
- Do not add multi-account switching UI until storage isolation is tested.

## Capability Matrix

| Module | Status | Current code | Main blocker |
|---|---|---|---|
| Relist | Active MVP | `src/content/listing-scanner.ts`, `src/content/relist-runner.ts`, `src/core/queue.ts`, popup/dashboard | Real detail-page E2E confirmation |
| AI messages | Planned | Core/log/storage patterns only | Inbox selectors, message model, AI provider decision |
| Offers / favoriters | Planned | Queue/log foundations only | Favoriters selectors and offer safety rules |
| Follow / visibility | Planned | Queue/log foundations only | Profile selectors and rate policy |
| Unified dashboard | Partial | `src/dashboard/*`, `src/core/product-modules.ts`, popup stats/logs | Non-relist task model |
| Multi-account foundations | Partial foundation | storage, alarms, active-tab routing | Account context and namespaced storage |

## Delivery Order

1. Relist reliability: finish real E2E and close selector gaps.
2. Relist completeness: batch backups, draft-mode test, optional scheduled relist.
3. Shared task model: generalize queue item shape without breaking relist.
4. Offers draft mode.
5. AI messages draft mode.
6. Follow/visibility queue.
7. Account-scoped storage foundations.

## Explicit Non-Implementation Notes

- No AI auto-send before manual approval mode exists.
- No offer auto-send before frequency caps and per-recipient logs exist.
- No multi-account UI before storage namespacing exists.
- No backend/cloud dependency unless explicitly chosen later.
- No broad redesign until the relist flow is operational.
