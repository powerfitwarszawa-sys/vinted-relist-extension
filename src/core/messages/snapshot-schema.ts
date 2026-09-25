/**
 * Snapshot schema: versioning, read validation and migration (T4A).
 *
 * Version history:
 *   0 (implicit) — legacy/unversioned payload: same recognizable fields
 *                  as v1 but NO `schemaVersion`. Migrated on read.
 *   1            — current shape (T3 builder output).
 *   2+           — unknown → fail closed (null). Never guessed, never
 *                  reset: a future version ships WITH a migration step.
 *
 * Guarantees:
 *  - validation rebuilds a fresh object from known fields (junk keys are
 *    dropped, the caller's payload is never aliased or mutated),
 *  - fingerprint is recomputed and must match — tampered data is rejected,
 *  - legacy migration recomputes count/fingerprint and fills missing
 *    fields with HONEST values only (`'unknown'` status, `'degraded'`
 *    quality) — never with guessed data; a single unmigratable row
 *    rejects the whole payload (no silent row dropping),
 *  - reads NEVER write: migration is computed on the fly, storage is
 *    only changed by an explicit save.
 */

import type { Conversation, ConversationScanWarning } from './contracts';
import { fingerprintConversations } from './snapshot-fingerprint';

export const CONVERSATION_SNAPSHOT_SCHEMA_VERSION = 1;

export interface ConversationSnapshot {
  schemaVersion: number;
  scanId: string;
  startedAt: string;
  finishedAt: string;
  /** When this snapshot was written to storage (epoch ms → ISO). */
  savedAt: string;
  source: 'dom' | 'read-only-api';
  conversationCount: number;
  hasMore: boolean;
  nextCursor?: string;
  warnings: ConversationScanWarning[];
  /** Deterministic fingerprint of the normalized conversation data. */
  fingerprint: string;
  conversations: Conversation[];
}

export type SaveSnapshotResult =
  | { ok: true; snapshot: ConversationSnapshot }
  | { ok: false; error: string };

// ── readers ────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && Number.isFinite(Date.parse(value));
}

const SCAN_SOURCES = ['dom', 'read-only-api'] as const;
const SCAN_STATUSES = ['unread', 'awaiting-reply', 'replied', 'archived', 'unknown'] as const;
const DATA_QUALITIES = ['complete', 'degraded', 'unknown'] as const;

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function validateOptionalConversationFields(
  record: Record<string, unknown>,
  target: Conversation,
): boolean {
  if (record.itemId !== undefined && !isNonEmptyString(record.itemId)) return false;
  if (record.itemTitle !== undefined && typeof record.itemTitle !== 'string') return false;
  if (record.itemPrice !== undefined) {
    if (typeof record.itemPrice !== 'number' || !Number.isFinite(record.itemPrice) || record.itemPrice < 0) {
      return false;
    }
  }
  if (record.currency !== undefined && !isNonEmptyString(record.currency)) return false;
  if (record.lastMessageAt !== undefined && !isIsoDateTime(record.lastMessageAt)) return false;
  if (record.lastMessageFromSelf !== undefined && typeof record.lastMessageFromSelf !== 'boolean') {
    return false;
  }
  if (record.conversationUrl !== undefined && !isNonEmptyString(record.conversationUrl)) return false;
  if (record.replyStatus !== undefined && !isNonEmptyString(record.replyStatus)) return false;
  if (record.lastError !== undefined && typeof record.lastError !== 'string') return false;

  if (record.itemId !== undefined) target.itemId = record.itemId;
  if (record.itemTitle !== undefined) target.itemTitle = record.itemTitle;
  if (record.itemPrice !== undefined) target.itemPrice = record.itemPrice;
  if (record.currency !== undefined) target.currency = record.currency;
  if (record.lastMessageAt !== undefined) target.lastMessageAt = record.lastMessageAt;
  if (record.lastMessageFromSelf !== undefined) {
    target.lastMessageFromSelf = record.lastMessageFromSelf;
  }
  if (record.conversationUrl !== undefined) target.conversationUrl = record.conversationUrl;
  if (record.replyStatus !== undefined) target.replyStatus = record.replyStatus as Conversation['replyStatus'];
  if (record.lastError !== undefined) target.lastError = record.lastError;
  return true;
}

