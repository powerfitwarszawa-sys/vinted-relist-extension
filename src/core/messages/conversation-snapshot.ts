/**
 * Local conversation snapshot (T3.4) — own namespace, independent from the
 * relist scan cache (`vbr:lastScan`).
 *
 * Rules:
 *  - a snapshot is persisted ONLY for a `complete` scan; incomplete scans
 *    are refused and never overwrite a previously stored snapshot,
 *  - reads fail closed: missing/corrupt/foreign-schema data yields `null`,
 *    never a half-parsed object,
 *  - the fingerprint is a deterministic FNV-1a-based fingerprint of the
 *    normalized data (change detection, NOT a cryptographic signature),
 *  - persistence goes through chrome.storage.local; in Node tests the
 *    global `chrome` is mocked (same pattern as src/core/scan-cache.ts).
 */

import type { Conversation, ConversationScanResult, ConversationScanWarning } from './contracts';

export const CONVERSATION_SNAPSHOT_KEY = 'vbr:messages:conversation-snapshot';
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

// ── fingerprint ────────────────────────────────────────────────────

function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Deterministic fingerprint over the normalized rows. Row order matters
 * (it is the scan order), object key order is fixed by the normalizer.
 */
export function fingerprintConversations(
  conversations: readonly Conversation[],
  source: ConversationScanResult['source'],
): string {
  const payload = JSON.stringify({ source, count: conversations.length, conversations });
  const a = fnv1a32(payload, 0x811c9dc5).toString(16).padStart(8, '0');
  const b = fnv1a32(payload, 0x9e3779b9).toString(16).padStart(8, '0');
  return `${a}${b}`;
}

// ── build ──────────────────────────────────────────────────────────

/**
 * Build a snapshot from a scan result. Throws for incomplete scans —
 * partial data must never masquerade as a full snapshot.
 */
export function buildConversationSnapshot(
  result: ConversationScanResult,
  savedAtMs: number,
): ConversationSnapshot {
  if (!result.complete) {
    throw new Error(
      `Refusing to build a snapshot from an incomplete scan (${result.scanId}). ` +
        'Resolve the scan warnings and rerun the scan.',
    );
  }

  const snapshot: ConversationSnapshot = {
    schemaVersion: CONVERSATION_SNAPSHOT_SCHEMA_VERSION,
    scanId: result.scanId,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    savedAt: new Date(savedAtMs).toISOString(),
    source: result.source,
    conversationCount: result.conversations.length,
    hasMore: result.hasMore,
    warnings: result.warnings,
    fingerprint: fingerprintConversations(result.conversations, result.source),
    conversations: result.conversations,
  };
  if (result.nextCursor !== undefined) {
    snapshot.nextCursor = result.nextCursor;
  }
  return snapshot;
}

// ── storage (chrome.storage.local) ─────────────────────────────────

type LocalStorageArea = typeof chrome.storage.local;

function localArea(): LocalStorageArea | null {
  try {
    // ReferenceError (no chrome in Node without a mock) is caught → null,
    // so callers fail closed instead of crashing.
    return chrome.storage.local;
  } catch {
    return null;
  }
}

/**
 * Persist a scan result as THE snapshot. Incomplete scans, unavailable
 * storage, or storage failures return `{ok:false}` and leave the previously
 * stored snapshot untouched.
 */
export async function saveConversationSnapshot(
  result: ConversationScanResult,
  savedAtMs: number,
): Promise<SaveSnapshotResult> {
  if (!result.complete) {
    return { ok: false, error: 'Scan is incomplete — existing snapshot left untouched.' };
  }

  const storage = localArea();
  if (storage === null) {
    return { ok: false, error: 'chrome.storage.local is unavailable — snapshot not saved.' };
  }

  try {
    const snapshot = buildConversationSnapshot(result, savedAtMs);
    await storage.set({ [CONVERSATION_SNAPSHOT_KEY]: snapshot });
    return { ok: true, snapshot };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Load the stored snapshot. Fail-closed: missing, malformed, or
 * foreign-schema data returns `null` (the caller must rescan).
 */
export async function getConversationSnapshot(): Promise<ConversationSnapshot | null> {
  const storage = localArea();
  if (storage === null) {
    return null;
  }

  try {
    const result = await storage.get(CONVERSATION_SNAPSHOT_KEY);
    const stored: unknown = result[CONVERSATION_SNAPSHOT_KEY];
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
      return null;
    }
    const candidate = stored as Partial<ConversationSnapshot>;
    if (
      candidate.schemaVersion !== CONVERSATION_SNAPSHOT_SCHEMA_VERSION ||
      typeof candidate.scanId !== 'string' ||
      candidate.scanId === '' ||
      !Array.isArray(candidate.conversations)
    ) {
      return null;
    }
    return candidate as ConversationSnapshot;
  } catch {
    return null;
  }
}
