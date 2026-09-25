/**
 * Shared message contracts, domain models, and typed response map.
 *
 * Keep this file dependency-free so it can be imported by any script.
 * The MessageResponseMap provides end-to-end type safety for
 * chrome.runtime.sendMessage calls.
 */

export type ListingStatus =
  | 'active'
  | 'selected'
  | 'queued'
  | 'running'
  | 'paused'
  | 'success'
  | 'error';

/**
 * State reported by Vinted for an item in the seller's wardrobe.
 *
 * This must remain separate from ListingStatus, which tracks the extension's
 * own queue lifecycle (queued, running, success, error, ...).
 */
export type SellerListingStatus =
  | 'active'
  | 'hidden'
  | 'sold'
  | 'reserved'
  | 'draft'
  | 'unknown';

/** Counts of seller-side statuses attached to a completed listing scan. */
export type SellerStatusSummary = Record<SellerListingStatus, number>;

/** Where the listing scan was read from inside the current Vinted tab. */
export type ListingScanSource = 'wardrobe-api' | 'visible-dom-fallback';

/** Structured scan metadata for UI feedback, logs, and future cache storage. */
export interface ListingScanSummary {
  source: ListingScanSource;
  total: number;
  statusCounts: SellerStatusSummary;
}

export interface Listing {
  id: string;
  title: string;
  price: number;
  currency: string;
  url: string;
  thumbnailUrl?: string;
  description?: string;
  /** Seller-side Vinted state returned by the wardrobe scan when available. */
  sourceStatus?: SellerListingStatus;
  status: ListingStatus;
  lastRelisted?: number;
}

/**
 * A pre-relist backup snapshot. Extends the listing with the backup timestamp
 * and, once the relist attempt finishes, its outcome. Older backups written
 * before v0.3.0 have no timestamp and normalize to `backedUpAt: 0`.
 */
export interface BackupEntry extends Listing {
  /** When the backup was saved, epoch ms. 0 for pre-v0.3.0 entries. */
  backedUpAt: number;
  /** Outcome of the relist attempt, when known. */
  relistResult?: 'success' | 'failed';
  /** Short note about the outcome (new listing id or failure reason). */
  relistNote?: string;
}

export type RelistPreflightIssueCode =
  | 'missing-id'
  | 'missing-title'
  | 'missing-url'
  | 'duplicate-id'
  | 'non-active-source-status';

export type RelistPreflightSeverity = 'block' | 'warn';

export interface RelistPreflightIssue {
  code: RelistPreflightIssueCode;
  severity: RelistPreflightSeverity;
  listingId: string;
  message: string;
}

export interface RelistPreflightResult {
  accepted: Listing[];
  issues: RelistPreflightIssue[];
}

export interface QueueItem {
  listing: Listing;
  attempts: number;
  lastError?: string;
}

export type QueueState = 'idle' | 'running' | 'paused' | 'error';

export interface PersistedQueue {
  items: QueueItem[];
  currentIndex: number;
  state: QueueState;
  lastError?: string;
}

export type PageType = 'user-listings' | 'item-detail' | 'other';

export interface PageInfo {
  isRelevant: boolean;
  pageType: PageType;
  reason: string;
}

export interface QueueItemStatus {
  id: string;
  title: string;
  price: number;
  currency: string;
  thumbnailUrl?: string;
  sourceStatus?: SellerListingStatus;
  status: ListingStatus;
  lastError?: string;
  lastRelisted?: number;
}

export interface QueueStatus {
  state: QueueState;
  total: number;
  completed: number;
  failed: number;
  currentId?: string;
  lastError?: string;
  items: QueueItemStatus[];
}

export interface AppSettings {
  enabled: boolean;
  delayBaseMs: number;
  jitterMaxMs: number;
  maxConcurrent: number;
  draftMode: boolean;
  /** When true, the background alarm periodically relists eligible items. */
  autoRelistEnabled: boolean;
  /** Interval between automatic relist cycles, in minutes. */
  autoRelistIntervalMinutes: number;
  /** Maximum number of items enqueued per automatic cycle. */
  autoRelistMaxPerCycle: number;
  /**
   * Minimum age (in hours) since a listing was last relisted before it
   * becomes eligible again for an automatic cycle. Prevents re-bumping the
   * same items on every tick.
   */
  autoRelistMinHoursSinceRelist: number;
}

export interface StatsData {
  todayRelisted: number;
  todaySuccess: number;
  todayError: number;
  totalRelisted: number;
  /** ISO date string (YYYY-MM-DD) of the last daily counter reset. */
  lastDate?: string;
}

/**
 * Persisted snapshot of the most recent wardrobe scan. The background stores
 * this after every successful scan so the scheduled (automatic) relist cycle
 * can pick due listings without requiring a fresh scan on every alarm fire.
 */
export interface PersistedScan {
  /** When the scan finished, epoch ms. */
  scannedAt: number;
  /** Where the scan data was read from inside the Vinted tab. */
  source: ListingScanSource;
  /** Unique listings from that scan, in scan order. */
  listings: Listing[];
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
}