function validateConversation(raw: unknown): Conversation | null {
  const record = asRecord(raw);
  if (record === null) return null;
  if (!isNonEmptyString(record.id)) return null;
  if (typeof record.userId !== 'string') return null;
  if (typeof record.username !== 'string') return null;
  if (typeof record.lastMessageBody !== 'string') return null;
  if (
    typeof record.unreadCount !== 'number' ||
    !Number.isFinite(record.unreadCount) ||
    record.unreadCount < 0 ||
    !Number.isInteger(record.unreadCount)
  ) {
    return null;
  }
  if (!isOneOf(record.scanStatus, SCAN_STATUSES)) return null;
  if (!isOneOf(record.dataQuality, DATA_QUALITIES)) return null;

  const conversation: Conversation = {
    id: record.id,
    userId: record.userId,
    username: record.username,
    lastMessageBody: record.lastMessageBody,
    unreadCount: record.unreadCount,
    scanStatus: record.scanStatus,
    dataQuality: record.dataQuality,
  };
  if (!validateOptionalConversationFields(record, conversation)) return null;
  return conversation;
}

function validateWarnings(raw: unknown): ConversationScanWarning[] | null {
  if (!Array.isArray(raw)) return null;
  const warnings: ConversationScanWarning[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    if (record === null) return null;
    if (!isNonEmptyString(record.code)) return null;
    if (typeof record.message !== 'string') return null;
    const warning: ConversationScanWarning = {
      code: record.code as ConversationScanWarning['code'],
      message: record.message,
    };
    if (record.itemId !== undefined && !isNonEmptyString(record.itemId)) return null;
    if (record.itemId !== undefined) warning.itemId = record.itemId;
    warnings.push(warning);
  }
  return warnings;
}

/**
 * Strict validation of a CURRENT-version payload. Returns a freshly
 * built object (only known fields) or null — never the input itself.
 */
export function validateStoredSnapshot(raw: unknown): ConversationSnapshot | null {
  const record = asRecord(raw);
  if (record === null) return null;
  if (record.schemaVersion !== CONVERSATION_SNAPSHOT_SCHEMA_VERSION) return null;
  if (!isNonEmptyString(record.scanId)) return null;
  if (!isIsoDateTime(record.startedAt)) return null;
  if (!isIsoDateTime(record.finishedAt)) return null;
  if (!isIsoDateTime(record.savedAt)) return null;
  if (!isOneOf(record.source, SCAN_SOURCES)) return null;
  if (typeof record.hasMore !== 'boolean') return null;
  if (record.nextCursor !== undefined && !isNonEmptyString(record.nextCursor)) return null;
  if (!Array.isArray(record.conversations)) return null;

  const warnings = validateWarnings(record.warnings);
  if (warnings === null) return null;

  const conversations: Conversation[] = [];
  for (const entry of record.conversations) {
    const conversation = validateConversation(entry);
    if (conversation === null) return null;
    conversations.push(conversation);
  }

  if (
    typeof record.conversationCount !== 'number' ||
    !Number.isInteger(record.conversationCount) ||
    record.conversationCount !== conversations.length
  ) {
    return null;
  }
  if (typeof record.fingerprint !== 'string') return null;
  if (fingerprintConversations(conversations, record.source) !== record.fingerprint) {
    return null; // tampered / inconsistent payload
  }

  const snapshot: ConversationSnapshot = {
    schemaVersion: CONVERSATION_SNAPSHOT_SCHEMA_VERSION,
    scanId: record.scanId,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    savedAt: record.savedAt,
    source: record.source,
    conversationCount: conversations.length,
    hasMore: record.hasMore,
    warnings,
    fingerprint: record.fingerprint,
    conversations,
  };
  if (record.nextCursor !== undefined) {
    snapshot.nextCursor = record.nextCursor;
  }
  return snapshot;
}

// ── migration ──────────────────────────────────────────────────────

/**
 * Honest normalization of a legacy (unversioned) conversation row.
 * Missing/invalid fields become `unknown`/`degraded`/defaults — data the
 * extension can PROVE nothing about is never upgraded to a positive
 * claim, and rows without an id reject the whole migration.
 */
