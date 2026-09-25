/**
 * Read-only conversation scanner (T3.1) — orchestration only.
 *
 * Flow: page loop → normalize rows → dedupe by stable id → result.
 * Pure decisions; the only I/O is `source.fetchPage` (read-only by
 * contract — the concrete GET-only client lives in src/content/messages).
 *
 * Failure policy (fail-closed):
 *  - any page fetch error, session/rate/CAPTCHA signal, or unrecognized
 *    page structure stops the loop and marks `complete: false`;
 *  - a failed scan keeps its collected rows for diagnostics, but the
 *    snapshot layer refuses to persist `complete: false` results;
 *  - pagination is guarded by a page cap, a loop check (cursor must
 *    advance) and an explicit missing-cursor warning;
 *  - no retries: session/rate/CAPTCHA failures wait for a human.
 */

import type {
  Conversation,
  ConversationDataSource,
  ConversationPage,
  ConversationScanResult,
  ConversationScanWarning,
} from './contracts';
import { dedupeConversations } from './conversation-dedupe';
import { normalizeConversation } from './conversation-normalizer';

export type ConversationScanErrorCode =
  | 'session-expired'
  | 'rate-limited'
  | 'captcha'
  | 'unsupported-structure'
  | 'unknown';

/**
 * Error a data source may throw to classify a failure precisely.
 * The scanner also classifies plain errors by message (401/403/429/captcha).
 */
export class ConversationScanError extends Error {
  readonly code: ConversationScanErrorCode;

  constructor(code: ConversationScanErrorCode, message: string) {
    super(message);
    this.name = 'ConversationScanError';
    this.code = code;
  }
}

export interface ScanConversationsOptions {
  /** Logged-in Vinted user id — resolves own-vs-foreign authorship. */
  selfUserId?: string;
  /** Hard page cap per scan (resume via nextCursor). Default 50. */
  maxPages?: number;
  /** Injectable scan id generator (tests use a fixed one). */
  makeScanId?: () => string;
  /** Injectable clock (epoch ms) — tests never read the system time. */
  now?: () => number;
}

function defaultScanId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `scan-${Date.now()}`;
  }
}

/**
 * Bundle-safe check: content-layer adapters may live in a different
 * bundle (separate copy of this class), so `instanceof` alone is not
 * reliable — a structural match on the class name + code is.
 */
function isConversationScanError(error: unknown): error is ConversationScanError {
  if (error instanceof ConversationScanError) {
    return true;
  }
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  return (
    candidate.name === 'ConversationScanError' &&
    typeof candidate.message === 'string' &&
    typeof candidate.code === 'string' &&
    ['session-expired', 'rate-limited', 'captcha', 'unsupported-structure', 'unknown'].includes(
      candidate.code,
    )
  );
}

function classifyThrownError(error: unknown): ConversationScanWarning {
  if (isConversationScanError(error)) {
    const code = error.code === 'unknown' ? 'page-fetch-failed' : error.code;
    return { code, message: error.message };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/\b401\b|\b403\b|session|unauthori[sz]ed/i.test(message)) {
    return { code: 'session-expired', message };
  }
  if (/\b429\b|rate.?limit/i.test(message)) {
    return { code: 'rate-limited', message };
  }
  if (/captcha|datadome/i.test(message)) {
    return { code: 'captcha', message };
  }
  return { code: 'page-fetch-failed', message };
}

export async function scanConversations(
  source: ConversationDataSource,
  options: ScanConversationsOptions = {},
): Promise<ConversationScanResult> {
  const now = options.now ?? ((): number => Date.now());
  const makeScanId = options.makeScanId ?? defaultScanId;
  const maxPages = Math.max(1, Math.floor(options.maxPages ?? 50));

  const startedAt = new Date(now()).toISOString();
  const warnings: ConversationScanWarning[] = [];
  const collected: Conversation[] = [];

  let complete = true;
  let hasMore = false;
  let nextCursor: string | undefined;
  let cursor: string | undefined;

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
    let page: ConversationPage;
    try {
      page = await source.fetchPage(cursor);
    } catch (error) {
      warnings.push(classifyThrownError(error));
      complete = false;
      break;
    }

    if (!Array.isArray(page.raw)) {
      warnings.push({
        code: 'unsupported-structure',
        message: 'Data source returned a page without a raw row array — scan stopped.',
      });
      complete = false;
      break;
    }

    for (let index = 0; index < page.raw.length; index++) {
      const normalized = normalizeConversation(page.raw[index], {
        selfUserId: options.selfUserId,
      });
      if (normalized.ok) {
        collected.push(normalized.conversation);
        warnings.push(...normalized.warnings);
      } else {
        warnings.push(
          normalized.warning.itemId === undefined
            ? { ...normalized.warning, itemId: `row:${String(index)}` }
            : normalized.warning,
        );
      }
    }

    hasMore = page.hasMore;
    nextCursor = page.nextCursor;

    if (!hasMore) {
      break;
    }
    if (nextCursor === undefined || nextCursor === '') {
      warnings.push({
        code: 'missing-cursor',
        message: 'Page announced more data but returned no cursor — scan stopped (rescan to continue).',
      });
      break;
    }
    if (nextCursor === cursor) {
      warnings.push({
        code: 'pagination-loop',
        message: `Cursor did not advance ("${nextCursor}") — scan stopped to avoid an infinite loop.`,
      });
      break;
    }
    if (pageNumber === maxPages) {
      warnings.push({
        code: 'max-pages-reached',
        message: `Page cap (${maxPages}) reached with more data available — resume with the returned cursor.`,
      });
      break;
    }
    cursor = nextCursor;
  }

  const deduped = dedupeConversations(collected);
  for (const duplicateId of deduped.duplicates) {
    warnings.push({
      code: 'duplicate-item',
      message: `Conversation ${duplicateId} appeared more than once in this scan — kept the first occurrence.`,
      itemId: duplicateId,
    });
  }

  return {
    scanId: makeScanId(),
    startedAt,
    finishedAt: new Date(now()).toISOString(),
    source: source.kind,
    conversations: deduped.conversations,
    warnings,
    hasMore,
    ...(nextCursor !== undefined ? { nextCursor } : {}),
    complete,
  };
}
