/**
 * Stable-id deduplication for conversation scan results (T3.1).
 *
 * Pure: input arrays are never mutated. First occurrence wins so the row
 * order of the earliest page stays authoritative (deterministic across
 * runs and page splits).
 */

import type { Conversation } from './contracts';

export interface DedupeConversationsResult {
  /** Unique conversations in first-seen order. */
  conversations: Conversation[];
  /** Ids that appeared more than once (dropped occurrences). */
  duplicates: string[];
}

export function dedupeConversations(
  conversations: readonly Conversation[],
): DedupeConversationsResult {
  const seen = new Set<string>();
  const unique: Conversation[] = [];
  const duplicates: string[] = [];

  for (const conversation of conversations) {
    if (seen.has(conversation.id)) {
      if (!duplicates.includes(conversation.id)) {
        duplicates.push(conversation.id);
      }
      continue;
    }
    seen.add(conversation.id);
    unique.push(conversation);
  }

  return { conversations: unique, duplicates };
}
