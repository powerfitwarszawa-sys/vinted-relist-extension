import type { PageInfo } from '../core/contracts';
import { isListingDetailPath, isUserListingsPath } from './selectors';

/**
 * Inspect the current URL to decide whether this is a page the extension
 * should care about.
 *
 * This function does not touch the DOM except to read `location`.
 */
export function detectPage(): PageInfo {
  const pathname = window.location.pathname;

  if (isUserListingsPath(pathname)) {
    return {
      isRelevant: true,
      pageType: 'user-listings',
      reason: `Matched user listings path: ${pathname}`,
    };
  }

  if (isListingDetailPath(pathname)) {
    return {
      isRelevant: true,
      pageType: 'item-detail',
      reason: `Matched listing detail path: ${pathname}`,
    };
  }

  return {
    isRelevant: false,
    pageType: 'other',
    reason: `Unrecognized path: ${pathname}`,
  };
}
