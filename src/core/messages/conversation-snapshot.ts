/**
 * Local conversation snapshot (T3.4 + T4A) — own namespace, independent
 * from the relist scan cache (`vbr:lastScan`).
 *
 * Rules:
 *  - a snapshot is persisted ONLY for a `complete` scan; incomplete
 *    scans are refused and never overwrite a previously stored snapshot,
 *  - writes are atomic per key: the payload is built AND validated
 *    BEFORE the single storage call — a failure at any earlier step
 *    leaves the previous snapshot untouched,
 *  - reads fail closed: missing/corrupt/foreign-schema data yields
 *    `null` (see snapshot-schema.ts: validation + legacy migration),
 *  - persistence goes through SnapshotStorageAdapter (snapshot-storage.ts):
 *    chrome.storage.local by default, injectable for tests without any
 *    Chrome API.
 */

import type { ConversationScanResult } from './contracts';
import {
  CONVERSATION_SNAPSHOT_SCHEMA_VERSION,
  migrateStoredSnapshot,
  validateStoredSnapshot,
} from './snapshot-schema';
import type { ConversationSnapshot, SaveSnapshotResult } from './snapshot-schema';
import { fingerprintConversations } from './snapshot-fingerprint';
import {
  createChromeSnapshotStorage,
  type SnapshotStorageAdapter,
} from './snapshot-storage';

export const CONVERSATION_SNAPSHOT_KEY = 'vbr:messages:conversation-snapshot';

// Backward-compatible re-exports (T3 public surface lives here).
export { CONVERSATION_SNAPSHOT_SCHEMA_VERSION, migrateStoredSnapshot, validateStoredSnapshot };
export type { ConversationSnapshot, SaveSnapshotResult };
export { fingerprintConversations };

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

function defaultStorage(): SnapshotStorageAdapter {
  return createChromeSnapshotStorage();
}

/**
 * Persist a scan result as THE snapshot. Steps, in order (nothing is
 * written before the last one succeeds):
 *   1. completeness gate (incomplete scan → refuse, storage untouched),
 *   2. build the payload,
 *   3. strict validation of the built payload (catches builder bugs),
 *   4. single atomic write.
 * Any failure returns `{ok:false}` and leaves the stored snapshot
 * exactly as it was.
 */
export async function saveConversationSnapshot(
  result: ConversationScanResult,
  savedAtMs: number,
  storage: SnapshotStorageAdapter = defaultStorage(),
): Promise<SaveSnapshotResult> {
  if (!result.complete) {
    return { ok: false, error: 'Scan is incomplete — existing snapshot left untouched.' };
  }

  let snapshot: ConversationSnapshot;
  try {
    snapshot = buildConversationSnapshot(result, savedAtMs);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (validateStoredSnapshot(snapshot) === null) {
    return { ok: false, error: 'Built snapshot failed validation — storage not touched.' };
  }

  try {
    await storage.write(CONVERSATION_SNAPSHOT_KEY, snapshot);
    return { ok: true, snapshot };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Load the stored snapshot (validating or migrating it on the fly).
 * Fail-closed: missing, malformed, corrupt, or foreign-schema data
 * returns `null`; this function never writes to storage.
 */
export async function getConversationSnapshot(
  storage: SnapshotStorageAdapter = defaultStorage(),
): Promise<ConversationSnapshot | null> {
  try {
    const stored = await storage.read(CONVERSATION_SNAPSHOT_KEY);
    if (stored === undefined || stored === null) {
      return null;
    }
    return migrateStoredSnapshot(stored);
  } catch {
    return null;
  }
}
