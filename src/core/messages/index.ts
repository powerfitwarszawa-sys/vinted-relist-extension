/**
 * Inbox / Messages module — public surface (P0, T1+T2).
 *
 * Import from here in background/UI/tests:
 *   import { renderMessageTemplate, selectNextTemplate,
 *            evaluateMessageCooldown, createSafetyLock } from '../core/messages';
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