function migrateLegacyConversation(raw: unknown): Conversation | null {
  const record = asRecord(raw);
  if (record === null) return null;
  if (!isNonEmptyString(record.id)) return null;

  let filled = false;

  let userId = '';
  if (typeof record.userId === 'string') {
    userId = record.userId;
  } else {
    filled = true;
  }

  let username = '';
  if (typeof record.username === 'string') {
    username = record.username;
  } else {
    filled = true;
  }

  let lastMessageBody = '';
  if (typeof record.lastMessageBody === 'string') {
    lastMessageBody = record.lastMessageBody;
  } else {
    filled = true;
  }

  let unreadCount = 0;
  if (
    typeof record.unreadCount === 'number' &&
    Number.isFinite(record.unreadCount) &&
    record.unreadCount >= 0 &&
    Number.isInteger(record.unreadCount)
  ) {
    unreadCount = record.unreadCount;
  } else {
    filled = true;
  }

  let scanStatus: Conversation['scanStatus'] = 'unknown';
  if (isOneOf(record.scanStatus, SCAN_STATUSES)) {
    scanStatus = record.scanStatus;
  } else {
    filled = true;
  }

  // Legacy dataQuality: keep only a valid claim; any field we had to
  // fill caps the claim at 'degraded' (unknown stays the weakest).
  let claimedQuality: Conversation['dataQuality'] = 'unknown';
  if (isOneOf(record.dataQuality, DATA_QUALITIES)) {
    claimedQuality = record.dataQuality;
  } else {
    filled = true;
  }
  let dataQuality: Conversation['dataQuality'];
  if (claimedQuality === 'unknown') {
    dataQuality = 'unknown';
  } else if (filled && claimedQuality === 'complete') {
    dataQuality = 'degraded';
  } else {
    dataQuality = claimedQuality;
  }

  const conversation: Conversation = {
    id: record.id,
    userId,
    username,
    lastMessageBody,
    unreadCount,
    scanStatus,
    dataQuality,
  };
  if (!validateOptionalConversationFields(record, conversation)) return null;
  return conversation;
}

function migrateLegacySnapshot(record: Record<string, unknown>): ConversationSnapshot | null {
  // Required recognizable fields — anything else is not a legacy
  // snapshot we can trust, so fail closed instead of guessing.
  if (!isNonEmptyString(record.scanId)) return null;
  if (!isOneOf(record.source, SCAN_SOURCES)) return null;
  if (!isIsoDateTime(record.startedAt)) return null;
  if (!isIsoDateTime(record.finishedAt)) return null;
  if (!Array.isArray(record.conversations)) return null;

  const conversations: Conversation[] = [];
  for (const entry of record.conversations) {
    const conversation = migrateLegacyConversation(entry);
    if (conversation === null) return null; // no silent row dropping
    conversations.push(conversation);
  }

  const warnings = validateWarnings(record.warnings) ?? [];

  const assembled: ConversationSnapshot = {
    schemaVersion: CONVERSATION_SNAPSHOT_SCHEMA_VERSION,
    scanId: record.scanId,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    // Legacy had no savedAt: fall back to finishedAt (both describe when
    // the data existed), still an explicit timestamp, never "now".
    savedAt: isIsoDateTime(record.savedAt)
      ? record.savedAt
      : isIsoDateTime(record.finishedAt)
        ? record.finishedAt
        : record.startedAt,
    source: record.source,
    // Recomputed — a legacy count claim is never trusted as-is.
    conversationCount: conversations.length,
    hasMore: record.hasMore === true,
    warnings,
    // Recputed from the actual rows — legacy fingerprints are not trusted.
    fingerprint: fingerprintConversations(conversations, record.source),
    conversations,
  };
  if (isNonEmptyString(record.nextCursor)) {
    assembled.nextCursor = record.nextCursor;
  }

  // Defense in depth: the migrated payload must survive strict v1 validation.
  return validateStoredSnapshot(assembled);
}

/**
 * Read-path entry point: validate the current version, migrate the
 * recognized legacy version, fail closed on everything else (unknown
 * versions, corrupt payloads). NEVER writes, never resets.
 */
export function migrateStoredSnapshot(raw: unknown): ConversationSnapshot | null {
  const record = asRecord(raw);
  if (record === null) return null;

  const version = record.schemaVersion;

  if (version === undefined || version === null) {
    // Unversioned legacy payload — recognizable by its required fields.
    return migrateLegacySnapshot(record);
  }
  if (typeof version === 'number' && Number.isInteger(version)) {
    if (version === 0) {
      return migrateLegacySnapshot(record);
    }
    if (version === CONVERSATION_SNAPSHOT_SCHEMA_VERSION) {
      return validateStoredSnapshot(raw);
    }
  }
  // Unknown version (future, corrupt, or foreign) — fail closed.
  return null;
}
