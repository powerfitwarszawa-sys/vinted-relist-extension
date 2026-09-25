/**
 * Deterministic, pure normalization of untrusted Vinted conversation rows
 * into `Conversation` (T3.3).
 *
 * Rules:
 *  - only reads; never calls the network/DOM/storage/clock,
 *  - same input → identical output (no randomness, no Date.now()),
 *  - a stable conversation id is required — rows without it are dropped,
 *  - unknown/missing values are never treated as valid: they produce
 *    warnings and degrade `dataQuality`,
 *  - `replied` requires a *known* own authorship; missing data can only
 *    map to `awaiting-reply` (author known: them) or `unknown`,
 *  - the expected Vinted shape is documented below; anything outside it
 *    yields an explicit `unsupported-structure` / `invalid-item` warning.
 *
 * Expected raw shape (tolerated aliases in parentheses):
 * {
 *   id | conversation_id: string|number,
 *   participant | user: { id, login | name }   (user_id, user_login),
 *   unread_count | unread | is_unread: number|bool,
 *   is_archived | archived: bool,
 *   url | conversation_url: string,
 *   item | listing: { id, title, price, currency },
 *   last_message | lastMessage: { body | message | text,
 *                                 created_at | createdAt | date,
 *                                 sender_id | senderId }
 * }
 */

import type {
  Conversation,
  ConversationDataQuality,
  ConversationScanStatus,
  ConversationScanWarning,
} from './contracts';

export interface NormalizeConversationOptions {
  /**
   * The logged-in Vinted user id — required to resolve own-vs-foreign
   * authorship. Without it the author axis resolves to `unknown`.
   */
  selfUserId?: string;
}

export type NormalizeConversationResult =
  | { ok: true; conversation: Conversation; warnings: ConversationScanWarning[] }
  | { ok: false; warning: ConversationScanWarning };

// ── tolerant readers (unknown → null, never a guess) ───────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asIdString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function asNonNegativeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value);
  }
  return null;
}

function asBooleanFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === 0) return value === 1;
  if (value === 'true' || value === 'false') return value === 'true';
  return null;
}

type DateFieldState =
  | { state: 'ok'; iso: string }
  | { state: 'missing' }
  | { state: 'invalid' };

/** Dates must be parseable strings — numbers/other shapes count as invalid. */
function parseDateField(value: unknown): DateFieldState {
  if (value === undefined || value === null || value === '') {
    return { state: 'missing' };
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return { state: 'ok', iso: new Date(parsed).toISOString() };
    }
  }
  return { state: 'invalid' };
}

function firstDefined(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

// ── normalization ──────────────────────────────────────────────────

function computeScanStatus(input: {
  archived: boolean;
  unreadCount: number;
  lastMessageFromSelf?: boolean;
}): ConversationScanStatus {
  if (input.archived) return 'archived';
  if (input.unreadCount > 0) return 'unread';
  if (input.lastMessageFromSelf === true) return 'replied';
  if (input.lastMessageFromSelf === false) return 'awaiting-reply';
  return 'unknown';
}

function resolveConversationUrl(raw: Record<string, unknown>): { url?: string; invalid: boolean } {
  const candidate = firstDefined(raw.url, raw.conversation_url, raw.link);
  if (candidate === undefined) {
    return { invalid: false };
  }
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    return { invalid: true };
  }
  const value = candidate.trim();
  if (/^https?:\/\//i.test(value) || value.startsWith('/')) {
    return { url: value, invalid: false };
  }
  return { invalid: true };
}