export interface RelistResult {
  success: boolean;
  code: string;
  message: string;
  /** Confirmed replacement listing ID returned by DOM/API relist. */
  newListingId?: string;
}

// ── Message types ──────────────────────────────────────────────────

export type ExtensionMessage =
  | { type: 'SCAN_LISTINGS' }
  | { type: 'LISTINGS_FOUND'; payload: { listings: Listing[] } }
  | { type: 'QUEUE_RELIST'; payload: { ids: string[] } }
  | { type: 'ADD_TO_QUEUE'; payload: { listings: Listing[] } }
  | { type: 'RELIST_ITEM'; payload: { listing: Listing } }
  | { type: 'CLEAR_QUEUE' }
  | { type: 'PAUSE_QUEUE' }
  | { type: 'RESUME_QUEUE' }
  | { type: 'GET_STATUS' }
  | { type: 'STATUS_UPDATE'; payload: QueueStatus }
  | { type: 'GET_LOGS' }
  | { type: 'LOGS_RESPONSE'; payload: LogEntry[] }
  | { type: 'CLEAR_LOGS' }
  | { type: 'GET_SETTINGS' }
  | { type: 'SETTINGS_RESPONSE'; payload: AppSettings }
  | { type: 'SET_SETTINGS'; payload: Partial<AppSettings> }
  | { type: 'SAVE_BACKUP'; payload: { listing: Listing } }
  | { type: 'GET_BACKUPS' }
  | { type: 'CLEAR_BACKUPS' }
  | { type: 'GET_STATS' }
  | { type: 'UPDATE_STATS'; payload: { success: boolean } }
  | { type: 'GET_SCAN' }
  | { type: 'FETCH_PHOTO'; payload: { url: string } };

// ── Typed response map ─────────────────────────────────────────────
// Every message type maps to its expected response shape.
// This eliminates `any` casts in all sendMessage() call sites.

export interface ExtMessageResponse {
  ok: boolean;
  error?: string;
}

export interface ScanListingsResponse extends ExtMessageResponse {
  listings?: Listing[];
  note?: string;
  scan?: ListingScanSummary;
}

export interface AddToQueueResponse extends ExtMessageResponse {
  added?: number;
  status?: QueueStatus;
  preflight?: RelistPreflightResult;
}

export interface StatusResponse extends ExtMessageResponse {
  status?: QueueStatus;
}

export interface LogsResponse extends ExtMessageResponse {
  logs?: LogEntry[];
}

export interface BackupsResponse extends ExtMessageResponse {
  backups?: BackupEntry[];
}

export interface SettingsResponse extends ExtMessageResponse {
  settings?: AppSettings;
}

export interface StatsResponse extends ExtMessageResponse {
  stats?: StatsData;
}

export interface ScanResponse extends ExtMessageResponse {
  scan?: PersistedScan;
}

export interface RelistItemResponse {
  ok: boolean;
  result?: RelistResult;
  error?: string;
}

export interface FetchPhotoResponse extends ExtMessageResponse {
  dataUrl?: string;
  contentType?: string;
  byteLength?: number;
}

/**
 * Message-to-response type map.
 * Usage: `const res = await sendMessage<MsgType>(msg);` where MsgType
 * is the discriminated message type, and the return type is inferred.
 */
export interface MessageResponseMap {
  SCAN_LISTINGS: ScanListingsResponse;
  LISTINGS_FOUND: { ok: boolean; note?: string; listings?: Listing[] };
  QUEUE_RELIST: StatusResponse;
  ADD_TO_QUEUE: AddToQueueResponse;
  RELIST_ITEM: RelistItemResponse;
  CLEAR_QUEUE: StatusResponse;
  PAUSE_QUEUE: StatusResponse;
  RESUME_QUEUE: StatusResponse;
  GET_STATUS: StatusResponse;
  STATUS_UPDATE: { ok: boolean };
  GET_LOGS: LogsResponse;
  LOGS_RESPONSE: { ok: boolean };
  CLEAR_LOGS: { ok: boolean };
  GET_SETTINGS: SettingsResponse;
  SETTINGS_RESPONSE: { ok: boolean };
  SET_SETTINGS: { ok: boolean; error?: string };
  SAVE_BACKUP: { ok: boolean };
  GET_BACKUPS: BackupsResponse;
  CLEAR_BACKUPS: { ok: boolean };
  GET_STATS: StatsResponse;
  UPDATE_STATS: StatsResponse;
  GET_SCAN: ScanResponse;
  FETCH_PHOTO: FetchPhotoResponse;
}

/** Helper: Extract the message type discriminator from an ExtensionMessage. */
export type MessageType = ExtensionMessage['type'];

/** Helper: resolve the response type for a given message type. */
export type ResponseFor<M extends ExtensionMessage> =
  M['type'] extends keyof MessageResponseMap
    ? MessageResponseMap[M['type']]
    : ExtMessageResponse;
