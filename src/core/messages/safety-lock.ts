/**
 * Safety Lock (T2) — shared fail-closed gate for message operations.
 *
 * Detection, persistence, and release wiring live elsewhere; this module is
 * pure logic only (no chrome.*, no clock reads — `now` is always an argument).
 *
 * Rules (project decision):
 *  - an inactive lock never blocks,
 *  - an active lock always blocks `canStartMessageOperation`,
 *  - timed reasons (`captcha`, `rate-limit`, `session-expired`,
 *    `consecutive-errors`) auto-expire only at `now >= unlockAt`,
 *  - `manual` and `uncertain-operation` NEVER auto-release — even if a
 *    `until` is passed to `createSafetyLock` it is dropped for them,
 *  - releasing requires an explicit `releaseSafetyLock` call; `system`
 *    cannot release `manual` / `uncertain-operation` locks (only `user`),
 *  - no CAPTCHA detection and no message sending at this stage.
 */

import type {
  MessageSafetyLock,
  MessageSafetyLockReason,
  SafetyLockReleaseResult,
} from './contracts';

/** Reasons that may auto-expire at `unlockAt`. */
const TIMED_REASONS: ReadonlySet<MessageSafetyLockReason> = new Set([
  'captcha',
  'rate-limit',
  'session-expired',
  'consecutive-errors',
]);

/** Reasons that only an explicit user action may release. */
const MANUAL_ONLY_REASONS: ReadonlySet<MessageSafetyLockReason> = new Set([
  'manual',
  'uncertain-operation',
]);

function toIso(value: number): string {
  return new Date(value).toISOString();
}

function parseIsoMs(value: string | null | undefined): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function createSafetyLock(
  reason: MessageSafetyLockReason,
  now: number,
  until?: number,
  metadata?: MessageSafetyLock['metadata'],
): MessageSafetyLock {
  const timed = TIMED_REASONS.has(reason);
  const unlockAt =
    timed && typeof until === 'number' && Number.isFinite(until) ? toIso(until) : null;

  const lock: MessageSafetyLock = {
    active: true,
    reason,
    // A malformed `now` must not throw — keep a valid ISO timestamp.
    createdAt: toIso(Number.isFinite(now) ? now : 0),
    unlockAt,
  };
  if (metadata !== undefined) {
    lock.metadata = metadata;
  }
  return lock;
}

/**
 * Is the lock in force right now? A malformed active lock counts as active
 * (fail-closed); an inactive lock is never active.
 */
export function isSafetyLockActive(lock: MessageSafetyLock | null | undefined, now: number): boolean {
  if (lock?.active !== true) {
    return false;
  }

  const unlockAtMs = parseIsoMs(lock.unlockAt);
  if (unlockAtMs === null) {
    // No effective expiry (manual-only, uncertain, or created without until).
    return true;
  }
  if (!lock.reason || !TIMED_REASONS.has(lock.reason)) {
    // Never auto-release non-timed reasons, regardless of stored unlockAt.
    return true;
  }
  if (!Number.isFinite(now)) {
    // Unknown clock — fail closed.
    return true;
  }
  return now < unlockAtMs;
}

export function canStartMessageOperation(
  lock: MessageSafetyLock | null | undefined,
  now: number,
): boolean {
  return !isSafetyLockActive(lock, now);
}

/**
 * Explicit release. Returns a NEW lock object (input is never mutated).
 * `system` may only release timed locks; `manual` and `uncertain-operation`
 * require actor `'user'`.
 */
export function releaseSafetyLock(
  lock: MessageSafetyLock | null | undefined,
  now: number,
  actor: 'user' | 'system',
): SafetyLockReleaseResult {
  if (!lock) {
    return { ok: true, lock: { active: false, createdAt: toIso(Number.isFinite(now) ? now : 0) } };
  }
  if (!lock.active) {
    // Idempotent: releasing an already inactive lock succeeds unchanged.
    return { ok: true, lock };
  }
  if (!Number.isFinite(now)) {
    // Fail closed: never release with an unknown clock.
    return { ok: false, lock, error: 'Invalid release timestamp — refusing to release the lock.' };
  }
  if (actor !== 'user' && lock.reason !== undefined && MANUAL_ONLY_REASONS.has(lock.reason)) {
    return {
      ok: false,
      lock,
      error: `Lock reason "${lock.reason}" can only be released by the user (explicit action).`,
    };
  }

  return {
    ok: true,
    lock: {
      ...lock,
      active: false,
      releasedAt: toIso(now),
      releasedBy: actor,
    },
  };
}
