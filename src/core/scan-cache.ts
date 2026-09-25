/**
 * Persistence for the most recent wardrobe scan.
 *
 * The background stores the scan result here after every successful
 * SCAN_LISTINGS response so the scheduled (automatic) relist cycle can pick
 * due listings on its own alarm ticks without requiring a fresh scan, a live
 * popup, or a Vinted tab. The popup/options pages can also surface scan
 * freshness through GET_SCAN.
 */

import type { Listing, ListingScanSource, PersistedScan } from './contracts';

const SCAN_KEY = 'vbr:lastScan';
const RELIST_HISTORY_KEY = 'vbr:relistHistory';
const MAX_RELIST_HISTORY_ENTRIES = 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeScan(value: unknown): PersistedScan | null {
  if (!isRecord(value)) return null;
  if (typeof value.scannedAt !== 'number' || !Number.isFinite(value.scannedAt)) return null;
  if (!Array.isArray(value.listings)) return null;

  const source: ListingScanSource =
    value.source === 'visible-dom-fallback' || value.source === 'wardrobe-api'
      ? value.source
      : 'visible-dom-fallback';

  const listings = value.listings.filter(
    (listing): listing is Listing =>
      isRecord(listing) && typeof listing.id === 'string' && typeof listing.title === 'string',
  );

  return { scannedAt: value.scannedAt, source, listings };
}

function normalizeRelistHistory(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        entry[0].length > 0 &&
        typeof entry[1] === 'number' &&
        Number.isFinite(entry[1]) &&
        entry[1] > 0,
    ),
  );
}

async function getRelistHistory(): Promise<Record<string, number>> {
  const result = await chrome.storage.local.get(RELIST_HISTORY_KEY);
  return normalizeRelistHistory(result[RELIST_HISTORY_KEY]);
}

function trimRelistHistory(history: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(history)
      .sort((left, right) => right[1] - left[1])
      .slice(0, MAX_RELIST_HISTORY_ENTRIES),
  );
}

export async function getScanResult(): Promise<PersistedScan | null> {
  const result = await chrome.storage.local.get(SCAN_KEY);
  return normalizeScan(result[SCAN_KEY]);
}

export async function saveScanResult(
  listings: Listing[],
  source: ListingScanSource,
): Promise<PersistedScan> {
  const history = await getRelistHistory();
  const listingsWithCooldown = listings.map((listing) => {
    if (!Object.hasOwn(history, listing.id)) return listing;
    const rememberedAt = history[listing.id] ?? 0;
    return listing.lastRelisted === rememberedAt
      ? listing
      : { ...listing, lastRelisted: Math.max(listing.lastRelisted ?? 0, rememberedAt) };
  });
  const scan: PersistedScan = { scannedAt: Date.now(), source, listings: listingsWithCooldown };
  await chrome.storage.local.set({ [SCAN_KEY]: scan });
  return scan;
}

/**
 * Record successful relists both inside the cached scan and in a bounded
 * history keyed by listing ID. Recording the confirmed replacement ID keeps
 * its cooldown when the next wardrobe scan replaces the old ID.
 */
export async function markScanListingsRelisted(ids: Iterable<string>, at = Date.now()): Promise<void> {
  const wanted = new Set(ids);
  if (wanted.size === 0) return;

  const [scan, history] = await Promise.all([getScanResult(), getRelistHistory()]);
  for (const id of wanted) {
    history[id] = Math.max(history[id] ?? 0, at);
  }

  let updated = false;
  if (scan) {
    for (const listing of scan.listings) {
      if (wanted.has(listing.id) && listing.lastRelisted !== at) {
        listing.lastRelisted = at;
        updated = true;
      }
    }
  }

  await chrome.storage.local.set({
    [RELIST_HISTORY_KEY]: trimRelistHistory(history),
    ...(updated && scan ? { [SCAN_KEY]: scan } : {}),
  });
}
