/**
 * Pure cooldown / limits gate for message sending (fail-closed).
 *
 * Evaluation priority (the first matching block wins and is reported):
 *  1. in-flight          — a `reserved` entry exists for the conversation
 *  2. uncertain          — an `uncertain` entry exists (outcome unknown)
 *  3. duplicate-content  — identical body already `sent` in this conversation
 *  4. hourly-limit       — sends in the last hour >= maxMessagesPerHour
 *  5. daily-limit        — sends in the last 24 h  >= maxMessagesPerDay
 *  6. conversation-cooldown
 *  7. user-cooldown
 *
 * Rules:
 *  - `nowMs` is always an argument — tests never read the system clock,
 *  - `failed` history entries are not sends: they neither block nor count,
 *  - a `sent` entry with a missing/invalid ISO timestamp fails closed
 *    (blocks its conversation/user until verified manually),
 *  - invalid settings fail closed (invalid cooldown = block, invalid limit
 *    = zero remaining capacity),
 *  - the function never mutates the input history or settings.
 */

import type { CooldownInput, CooldownResult, MessageHistoryEntry } from './contracts';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function parseIsoMs(value: string | null | undefined): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function failClosed(reason: string): CooldownResult {
  return { allowed: false, code: 'conversation-cooldown', reason };
}

/** Minutes setting → duration in ms; invalid values fail closed (block). */
function cooldownMs(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes < 0) {
    return Number.POSITIVE_INFINITY;
  }
  return minutes * 60_000;
}

/** Limit setting → capacity; invalid values fail closed (zero capacity). */
function limitOf(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

export function evaluateMessageCooldown(input: CooldownInput): CooldownResult {
  const { nowMs, conversationId, userId, bodyHash, settings, history } = input;

  if (!Number.isFinite(nowMs)) {
    return failClosed('Invalid nowMs — refusing to evaluate cooldowns with an unknown clock.');
  }

  const entries: readonly MessageHistoryEntry[] = history ?? [];

  const forConversation = entries.filter((entry) => entry.conversationId === conversationId);

  // 1. In-flight: a reservation exists — a send may be in progress.
  if (forConversation.some((entry) => entry.status === 'reserved')) {
    return {
      allowed: false,
      code: 'in-flight',
      reason: `A message to conversation ${conversationId} is already reserved/in flight.`,
    };
  }

  // 2. Uncertain: outcome unknown — manual verification required, no retry.
  if (forConversation.some((entry) => entry.status === 'uncertain')) {
    return {
      allowed: false,
      code: 'uncertain-verification-required',
      reason:
        `A previous send to conversation ${conversationId} has an unknown outcome. ` +
        'Verify Vinted manually and resolve the history entry first.',
    };
  }

  // 3. Duplicate: identical body already sent in this conversation.
  if (
    bodyHash !== '' &&
    forConversation.some((entry) => entry.status === 'sent' && entry.bodyHash === bodyHash)
  ) {
    return {
      allowed: false,
      code: 'duplicate-content',
      reason: `Identical content was already sent to conversation ${conversationId}.`,
    };
  }

  const sentEntries = entries.filter((entry) => entry.status === 'sent');
  const sentTimes: number[] = [];
  for (const entry of sentEntries) {
    const parsed = parseIsoMs(entry.sentAt);
    // Unparseable timestamps still consume window capacity (fail-closed).
    sentTimes.push(parsed ?? nowMs);
  }

  // 4. Hourly limit.
  const hourlyLimit = limitOf(settings.maxMessagesPerHour);
  const hourlyTimes = sentTimes.filter((sent) => nowMs - sent < HOUR_MS);
  if (hourlyTimes.length >= hourlyLimit) {
    const ascending = [...hourlyTimes].sort((a, b) => a - b);
    const offender =
      hourlyLimit > 0 ? ascending[hourlyTimes.length - hourlyLimit] : undefined;
    return {
      allowed: false,
      code: 'hourly-limit',
      reason:
        hourlyLimit > 0
          ? `Hourly message limit reached (${hourlyLimit}/h).`
          : 'Hourly message limit is 0 or invalid — failing closed.',
      retryAtMs: offender !== undefined ? offender + HOUR_MS : undefined,
    };
  }

  // 5. Daily limit.
  const dailyLimit = limitOf(settings.maxMessagesPerDay);
  const dailyTimes = sentTimes.filter((sent) => nowMs - sent < DAY_MS);
  if (dailyTimes.length >= dailyLimit) {
    const ascending = [...dailyTimes].sort((a, b) => a - b);
    const offender = dailyLimit > 0 ? ascending[dailyTimes.length - dailyLimit] : undefined;
    return {
      allowed: false,
      code: 'daily-limit',
      reason:
        dailyLimit > 0
          ? `Daily message limit reached (${dailyLimit}/day).`
          : 'Daily message limit is 0 or invalid — failing closed.',
      retryAtMs: offender !== undefined ? offender + DAY_MS : undefined,
    };
  }

  // 6. Conversation cooldown.
  const conversationSent = forConversation.filter((entry) => entry.status === 'sent');
  if (conversationSent.length > 0) {
    const lastSent = Math.max(
      ...conversationSent.map((entry) => parseIsoMs(entry.sentAt) ?? Number.NaN),
    );
    if (!Number.isFinite(lastSent)) {
      return {
        allowed: false,
        code: 'conversation-cooldown',
        reason:
          `Last send time for conversation ${conversationId} is unknown (invalid timestamp). ` +
          'Verify manually before replying.',
      };
    }
    const waitMs = cooldownMs(settings.conversationCooldownMinutes);
    if (nowMs < lastSent + waitMs) {
      return {
        allowed: false,
        code: 'conversation-cooldown',
        reason: `Conversation ${conversationId} is still inside its cooldown window.`,
        retryAtMs: Number.isFinite(lastSent + waitMs) ? lastSent + waitMs : undefined,
      };
    }
  }

  // 7. User cooldown (across conversations).
  const userSent = sentEntries.filter((entry) => entry.userId === userId);
  if (userSent.length > 0) {
    const lastUserSent = Math.max(
      ...userSent.map((entry) => parseIsoMs(entry.sentAt) ?? Number.NaN),
    );
    if (!Number.isFinite(lastUserSent)) {
      return {
        allowed: false,
        code: 'user-cooldown',
        reason: `Last send time for user ${userId} is unknown (invalid timestamp). Verify manually.`,
      };
    }
    const waitMs = cooldownMs(settings.userCooldownMinutes);
    if (nowMs < lastUserSent + waitMs) {
      return {
        allowed: false,
        code: 'user-cooldown',
        reason: `User ${userId} is still inside their cooldown window.`,
        retryAtMs: Number.isFinite(lastUserSent + waitMs) ? lastUserSent + waitMs : undefined,
      };
    }
  }

  return { allowed: true, code: 'ok', reason: 'All cooldowns and limits satisfied.' };
}
