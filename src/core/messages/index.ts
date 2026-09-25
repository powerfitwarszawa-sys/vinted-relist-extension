/**
 * Inbox / Messages module — public surface (P0, T1+T2+T3).
 *
 * Import from here in background/UI/tests:
 *   import { renderMessageTemplate, evaluateMessageCooldown,
 *            createSafetyLock, scanConversations,
 *            normalizeConversation, dedupeConversations,
 *            saveConversationSnapshot } from '../core/messages';
 */

export * from './contracts';
export * from './message-errors';
export { renderMessageTemplate } from './template-engine';
export { selectNextTemplate } from './template-rotation';
export { evaluateMessageCooldown } from './cooldown';
export {
  createSafetyLock,
  isSafetyLockActive,
  canStartMessageOperation,
  releaseSafetyLock,
} from './safety-lock';
export { normalizeConversation } from './conversation-normalizer';
export { dedupeConversations } from './conversation-dedupe';
export {
  scanConversations,
  ConversationScanError,
} from './conversation-scanner';
export {
  CONVERSATION_SNAPSHOT_KEY,
  CONVERSATION_SNAPSHOT_SCHEMA_VERSION,
  fingerprintConversations,
  buildConversationSnapshot,
  saveConversationSnapshot,
  getConversationSnapshot,
} from './conversation-snapshot';
