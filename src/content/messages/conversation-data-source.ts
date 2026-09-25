/**
 * Adapter: read-only conversation client → ConversationDataSource (T3.2/T3.1).
 *
 * The scanner talks only to this adapter; the adapter only calls the
 * GET-only client. Errors are re-thrown as ConversationScanError so the
 * scanner can classify them (session/rate/CAPTCHA/structure) and fail the
 * scan closed.
 *
 * Response shapes tolerated (anything else → unsupported-structure):
 *  - { items: [...], next_cursor?: string|number, total_pages?, current_page? }
 *  - { conversations: [...] }                      (alias)
 *  - a bare array of rows
 */

import type { ConversationDataSource, ConversationPage } from '../../core/messages/contracts';
import { ConversationScanError } from '../../core/messages/conversation-scanner';
import type { ReadOnlyConversationClient } from './conversation-api-client';

const FAILURE_CODE_MAP = {
  'session-expired': 'session-expired',
  'rate-limited': 'rate-limited',
  captcha: 'captcha',
  'http-error': 'unknown',
  'network-error': 'unknown',
} as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractRows(data: unknown): unknown[] | null {
  if (Array.isArray(data)) {
    // Array.isArray narrows to any[]; copy through an explicit typed loop so
    // no `any` escapes this helper.
    const rows: unknown[] = [];
    for (const item of data as unknown[]) {
      rows.push(item);
    }
    return rows;
  }
  const record = asRecord(data);
  if (record === null) {
    return null;
  }
  const items = record.items ?? record.conversations;
  return Array.isArray(items) ? items : null;
}

function extractPagination(
  data: unknown,
  requestedCursor: string | undefined,
): { hasMore: boolean; nextCursor?: string } {
  const record = asRecord(data);
  if (record === null) {
    return { hasMore: false };
  }

  const rawCursor = record.next_cursor ?? record.nextCursor;
  const nextCursor =
    typeof rawCursor === 'string' && rawCursor.trim() !== ''
      ? rawCursor
      : typeof rawCursor === 'number' && Number.isFinite(rawCursor)
        ? String(rawCursor)
        : undefined;

  const explicitHasMore = record.has_more ?? record.hasMore;
  if (typeof explicitHasMore === 'boolean') {
    return nextCursor !== undefined
      ? { hasMore: explicitHasMore, nextCursor }
      : { hasMore: explicitHasMore };
  }

  // Fallback: more data exists iff a *new* cursor came back.
  return nextCursor !== undefined && nextCursor !== requestedCursor
    ? { hasMore: true, nextCursor }
    : { hasMore: false };
}

export function createConversationApiDataSource(
  client: ReadOnlyConversationClient,
): ConversationDataSource {
  return {
    kind: 'read-only-api',

    async fetchPage(cursor?: string): Promise<ConversationPage> {
      const response = await client.listConversations({
        ...(cursor !== undefined ? { cursor } : {}),
      });

      if (!response.ok) {
        throw new ConversationScanError(
          FAILURE_CODE_MAP[response.code],
          `Conversation listing failed (${response.code}).`,
        );
      }

      const rows = extractRows(response.data);
      if (rows === null) {
        throw new ConversationScanError(
          'unsupported-structure',
          'Conversation listing response does not match any known structure.',
        );
      }

      const pagination = extractPagination(response.data, cursor);
      return {
        raw: rows,
        hasMore: pagination.hasMore,
        ...(pagination.nextCursor !== undefined ? { nextCursor: pagination.nextCursor } : {}),
      };
    },
  };
}
