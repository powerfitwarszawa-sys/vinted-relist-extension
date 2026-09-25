/**
 * Type-safe chrome.runtime.sendMessage wrapper.
 *
 * Usage:
 *   const res = await sendMessage({ type: 'GET_STATUS' });
 *   // res is typed as StatusResponse
 *   if (res.ok) console.log(res.status?.state);
 */

import type { ExtensionMessage, MessageResponseMap } from '../core/contracts';

// Map each message type to its response via the discriminated 'type' field
type ResponseFor<T extends ExtensionMessage> =
  T extends { type: infer Type }
    ? Type extends keyof MessageResponseMap
      ? MessageResponseMap[Type]
      : { ok: boolean; error?: string }
    : { ok: boolean; error?: string };

/**
 * Send a message to the background service worker with full type safety.
 *
 * @example
 *   const res = sendMessage({ type: 'GET_STATUS' });
 *   //             ^ StatusResponse
 */
export function sendMessage<T extends ExtensionMessage>(
  message: T,
): Promise<ResponseFor<T>> {
  return chrome.runtime.sendMessage(message) as Promise<ResponseFor<T>>;
}
