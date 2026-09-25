/**
 * Shared error/result codes for the Inbox / Messages module.
 *
 * Dependency-free (no contracts import needed) so every messages module and
 * both Node test bundles can use the same constants.
 */

export const MessageErrorCode = {
  // Template engine
  UNKNOWN_TEMPLATE_VARIABLE: 'unknown-template-variable',

  // Rotation
  NO_TEMPLATES: 'no-templates',
  NO_ENABLED_TEMPLATES: 'no-enabled-templates',

  // Cooldown / limits gate
  COOLDOWN_IN_FLIGHT: 'in-flight',
  COOLDOWN_UNCERTAIN: 'uncertain-verification-required',
  COOLDOWN_DUPLICATE: 'duplicate-content',
  COOLDOWN_HOURLY_LIMIT: 'hourly-limit',
  COOLDOWN_DAILY_LIMIT: 'daily-limit',
  COOLDOWN_CONVERSATION: 'conversation-cooldown',
  COOLDOWN_USER: 'user-cooldown',

  // Safety lock
  SAFETY_LOCK_ACTIVE: 'safety-lock-active',

  // Generic
  UNKNOWN: 'unknown',
} as const;

export type MessageErrorCode = (typeof MessageErrorCode)[keyof typeof MessageErrorCode];

/** Uniform failure payload for messages-module operations. */
export interface MessageFailure {
  ok: false;
  code: MessageErrorCode;
  error: string;
}

export function messageFailure(code: MessageErrorCode, error: string): MessageFailure {
  return { ok: false, code, error };
}
