# Redrip parity gap — features we don't have yet

Analysis of the installed competitor extension **"Vinted Assistant / redrip"**
(`chrome://extensions/?id=ljefajifldflgjhipnfabbhjbbhnhoho`, local copy v11.99,
manifest + popup.html + plan-gate.js + UI strings — feature inventory only, no code reuse).

Purpose: list what that product does beyond our current v0.3.1 so we can decide
what to implement to reach functional parity. Nothing here is implemented yet —
per PRODUCT_MODULES.md, modules land one at a time after the relist E2E is confirmed.

## What we already have (parity today)

| Area | Status |
| --- | --- |
| Batch relist: scan → select → queue → backup → DOM relist + API fallback | ✅ v0.3.1 |
| Scheduled auto-relist (alarm, cooldown, freshness gates, feedback) | ✅ v0.3.1 |
| Delay/jitter pacing, pause/resume, fail-closed restart recovery | ✅ v0.3.1 |
| Backups with outcome + JSON/CSV export | ✅ v0.3.1 |
| Popup + dashboard + options, typed messaging, structured logs | ✅ v0.3.1 |
| Replacement-ID cooldown across scans, wardrobe-only DOM fallback | ✅ v0.3.1 |
| In-page overlay controller | ⚠️ scaffold exists (`overlay-controller.ts`) |
| Multi-account, AI, offers/favoriters, follow, unified task history | ❌ planned in PRODUCT_MODULES.md |

## Gap list (redrip → us)

Priority: **P0** = core seller value / needed for daily use, **P1** = strong
differentiator, **P2** = niche or large-scope.

### 1. Inbox / messages module — P0
- [ ] Conversation list: threads, unread badges, last message preview (Vinted API `GET /api/v2/conversations`).
- [ ] Auto-reply to unread conversations with **templates** (multiple named templates, rename, **rotation** = random template per send).
- [ ] Dedupe: never message the same conversation twice (`repliedConvs`-style memory), per-conversation cooldown.
- [ ] AI reply drafts (Pro-only on redrip) with **manual approval** before send — default draft mode per module principles.
- [ ] "Send anyway even if conversation exists" (follow-up) toggle.

### 2. Favoriters module — P0
- [ ] Recent favorites notifications list (who saved which item, when).
- [ ] Auto-message to **new favoriters** using templates, cooldown + monthly cap.
- [ ] Favoriters = offer pipeline input later (PRODUCT_MODULES "Offers / favoriters").

### 3. Sales / orders view — P1
- [ ] Orders tab: sold and bought lists from `GET /api/v2/transactions`.
- [ ] Sales status feed ("Synchro ventes") — full value only if crosslisting exists.

### 4. Bulk editing — P1
- [ ] Price editor: increase/decrease by %, apply-to-all with preview.
- [ ] Edit modal: title, description, category/sub-category, size, catalog id, photo browser.
- [ ] Bulk delete listings with explicit confirmation.

### 5. AI content — P1
- [ ] AI description generation from title/photos ("Générer (IA)").
- [ ] AI rewording of titles & descriptions in bulk.
- [ ] Requires OpenAI-compatible key in options (their manifest allows `api.openai.com`; ours does not).

### 6. Sales automation (default: draft/manual approval) — P1
- [ ] Automatic price drop schedule (periodic % reductions).
- [ ] Auto-negotiation with buyers (multi-round counter-offers).
- [ ] Both affect real buyers → keep draft/approval-first until manually proven.

### 7. Follow / visibility module — P1
- [ ] Bulk follow/unfollow by member IDs (paste from profile URLs).
- [ ] Follower scraping progress task.
- [ ] "Give likes" pool (engagement loop before adding items) — growth tactic, optional.

### 8. Resilience / UX hardening — P0 for E2E
- [ ] DataDome CAPTCHA detection → pause queue, surface "solve CAPTCHA" prompt, advise 5–15 min retry.
- [ ] Size-rejected handling: if Vinted refuses the saved size mid-republish, ask user to pick a size, keep listing intact, resume.
- [ ] Browser notifications when a long task finishes (needs `notifications` permission — we don't have it).
- [ ] Progress detail per item: fetch info → download photos → upload → draft → wait → publish.

### 9. Backup import — P1
- [ ] Import a saved backup as a **draft** (we export JSON/CSV but cannot restore).
- [ ] "Save whole wardrobe snapshot" one-click (we snapshot on scan only).

### 10. Crosslisting to Leboncoin — P2 (large)
- [ ] Publish selected Vinted items to Leboncoin (draft-only mode, spaced publications).
- [ ] Re-check recent publications, sales sync both ways (sold there → hide here).
- [ ] Own content scripts, hosts, quotas — effectively its own module; decide explicitly before scope.

### 11. Label printing — P2
- [ ] Merge/crop shipping labels PDF, barcode-safe scaling, optional listing title on label.

### 12. Unified task history — P1
- [ ] One history view across task types (relist, message, offer, price drop, crosslist) with raw-error view and "clear history".
- [ ] Matches PRODUCT_MODULES target `core/task-types.ts`.

### 13. Parity extras — P2 / optional
- [ ] Extend host/content matches to all 27 Vinted country domains (we cover 13).
- [ ] Multi-language UI (they ship 12 languages; we are PL-only by convention).
- [ ] Multi-account picker (already a target module).
- [ ] Plan/quota paywall (free 50/mo → Pro ∞) — their SaaS business model; **not** a feature for our local app.

## Constraints when implementing

- Feature parity only — do not copy redrip source code or assets.
- Local-first: no cloud auth, no Supabase, no telemetry; everything in `chrome.storage.local`.
- New permissions needed over time: `notifications` (task alerts), `api.openai.com` (AI), Leboncoin hosts (crosslist).
- Every automated action: enabled flag, idle-queue gate, delay/jitter caps, per-item persisted results, logged skip reasons (skill rule #4/#5).
- Modules land one at a time; relist E2E confirmation remains the gate for starting new modules (WORKFLOW_STATE.md).
