/**
 * Data contracts for the Inbox / Messages module (P0).
 *
 * Dependency-free: imported by UI, background, content, and Node tests.
 * Domain types only — no chrome.*, no storage, no DOM.
 *
 * Conventions (project decision):
 *  - identifiers are `string`,
 *  - persisted dates are ISO-8601 strings,
 *  - time-dependent logic takes `now`/`nowMs` as an argument (never Date.now()
 *    inside pure functions),
 *  - operations whose outcome cannot be confirmed carry the `uncertain`
 *    status in their own status union (conversation / task / history are
 *    deliberately separate).
 *
 * This module does NOT change Listing, ListingStatus, or any relist queue
 * contract from ../contracts.ts.
 */

// ── Conversation ───────────────────────────────────────────────────

/**
 * Reply lifecycle of a single conversation, from the extension's point of
 * view. Separate from queue/relist statuses on purpose.
 */
export type ConversationReplyStatus =
  /** No reply from us in this thread yet. */
  | 'none'
  /** A reply is waiting for approval / queue processing. */
  | 'pending'
  /** A reply was confirmed sent. */
  | 'replied'
  /** Rules skipped this conversation (cooldown, own message, …). */
  | 'skipped'
  /** Last attempt failed. */
  | 'error'
  /** Send happened but the outcome cannot be confirmed (SW restart). */
  | 'uncertain';

export interface Conversation {
  id: string;
  userId: string;
  username: string;
  /** Related listing context when Vinted provides it. */
  itemId?: string;
  itemTitle?: string;
  itemPrice?: number;
  currency?: string;
  lastMessageBody: string;
  /**
   * ISO timestamp of the last message in the thread.
   * Absent when the source has no (parseable) date — unknown, never guessed.
   */
  lastMessageAt?: string;
  /**
   * Whether the last message is ours. Tri-state: absent = author unknown
   * (the scanner must not assume `replied` without proof).
   */
  lastMessageFromSelf?: boolean;
  unreadCount: number;
  /** Observed Vinted-side state (T3 scan axis). */
  scanStatus: ConversationScanStatus;
  /** How trustworthy the normalized row is (complete/degraded/unknown). */
  dataQuality: ConversationDataQuality;
  /** Conversation URL as reported by the source; absent when unknown. */
  conversationUrl?: string;
  /**
   * Extension-side reply lifecycle (pending approval, sent via history…).
   * Deliberately optional: a scan alone cannot know it; later phases merge
   * the local message history into this field.
   */
  replyStatus?: ConversationReplyStatus;
  lastError?: string;
}

// ── T3: read-only conversation scanning ────────────────────────────

/**
 * Observed state of a conversation during a scan. Separate from
 * ConversationReplyStatus (our reply lifecycle) on purpose.
 *
 * `replied` is only produced when the last message author is known to be
 * us — missing data never degrades into `replied`.
 */
export type ConversationScanStatus =
  | 'unread'
  | 'awaiting-reply'
  | 'replied'
  | 'archived'
  | 'unknown';

export type ConversationDataQuality = 'complete' | 'degraded' | 'unknown';

export type ConversationScanWarningCode =
  /** Row is not an object / unusable structure. */
  | 'invalid-item'
  /** No stable conversation id → row dropped. */
  | 'missing-id'
  /** Last message exists but carries no date. */
  | 'missing-date'
  /** Date present but unparseable → treated as unknown, not as "now". */
  | 'invalid-date'
  /** Last message exists but its author cannot be resolved. */
  | 'unknown-author'
  /** An expected field is absent → data quality degraded. */
  | 'missing-field'
  /** Vinted response shape not recognized → explicit, never silently ok. */
  | 'unsupported-structure'
  /** Same conversationId seen more than once in one scan. */
  | 'duplicate-item'
  /** Page fetch threw (network/http/unknown). */
  | 'page-fetch-failed'
  /** Session/auth failure (401/403) → fail closed, no retry. */
  | 'session-expired'
  /** Rate limited (429) → fail closed. */
  | 'rate-limited'
  /** CAPTCHA challenge observed → fail closed. */
  | 'captcha'
  /** Cursor did not advance → stopped to avoid an infinite loop. */
  | 'pagination-loop'
  /** Page announced more data but returned no cursor. */
  | 'missing-cursor'
  /** Stopped at the configured page cap; resume via nextCursor. */
  | 'max-pages-reached';

export interface ConversationScanWarning {
  code: ConversationScanWarningCode;
  message: string;
  /** Conversation id or row index the warning refers to, when known. */
  itemId?: string;
}