export function normalizeConversation(
  raw: unknown,
  options: NormalizeConversationOptions = {},
): NormalizeConversationResult {
  const record = asRecord(raw);
  if (record === null) {
    return {
      ok: false,
      warning: { code: 'invalid-item', message: 'Conversation row is not an object.' },
    };
  }

  const id = asIdString(firstDefined(record.id, record.conversation_id));
  if (id === null) {
    return {
      ok: false,
      warning: { code: 'missing-id', message: 'Conversation row has no stable id — dropped.' },
    };
  }

  const warnings: ConversationScanWarning[] = [];
  const warn = (code: ConversationScanWarning['code'], message: string): void => {
    warnings.push({ code, message, itemId: id });
  };

  // Participant / author axis.
  const participant = asRecord(firstDefined(record.participant, record.user, record.partner));
  const userId =
    asIdString(
      firstDefined(
        participant?.id,
        record.user_id,
        record.participant_id,
        record.partner_id,
      ),
    ) ?? '';
  const username =
    asIdString(
      firstDefined(
        participant?.login,
        participant?.name,
        record.user_login,
        record.username,
      ),
    ) ?? '';
  if (userId === '') {
    warn('missing-field', 'Participant id is missing — user identity unknown.');
  }
  if (username === '') {
    warn('missing-field', 'Participant username is missing.');
  }

  // Unread axis.
  const unreadRaw = firstDefined(record.unread_count, record.unread, record.is_unread);
  let unreadCount = 0;
  if (unreadRaw === undefined) {
    warn('missing-field', 'Unread flag is missing — defaulting the counter to 0, status stays unproven.');
  } else {
    const flag = asBooleanFlag(unreadRaw);
    if (flag !== null) {
      unreadCount = flag ? 1 : 0;
    } else {
      const numeric = asNonNegativeNumber(unreadRaw);
      if (numeric === null) {
        warn('missing-field', 'Unread flag has an unrecognized shape — defaulting the counter to 0.');
      } else {
        unreadCount = numeric;
      }
    }
  }

  // Archived axis.
  const archived = asBooleanFlag(firstDefined(record.is_archived, record.archived)) ?? false;

  // Last message axis.
  const lastMessage = asRecord(firstDefined(record.last_message, record.lastMessage));
  let lastMessageBody = '';
  let lastMessageAt: string | undefined;
  let lastMessageFromSelf: boolean | undefined;

  if (lastMessage !== null) {
    const body = firstDefined(lastMessage.body, lastMessage.message, lastMessage.text);
    if (typeof body === 'string') {
      lastMessageBody = body;
    } else {
      warn('missing-field', 'Last message body is missing or has an unrecognized shape.');
    }

    const dateField = parseDateField(
      firstDefined(lastMessage.created_at, lastMessage.createdAt, lastMessage.date),
    );
    if (dateField.state === 'ok') {
      lastMessageAt = dateField.iso;
    } else if (dateField.state === 'missing') {
      warn('missing-date', 'Last message has no timestamp — treated as unknown.');
    } else {
      warn('invalid-date', 'Last message timestamp is unparseable — treated as unknown.');
    }

    const senderId = asIdString(
      firstDefined(lastMessage.sender_id, lastMessage.senderId, lastMessage.user_id),
    );
    if (senderId !== null && options.selfUserId !== undefined && options.selfUserId !== '') {
      lastMessageFromSelf = senderId === options.selfUserId;
    } else {
      warn(
        'unknown-author',
        senderId === null
          ? 'Last message author is unknown — reply status cannot be proven.'
          : 'Self user id is not configured — reply status cannot be proven.',
      );
    }
  }

  // Linked listing axis (optional; absent item is legitimate).
  const item = asRecord(firstDefined(record.item, record.listing));
  let itemId: string | undefined;
  let itemTitle: string | undefined;
  let itemPrice: number | undefined;
  let currency: string | undefined;
  if (item !== null) {
    itemId = asIdString(item.id) ?? undefined;
    itemTitle = asIdString(item.title) ?? undefined;
    const price = asNonNegativeNumber(item.price);
    itemPrice = price ?? undefined;
    currency = asIdString(item.currency) ?? undefined;
    if (itemId === undefined || itemTitle === undefined || price === null) {
      warn('missing-field', 'Linked item data is incomplete.');
    }
  }

  // Conversation URL: keep only shapes we recognize; never guess a domain.
  const urlResult = resolveConversationUrl(record);
  if (urlResult.invalid) {
    warn('missing-field', 'Conversation URL is present but not a usable URL.');
  }

  // Recognized-structure check: an object with an id but none of the known
  // fields is an unsupported shape, not a valid empty conversation.
  const recognizedKeys = [
    'participant', 'user', 'partner', 'user_id', 'participant_id', 'partner_id',
    'unread_count', 'unread', 'is_unread', 'is_archived', 'archived',
    'last_message', 'lastMessage', 'item', 'listing', 'url', 'conversation_url', 'link',
  ];
  const recognizedHits = recognizedKeys.filter((key) => record[key] !== undefined).length;
  if (recognizedHits === 0) {
    return {
      ok: false,
      warning: {
        code: 'unsupported-structure',
        message: 'Conversation object matches no known Vinted structure — excluded from the snapshot.',
        itemId: id,
      },
    };
  }

  const scanStatus = computeScanStatus({ archived, unreadCount, lastMessageFromSelf });

  // Data quality: any warning → degraded; clean row → complete.
  const dataQuality: ConversationDataQuality = warnings.length > 0 ? 'degraded' : 'complete';

  const conversation: Conversation = {
    id,
    userId,
    username,
    lastMessageBody,
    unreadCount,
    scanStatus,
    dataQuality,
  };
  if (itemId !== undefined) conversation.itemId = itemId;
  if (itemTitle !== undefined) conversation.itemTitle = itemTitle;
  if (itemPrice !== undefined) conversation.itemPrice = itemPrice;
  if (currency !== undefined) conversation.currency = currency;
  if (lastMessageAt !== undefined) conversation.lastMessageAt = lastMessageAt;
  if (lastMessageFromSelf !== undefined) conversation.lastMessageFromSelf = lastMessageFromSelf;
  if (urlResult.url !== undefined) conversation.conversationUrl = urlResult.url;

  return { ok: true, conversation, warnings };
}
