/**
 * Shared seller-status presentation and summary helpers.
 *
 * This module intentionally depends only on core contracts so content and UI
 * surfaces cannot drift in their labels or fallback status behaviour.
 */

import type {
  Listing,
  ListingScanSummary,
  ListingStatus,
  QueueState,
  SellerListingStatus,
  SellerStatusSummary,
} from './contracts';

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  active: 'Aktywny',
  selected: 'Zaznaczony',
  queued: 'W kolejce',
  running: 'W trakcie',
  paused: 'Wstrzymany',
  success: 'Gotowe',
  error: 'Błąd',
};

export const QUEUE_STATE_LABELS: Record<QueueState, string> = {
  idle: 'bezczynna',
  running: 'w toku',
  paused: 'wstrzymana',
  error: 'błąd',
};

export const SELLER_LISTING_STATUS_LABELS: Record<SellerListingStatus, string> = {
  active: 'Aktywna',
  hidden: 'Ukryta',
  sold: 'Sprzedana',
  reserved: 'Zarezerwowana',
  draft: 'Szkic',
  unknown: 'Nieznany',
};

export const SELLER_STATUS_SUMMARY_LABELS: Record<SellerListingStatus, string> = {
  active: 'aktywne',
  hidden: 'ukryte',
  sold: 'sprzedane',
  reserved: 'zarezerwowane',
  draft: 'szkice',
  unknown: 'nieznane',
};

export const LISTING_SCAN_SOURCE_LABELS: Record<ListingScanSummary['source'], string> = {
  'wardrobe-api': 'API garderoby',
  'visible-dom-fallback': 'Widoczna strona (fallback)',
};

export const SELLER_LISTING_STATUS_ORDER: readonly SellerListingStatus[] = [
  'active',
  'hidden',
  'sold',
  'reserved',
  'draft',
  'unknown',
];

export function createSellerStatusSummary(): SellerStatusSummary {
  return {
    active: 0,
    hidden: 0,
    sold: 0,
    reserved: 0,
    draft: 0,
    unknown: 0,
  };
}

/**
 * Legacy visible-page scans did not persist a seller source status. Such an
 * entry is active only when the extension queue status is also still active.
 */
export function getListingSourceStatus(
  listing: Pick<Listing, 'sourceStatus' | 'status'>,
): SellerListingStatus {
  if (listing.sourceStatus !== undefined) return listing.sourceStatus;
  return listing.status === 'active' ? 'active' : 'unknown';
}

export function summarizeListingSourceStatuses(
  listings: readonly Pick<Listing, 'sourceStatus' | 'status'>[],
): SellerStatusSummary {
  const summary = createSellerStatusSummary();
  for (const listing of listings) {
    summary[getListingSourceStatus(listing)]++;
  }
  return summary;
}

export function formatSellerStatusSummary(summary: SellerStatusSummary): string {
  return SELLER_LISTING_STATUS_ORDER
    .map((status) => `${SELLER_STATUS_SUMMARY_LABELS[status]} ${summary[status]}`)
    .join(', ');
}

export function formatListingScanSummary(summary: ListingScanSummary): string {
  return `${LISTING_SCAN_SOURCE_LABELS[summary.source]}: ${summary.total} pozycji · ` +
    formatSellerStatusSummary(summary.statusCounts);
}
