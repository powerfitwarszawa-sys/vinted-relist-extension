/**
 * Local validation before listings enter the relist queue.
 *
 * It never contacts Vinted and does not mutate listings. Seller statuses are
 * warnings rather than hard blocks until live Vinted behaviour for every
 * status is confirmed manually; malformed and duplicate data are blocked.
 */

import type { Listing, RelistPreflightIssue, RelistPreflightResult } from './contracts';
import { getListingSourceStatus, SELLER_LISTING_STATUS_LABELS } from './listing-status';

function issue(
  code: RelistPreflightIssue['code'],
  severity: RelistPreflightIssue['severity'],
  listingId: string,
  message: string,
): RelistPreflightIssue {
  return { code, severity, listingId, message };
}

export function preflightRelistListings(listings: readonly Listing[]): RelistPreflightResult {
  const accepted: Listing[] = [];
  const issues: RelistPreflightIssue[] = [];
  const seenIds = new Set<string>();

  for (const listing of listings) {
    const listingId = listing.id.trim();
    let blocked = false;

    if (!listingId) {
      issues.push(issue('missing-id', 'block', '(brak ID)', 'Aukcja bez ID nie może trafić do kolejki.'));
      blocked = true;
    } else if (seenIds.has(listingId)) {
      issues.push(issue('duplicate-id', 'block', listingId, `Aukcja ${listingId} występuje w wyborze więcej niż raz.`));
      blocked = true;
    } else {
      seenIds.add(listingId);
    }

    if (!listing.title.trim()) {
      issues.push(issue('missing-title', 'block', listingId || '(brak ID)', 'Aukcja bez tytułu nie może trafić do kolejki.'));
      blocked = true;
    }
    if (!listing.url.trim()) {
      issues.push(issue('missing-url', 'block', listingId || '(brak ID)', 'Aukcja bez adresu nie może trafić do kolejki.'));
      blocked = true;
    }
    if (blocked) continue;

    accepted.push(listing);
    const sourceStatus = getListingSourceStatus(listing);
    if (sourceStatus !== 'active') {
      issues.push(
        issue(
          'non-active-source-status',
          'warn',
          listingId,
          `Aukcja ${listingId} ma status „${SELLER_LISTING_STATUS_LABELS[sourceStatus]}”. ` +
            'Relist może wymagać ręcznej weryfikacji na Vinted.',
        ),
      );
    }
  }

  return { accepted, issues };
}

export function formatRelistPreflightSummary(result: RelistPreflightResult): string {
  const blocks = result.issues.filter((entry) => entry.severity === 'block').length;
  const warnings = result.issues.filter((entry) => entry.severity === 'warn').length;
  return `Preflight: gotowe ${result.accepted.length}, blokady ${blocks}, ostrzeżenia ${warnings}.`;
}
