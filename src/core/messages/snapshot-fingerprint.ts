/**
 * Deterministic snapshot fingerprint (shared by build + migration +
 * validation). FNV-1a ×2 (8 hex chars each) over the normalized rows —
 * a change-detection fingerprint, NOT a cryptographic signature.
 *
 * Split into its own module so snapshot-schema.ts and
 * conversation-snapshot.ts can both use it without an import cycle.
 */

import type { Conversation, ConversationScanResult } from './contracts';

function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Deterministic fingerprint over the normalized rows.
 *
 * Canonicalized: object keys are sorted recursively before hashing, so
 * the fingerprint depends only on VALUES (and array order = scan order,
 * and the source) — never on incidental construction/key order. Row
 * order still matters: reordering conversations changes the fingerprint.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}

export function fingerprintConversations(
  conversations: readonly Conversation[],
  source: ConversationScanResult['source'],
): string {
  const payload = JSON.stringify(canonicalize({ source, count: conversations.length, conversations }));
  const a = fnv1a32(payload, 0x811c9dc5).toString(16).padStart(8, '0');
  const b = fnv1a32(payload, 0x9e3779b9).toString(16).padStart(8, '0');
  return `${a}${b}`;
}
