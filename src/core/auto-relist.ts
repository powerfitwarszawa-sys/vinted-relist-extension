/**
 * Pure selection and gating logic for the scheduled (automatic) relist cycle.
 *
 * Redrip-style auto-bump: on a fixed cadence the background alarm asks this
 * module which scanned listings are due for another relist and whether a cycle
 * may start at all. Keeping the decisions here (no chrome, no DOM, no clock
 * side effects) makes them fully unit-testable and keeps the background
 * orchestrator thin.
 */

import type { Listing, PersistedScan, QueueStatus, SellerListingStatus } from './contracts';

/** Maximum age of the saved scan before an automatic cycle refuses to run. */
export const SCAN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AutoRelistOptions {
  /** Only listings older than this many hours since their last relist qualify. */
  minHoursSinceRelist: number;
  /** Upper bound on how many listings a single cycle may enqueue. */
  maxPerCycle: number;
  /** Current wall-clock time in epoch ms. Injected for deterministic tests. */
  now: number;
}

/** Only genuinely active seller-side items may be auto-relisted. */
function isEligibleStatus(sourceStatus: SellerListingStatus | undefined): boolean {
  // No source status at all (legacy scan) is treated as active, matching the
  // manual queue's optimistic default. Explicitly unknown items are NOT bumped:
  // the scan could not prove they are active, so automation stays conservative.
  // Hidden/sold/reserved/draft are never auto-bumped.
  return sourceStatus === undefined || sourceStatus === 'active';
}

/**
 * Returns the subset of listings that are due for an automatic relist, capped
 * at maxPerCycle. The oldest (or never relisted) items are prioritised so the
 * whole wardrobe rotates fairly across cycles.
 */
export function selectDueForAutoRelist(
  listings: readonly Listing[],
  options: AutoRelistOptions,
): Listing[] {
  const minAgeMs = Math.max(0, options.minHoursSinceRelist) * 60 * 60 * 1000;
  const cap = Math.max(0, Math.floor(options.maxPerCycle));
  if (cap === 0) return [];

  const due = listings.filter((listing) => {
    if (!listing.id) return false;
    if (!isEligibleStatus(listing.sourceStatus)) return false;

    // Never relisted -> always due.
    if (listing.lastRelisted === undefined) return true;

    return options.now - listing.lastRelisted >= minAgeMs;
  });

  // Oldest first; never-relisted items (treated as time 0) sort to the front.
  due.sort((a, b) => (a.lastRelisted ?? 0) - (b.lastRelisted ?? 0));

  return due.slice(0, cap);
}

export interface AutoRelistGate {
  /** True when an automatic cycle may start right now. */
  allowed: boolean;
  /** Human-readable reason (Polish), present when the cycle is blocked. */
  reason?: string;
}

/** True when the queue still owns items that are not terminal (queued/running/paused). */
export function hasPendingQueueItems(status: Pick<QueueStatus, 'state' | 'items'>): boolean {
  return status.items.some((item) => item.status === 'queued' || item.status === 'running' || item.status === 'paused');
}

/**
 * Decides whether an automatic relist cycle may start. A cycle is allowed only
 * when: auto-relist is enabled, the queue is completely idle (a manual batch or
 * a previous automatic batch must finish first), and a fresh-enough saved scan
 * exists. Reasons are deterministic so tests and logs stay stable.
 */
export function evaluateAutoRelistGate(
  enabled: boolean,
  queueStatus: Pick<QueueStatus, 'state' | 'items'>,
  scan: PersistedScan | null,
  options: { now: number; maxScanAgeMs?: number },
): AutoRelistGate {
  if (!enabled) {
    return { allowed: false, reason: 'automatyczne podbijanie jest wyłączone w ustawieniach' };
  }

  if (queueStatus.state !== 'idle' || hasPendingQueueItems(queueStatus)) {
    return { allowed: false, reason: `kolejka nie jest bezczynna (stan: ${queueStatus.state})` };
  }

  if (!scan || scan.listings.length === 0) {
    return { allowed: false, reason: 'brak zapisanego skanu garderoby — najpierw zeskanuj garderobę' };
  }

  const maxAgeMs = options.maxScanAgeMs ?? SCAN_MAX_AGE_MS;
  const ageDays = (options.now - scan.scannedAt) / (24 * 60 * 60 * 1000);
  if (ageDays > maxAgeMs / (24 * 60 * 60 * 1000)) {
    return {
      allowed: false,
      reason: `zapisany skan ma ${ageDays.toFixed(1)} dni — zeskanuj garderobę ponownie`,
    };
  }

  return { allowed: true };
}