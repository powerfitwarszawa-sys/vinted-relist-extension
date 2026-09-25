import type { PageType, QueueStatus, SellerListingStatus } from './contracts';

const PENDING_QUEUE_STATUSES = new Set(['queued', 'running', 'paused']);
const HIDDEN_LISTING_MARKER = /ukryte\s+w\s+katalogu/i;

/** Visible-DOM scanning is safe only on the seller wardrobe page. */
export function canUseVisibleDomFallback(pageType: PageType): boolean {
  return pageType === 'user-listings';
}

/** Preserve seller state exposed by the visible Vinted card. */
export function resolveVisibleListingStatus(textCandidates: readonly string[]): SellerListingStatus {
  return textCandidates.some((text) => HIDDEN_LISTING_MARKER.test(text)) ? 'hidden' : 'active';
}

/** Publishing is allowed only when every source photo has a fresh uploaded copy. */
export function hasCompletePhotoUpload(sourcePhotoCount: number, uploadedPhotoCount: number): boolean {
  return sourcePhotoCount > 0 && uploadedPhotoCount === sourcePhotoCount;
}

/** Follow API-provided pagination instead of assuming the requested page size was honored. */
export function shouldReadNextPage(
  page: number,
  totalPages: number | null,
  itemCount: number,
  pageSize: number,
): boolean {
  if (itemCount === 0) return false;
  if (totalPages !== null) return page < totalPages;
  return pageSize > 0 && itemCount >= pageSize;
}

/** Never clear a running, paused, or otherwise pending queue from a new UI action. */
export function canStartNewRelist(status: Pick<QueueStatus, 'state' | 'items'>): boolean {
  return (
    status.state === 'idle' &&
    !status.items.some((item) => PENDING_QUEUE_STATUSES.has(item.status))
  );
}
