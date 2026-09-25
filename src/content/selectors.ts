/**
 * Isolated Vinted DOM selectors and URL patterns.
 *
 * Validated on a real Vinted page (vinted.pl) based on manual E2E testing.
 * Selectors marked "best-effort" use fallback logic in the scanner.
 *
 * Last updated: 2026-07-14 — Vinted changed item card from static
 * data-testid="feed-grid-item" to dynamic product-item-id-{N} with
 * class .feed-grid__item. Title/price use $= suffix selectors.
 */

export const SELECTORS = {
  /** Container that holds the grid/list of user listings. */
  USER_LISTINGS_CONTAINER: '.feed-grid',

  /** Individual listing card/row inside the container. */
  LISTING_ITEM: '.feed-grid__item',

  /**
   * Fallback card-like parent for listing links when LISTING_ITEM no longer
   * matches the Vinted DOM.
   */
  LISTING_CARD_FALLBACK_ROOT: 'article, li, .feed-grid__item, [data-testid^="product-item-id-"], [data-testid*="item"]',

  /** Listing title element, relative to LISTING_ITEM. Best-effort fallback. */
  LISTING_TITLE: '[data-testid$="--description-title"]',

  /** Listing price element, relative to LISTING_ITEM. Best-effort fallback. */
  LISTING_PRICE: '[data-testid$="--price-text"]',

  /** Link to the listing detail page, relative to LISTING_ITEM. */
  LISTING_LINK: 'a[href*="/items/"]',

  /** Image inside a listing card, used for thumbnail fallback. */
  LISTING_IMAGE: 'img',

  /** Picture/source fallbacks used while extracting thumbnails. */
  LISTING_PICTURE: 'picture',
  LISTING_PICTURE_SOURCE: 'source[srcset]',

  /** Elements that may carry CSS background thumbnails. */
  LISTING_BACKGROUND_IMAGE_CANDIDATES: 'div, a, span, figure',

  /** Data attributes that may hold lazy-loaded thumbnail URLs. */
  LISTING_THUMBNAIL_DATA_ATTRIBUTES: ['data-url', 'data-src', 'data-image', 'data-thumbnail', 'data-photo'],

  /** Best-effort description selectors for listing cards/details. */
  LISTING_DESCRIPTION_CANDIDATES: [
    '[data-testid$="--description--content"]',
    '[class*="description"]',
    '[class*="desc"]',
    'p[class*="description"]',
    '[data-testid="item-details-description"]',
  ],

  /** Checkbox or selection target injected by the overlay, relative to LISTING_ITEM. */
  LISTING_SELECTION_TARGET: 'a[href*="/items/"]',

  /**
   * Marker that indicates the current page is a listing detail page.
   * Multiple selectors are tried in order; h1 is the ultimate fallback.
   */
  LISTING_DETAIL_PAGE_MARKER:
    '[data-testid="item-title"], [data-testid="item-details-title"], [data-testid="item-description"], h1',

  /**
   * Button that starts the relist action on a listing detail page.
   * May not exist for active listings (only for hidden/ended ones).
   * The relist-runner also does text-based fallback search.
   */
  RELIST_BUTTON: 'button[data-testid="relist-button"], button[data-testid="item-action-relist"]',
  RELIST_BUTTON_TEST_IDS: ['relist-button', 'item-action-relist', 'relist-item-button'],
  RELIST_TEXT_TARGETS: 'button, a, [role="button"]',

  /**
   * Confirmation button shown after initiating a relist.
   * Empty string means no confirmation step was observed in the tested flow.
   */
  RELIST_CONFIRM_BUTTON: '',
  RELIST_SUCCESS_FEEDBACK: '[class*="toast"], [class*="notification"], [role="alert"]',

  /** Edit button on a listing detail page (visible for active listings). */
  ITEM_EDIT_BUTTON: 'button[data-testid="item-edit-button"]',
  ITEM_EDIT_BUTTON_TEST_IDS: ['item-edit-button'],

  /** Delete button on a listing detail page. */
  ITEM_DELETE_BUTTON: 'button[data-testid="item-delete-button"]',

  /** Overflow / "more actions" menu button on a listing detail page. */
  ITEM_OVERFLOW_MENU: '[data-testid*="menu"], button[aria-haspopup], [data-testid*="more"]',
} as const;

export function dataTestIdSelector(testId: string): string {
  return `[data-testid="${testId}"]`;
}

export function attributeSelector(attribute: string): string {
  return `[${attribute}]`;
}

/** Returns true when the current pathname looks like a user listings/closet page. */
export function isUserListingsPath(pathname: string): boolean {
  return /^\/member\/\d+/.test(pathname);
}

/** Returns true when the current pathname looks like a listing detail page. */
export function isListingDetailPath(pathname: string): boolean {
  return /^\/items\/\d+/.test(pathname);
}
