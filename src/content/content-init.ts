import type { ExtensionMessage, Listing, ListingScanSource, ListingScanSummary, PageInfo } from '../core/contracts';
import { formatListingScanSummary, summarizeListingSourceStatuses } from '../core/listing-status';
import { log } from '../core/logger';
import { canUseVisibleDomFallback } from '../core/relist-safety';
import { detectPage } from './page-detector';
import { hideOverlay, mountOverlay, unmountOverlay } from './overlay-controller';
import { scanVisibleListings } from './listing-scanner';
import { executeRelist } from './relist-runner';
import { scanWardrobeListings } from './vinted-api';

let lastUrl = window.location.href;

function createScanSummary(source: ListingScanSource, listings: Listing[]): ListingScanSummary {
  return {
    source,
    total: listings.length,
    statusCounts: summarizeListingSourceStatuses(listings),
  };
}

export function initializeContent(): void {
  log('Content script initializing', 'debug');

  evaluatePage();
  startNavigationWatcher();
}

function evaluatePage(): void {
  const page = detectPage();
  log(`Page detection: ${page.reason}`, page.isRelevant ? 'info' : 'debug');
  updateOverlayForPage(page);
}

function updateOverlayForPage(page: PageInfo): void {
  if (page.isRelevant) {
    mountOverlay();
  } else {
    hideOverlay();
  }
}

function startNavigationWatcher(): void {
  // Lightweight SPA navigation guard: re-evaluate when the URL changes.
  window.addEventListener('popstate', () => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      log(`Navigation detected (popstate): ${window.location.pathname}`, 'debug');
      evaluatePage();
    }
  });

  // Fallback for pushState/replaceState based SPAs.
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = function patchPushState(...args: Parameters<typeof history.pushState>) {
    originalPushState(...args);
    onPossibleNavigation();
  };

  history.replaceState = function patchReplaceState(
    ...args: Parameters<typeof history.replaceState>
  ) {
    originalReplaceState(...args);
    onPossibleNavigation();
  };
}

function onPossibleNavigation(): void {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    log(`Navigation detected (history): ${window.location.pathname}`, 'debug');
    evaluatePage();
  }
}

export async function handleContentMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case 'SCAN_LISTINGS':
      await log('Scan command received; trying paginated wardrobe API scan', 'info');
      try {
        const listings = await scanWardrobeListings();
        if (listings.length > 0) {
          const scan = createScanSummary('wardrobe-api', listings);
          return {
            ok: true,
            note: formatListingScanSummary(scan),
            listings,
            scan,
          };
        }
        await log('Wardrobe API scan returned 0 items; falling back to visible page listings', 'warn');
      } catch (err) {
        await log(
          `Wardrobe API scan failed; falling back to visible page listings: ${String(err).slice(0, 220)}`,
          'warn',
        );
      }

      const page = detectPage();
      if (!canUseVisibleDomFallback(page.pageType)) {
        const error =
          `Skan awaryjny DOM został zablokowany na stronie typu ${page.pageType}. ` +
          'Otwórz własną garderobę Vinted i ponów skan.';
        await log(error, 'error');
        return { ok: false, error };
      }

      const visibleListings = await scanVisibleListings();
      const scan = createScanSummary('visible-dom-fallback', visibleListings);
      return {
        ok: true,
        note: formatListingScanSummary(scan),
        listings: visibleListings,
        scan,
      };

    case 'RELIST_ITEM':
      await log(`Relist command received for ${message.payload.listing.id}`, 'info');
      const result = await executeRelist(message.payload.listing);
      return { ok: result.success, result };

    default:
      return {
        ok: false,
        error: `Message type "${message.type}" is not handled by the content script.`,
      };
  }
}
