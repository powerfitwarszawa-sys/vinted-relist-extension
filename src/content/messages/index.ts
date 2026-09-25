/**
 * Messages content layer — read-only surface (T3).
 *
 * Everything here is GET-only and page-session based; nothing in this
 * directory may import the general write-capable API client.
 */

export type {
  ReadOnlyHttpMethod,
  ReadOnlyFailureCode,
  ReadOnlyResponse,
  ListConversationsInput,
  ReadOnlyConversationClient,
  ReadOnlyClientOptions,
} from './conversation-api-client';
export { createReadOnlyConversationClient } from './conversation-api-client';
export { createConversationApiDataSource } from './conversation-data-source';
