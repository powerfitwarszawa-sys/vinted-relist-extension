/**
 * Structured error/result codes for the extension.
 *
 * Keep this file dependency-free except for the contracts it references.
 * Every failure path should return one of these codes instead of a loose
 * string so the popup and logs can identify the failure category.
 */

import type { RelistResult } from './contracts';

export const ErrorCode = {
  /** Operation completed successfully. */
  SUCCESS: 'success',

  /** Catch-all for unexpected failures. */
  UNKNOWN: 'unknown',

  // Queue runtime
  QUEUE_EMPTY: 'queue-empty',
  QUEUE_ALREADY_RUNNING: 'queue-already-running',

  // Background / tab communication
  NO_ACTIVE_TAB: 'no-active-tab',
  NOT_VINTED_TAB: 'not-vinted-tab',
  TAB_COMMUNICATION_ERROR: 'tab-communication-error',
  CONTENT_ERROR: 'content-error',
  UNKNOWN_MESSAGE_TYPE: 'unknown-message-type',

  // Content layer / DOM runner
  NOT_ON_DETAIL_PAGE: 'not-on-detail-page',
  DETAIL_MARKER_MISSING: 'detail-marker-missing',
  RELIST_BUTTON_MISSING: 'relist-button-missing',
  RELIST_ACTION_ERROR: 'relist-action-error',
  CONFIRMATION_TIMEOUT: 'confirmation-timeout',
  RELIST_NOT_CONFIRMED: 'relist-not-confirmed',
  API_DRAFT_ONLY: 'api-draft-only',
  API_ACCESS_OR_RATE_LIMIT: 'api-access-or-rate-limit',

  // Executor internals
  EXECUTOR_EXCEPTION: 'executor-exception',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export function successResult(message: string, newListingId?: string): RelistResult {
  return { success: true, code: ErrorCode.SUCCESS, message, newListingId };
}

export function failureResult(code: ErrorCode, message: string): RelistResult {
  return { success: false, code, message };
}

/**
 * API session and rate-limit failures require human intervention. They must
 * stop a running batch instead of causing the next listing to be attempted.
 */
export function isApiAccessOrRateLimitMessage(message: string): boolean {
  return /\bapi\s+(?:401|403|429)\b/i.test(message);
}

export function isApiAccessOrRateLimitFailure(result: Pick<RelistResult, 'code' | 'message'>): boolean {
  return result.code === ErrorCode.API_ACCESS_OR_RATE_LIMIT || isApiAccessOrRateLimitMessage(result.message);
}

/**
 * Codes that indicate a temporary problem the user may be able to fix
 * (e.g., by refreshing the page or navigating to the listing detail page).
 * The queue should pause on these instead of marking the item as failed.
 */
export const RECOVERABLE_ERROR_CODES: readonly ErrorCode[] = [
  ErrorCode.NOT_ON_DETAIL_PAGE,
  ErrorCode.TAB_COMMUNICATION_ERROR,
  ErrorCode.CONTENT_ERROR,
  ErrorCode.DETAIL_MARKER_MISSING,
  ErrorCode.RELIST_BUTTON_MISSING,
];

export function isRecoverableError(code: ErrorCode): boolean {
  return RECOVERABLE_ERROR_CODES.includes(code);
}