/**
 * Result of one read-only scan.
 *
 * `complete: false` means the scan failed mid-way (fetch/session/structure
 * error): the conversations collected so far are kept for diagnostics, but
 * the snapshot layer must refuse to persist the result as a full snapshot.
 */
export interface ConversationScanResult {
  scanId: string;
  startedAt: string;
  finishedAt: string;
  source: 'dom' | 'read-only-api';
  conversations: Conversation[];
  warnings: ConversationScanWarning[];
  hasMore: boolean;
  nextCursor?: string;
  /** False → failed/partial scan; never persist as a complete snapshot. */
  complete: boolean;
}

/** One page of raw (untrusted) rows returned by a data source. */
export interface ConversationPage {
  raw: unknown[];
  hasMore: boolean;
  nextCursor?: string;
}

/**
 * Read-only source of conversation pages. The only capability the scanner
 * depends on — implementations must never write (GET-only client in
 * src/content/messages).
 */
export interface ConversationDataSource {
  readonly kind: 'dom' | 'read-only-api';
  fetchPage(cursor?: string): Promise<ConversationPage>;
}

// ── Templates ──────────────────────────────────────────────────────

export interface MessageTemplate {
  id: string;
  name: string;
  body: string;
  enabled: boolean;
  language?: string;
  tags?: string[];
  usageCount: number;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateRotationState {
  conversationId: string;
  lastTemplateId?: string;
  usedTemplateIds: string[];
  lastSentAt?: string;
}

// ── Automation settings ────────────────────────────────────────────

export type MessageMode = 'preview' | 'manual' | 'automatic';

export interface MessageAutomationSettings {
  /** Default for the product is `manual` — preview/manual ship first. */
  mode: MessageMode;
  /** Minimum minutes between two replies in the same conversation. */
  conversationCooldownMinutes: number;
  /** Minimum minutes between two replies to the same user (any thread). */
  userCooldownMinutes: number;
  maxMessagesPerHour: number;
  maxMessagesPerDay: number;
  randomDelayMinSeconds: number;
  randomDelayMaxSeconds: number;
  stopOnCaptcha: boolean;
  stopAfterConsecutiveErrors: number;
}

// ── Message history ────────────────────────────────────────────────

export type MessageHistoryStatus =
  /** Slot reserved before sending (rotation choice persisted first). */
  | 'reserved'
  /** Confirmed sent. */
  | 'sent'
  /** Failed — explicitly NOT sent. */
  | 'failed'
  /** Send outcome unknown (service worker restarted mid-action). */
  | 'uncertain';

export interface MessageHistoryEntry {
  id: string;
  conversationId: string;
  userId: string;
  templateId?: string;
  /** First 160 characters of the rendered body, for display. */
  bodyPreview: string;
  /** SHA-256 hex of the rendered body — duplicate detection. */
  bodyHash: string;
  /** ISO timestamp when the body was rendered/reserved. */
  renderedAt: string;
  /** ISO timestamp of the confirmed send. */
  sentAt?: string;
  status: MessageHistoryStatus;
  mode: MessageMode;
  error?: string;
}

// ── Tasks (future automatic runner) ────────────────────────────────

export type MessageTaskStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'success'
  | 'error'
  /** Outcome of an interrupted attempt cannot be confirmed. */
  | 'uncertain';

export interface MessageTask {
  id: string;
  conversationId: string;
  userId: string;
  templateId?: string;
  mode: MessageMode;
  status: MessageTaskStatus;
  attempts: number;
  /** ISO timestamp of task creation. */
  createdAt: string;
  lastAttemptAt?: string;
  sentAt?: string;
  lastError?: string;
}

// ── Safety lock (shared gate for messages, planned relist integration) ──

export type MessageSafetyLockReason =
  | 'captcha'
  | 'rate-limit'
  | 'session-expired'
  | 'consecutive-errors'
  | 'manual'
  | 'uncertain-operation';

/** JSON-safe metadata attached to a lock (diagnostics only). */
export type SafetyLockMetadata = Readonly<Record<string, string | number | boolean>>;

export interface MessageSafetyLock {
  active: boolean;
  reason?: MessageSafetyLockReason;
  message?: string;
  /** ISO timestamp of lock creation. */
  createdAt: string;
  /**
   * ISO timestamp after which the lock auto-expires, or null/undefined for
   * manual-only release. Only timed reasons may carry an effective value —
   * `manual` and `uncertain-operation` never auto-release.
   */
  unlockAt?: string | null;
  metadata?: SafetyLockMetadata;
  /** ISO timestamp of the explicit release. */
  releasedAt?: string;
  releasedBy?: 'user' | 'system';
}

export interface SafetyLockReleaseResult {
  ok: boolean;
  lock: MessageSafetyLock;
  error?: string;
}

// ── Template rendering ─────────────────────────────────────────────

/** Variables supported by the message template engine. */
export type MessageTemplateVariableName =
  | 'username'
  | 'itemTitle'
  | 'itemPrice'
  | 'currency'
  | 'conversationId';

export type MessageTemplateVariables = Partial<
  Record<MessageTemplateVariableName, string | number | null>
>;

/**
 * Result of rendering a template. `ok: false` means an unknown placeholder
 * was found; `body` still carries the best-effort text (known variables
 * substituted, unknown placeholders left untouched).
 */
export interface RenderedMessage {
  ok: boolean;
  body: string;
  /** Placeholders that are not part of the supported variable set. */
  unknownVariables: string[];
  /** Supported variables whose value was not provided (placeholder kept). */
  missingVariables: string[];
  error?: string;
}

// ── Template rotation ──────────────────────────────────────────────

export type TemplateSelectionCode =
  | 'selected'
  | 'no-templates'
  | 'no-enabled-templates';

export interface TemplateSelectionResult {
  ok: boolean;
  code: TemplateSelectionCode;
  reason: string;
  template?: MessageTemplate;
}

// ── Cooldown / limits gate ─────────────────────────────────────────

export interface CooldownInput {
  /** Epoch ms supplied by the caller — tests never read the system clock. */
  nowMs: number;
  conversationId: string;
  userId: string;
  /** SHA-256 hex of the rendered body about to be sent. */
  bodyHash: string;
  settings: MessageAutomationSettings;
  /** The local (bounded) message history. `null`/`undefined` tolerated at runtime (treated as empty). */
  history: readonly MessageHistoryEntry[] | null | undefined;
}

export type CooldownCode =
  | 'ok'
  | 'in-flight'
  | 'uncertain-verification-required'
  | 'duplicate-content'
  | 'hourly-limit'
  | 'daily-limit'
  | 'conversation-cooldown'
  | 'user-cooldown';

export interface CooldownResult {
  allowed: boolean;
  code: CooldownCode;
  /** Human-readable reason (logged and shown in the UI). */
  reason: string;
  /** Epoch ms when this block lifts, when computable. */
  retryAtMs?: number;
}

// ── Message operation responses (future sendMessage<T> integration) ─

/** Base shape for every messages-module response. */
export interface MessageOpResponse {
  ok: boolean;
  error?: string;
  code?: string;
}

export interface InboxResponse extends MessageOpResponse {
  conversations?: Conversation[];
  /** ISO timestamp of the persisted scan. */
  scannedAt?: string;
}

export interface TemplatesResponse extends MessageOpResponse {
  templates?: MessageTemplate[];
}

export interface RenderPreviewResponse extends MessageOpResponse {
  rendered?: RenderedMessage;
}

export interface SendMessageResponse extends MessageOpResponse {
  historyEntry?: MessageHistoryEntry;
  cooldown?: CooldownResult;
}

export interface MsgSettingsResponse extends MessageOpResponse {
  settings?: MessageAutomationSettings;
}

export interface MsgHistoryResponse extends MessageOpResponse {
  history?: MessageHistoryEntry[];
}

export interface SafetyLockResponse extends MessageOpResponse {
  lock?: MessageSafetyLock;
}

/**
 * Response map for messages-module message types. Mirrors the pattern of
 * `MessageResponseMap` in ../../core/contracts.ts so the two maps can be
 * merged later without call-site changes.
 */
export interface MessageResponseMap {
  SCAN_CONVERSATIONS: InboxResponse;
  GET_INBOX: InboxResponse;
  GET_TEMPLATES: TemplatesResponse;
  SAVE_TEMPLATE: MessageOpResponse;
  DELETE_TEMPLATE: MessageOpResponse;
  RENDER_PREVIEW: RenderPreviewResponse;
  SEND_MESSAGE: SendMessageResponse;
  GET_MSG_SETTINGS: MsgSettingsResponse;
  SET_MSG_SETTINGS: MessageOpResponse;
  GET_MSG_HISTORY: MsgHistoryResponse;
  CLEAR_MSG_HISTORY: MessageOpResponse;
  GET_SAFETY_LOCK: SafetyLockResponse;
  CLEAR_SAFETY_LOCK: SafetyLockResponse;
}
