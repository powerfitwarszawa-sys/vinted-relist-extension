import type { Listing } from '../core/contracts';
import { log } from '../core/logger';
import { resolveVisibleListingStatus } from '../core/relist-safety';
import { SELECTORS, attributeSelector } from './selectors';

/**
 * Extract a numeric listing id from a Vinted item URL path such as
 * `/items/12345678-title`.
 */
function parseListingId(url: URL): string | undefined {
  const match = url.pathname.match(/^\/items\/(\d+)/);
  return match?.[1];
}

/**
 * Extract price and currency from free-form text such as "123,45 zł" or "€12.34".
 * This is intentionally forgiving because the exact price format varies by locale.
 */
const CURRENCY_PATTERN = String.raw`z\u0142|zl|pln|\u20ac|eur|\$|usd|\u00a3|gbp`;
const PRICE_THEN_CURRENCY = new RegExp(
  String.raw`(\d+(?:[,.]\d{1,2})?)\s*(${CURRENCY_PATTERN})`,
  'i',
);
const CURRENCY_THEN_PRICE = new RegExp(
  String.raw`(${CURRENCY_PATTERN})\s*(\d+(?:[,.]\d{1,2})?)`,
  'i',
);

function parsePrice(text: string): { price: number; currency: string } {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const afterMatch = collapsed.match(PRICE_THEN_CURRENCY);
  if (afterMatch) {
    return {
      price: Number(afterMatch[1].replace(',', '.')),
      currency: normalizeCurrency(afterMatch[2]),
    };
  }

  const beforeMatch = collapsed.match(CURRENCY_THEN_PRICE);
  if (beforeMatch) {
    return {
      price: Number(beforeMatch[2].replace(',', '.')),
      currency: normalizeCurrency(beforeMatch[1]),
    };
  }

  return { price: 0, currency: '' };
}

function normalizeCurrency(currency: string): string {
  const lowered = currency.toLowerCase();
  if (lowered === 'zl' || lowered === 'pln') return 'z\u0142';
  if (lowered === 'eur') return '\u20ac';
  if (lowered === 'usd') return '$';
  if (lowered === 'gbp') return '\u00a3';
  return currency;
}

function getListingLink(item: Element): HTMLAnchorElement | null {
  if (item instanceof HTMLAnchorElement && item.matches(SELECTORS.LISTING_LINK)) {
    return item;
  }

  return item.querySelector<HTMLAnchorElement>(SELECTORS.LISTING_LINK);
}

function findFallbackListingElements(container: Element): Element[] {
  const links = Array.from(container.querySelectorAll<HTMLAnchorElement>(SELECTORS.LISTING_LINK));
  const elements: Element[] = [];
  const seenElements = new Set<Element>();

  for (const link of links) {
    const fallbackRoot = link.closest(SELECTORS.LISTING_CARD_FALLBACK_ROOT);
    const element = fallbackRoot && container.contains(fallbackRoot) ? fallbackRoot : link;

    if (!seenElements.has(element)) {
      seenElements.add(element);
      elements.push(element);
    }
  }

  return elements;
}

function compactText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function uniqueTexts(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const texts: string[] = [];

  for (const value of values) {
    const text = compactText(value ?? '');
    if (text && !seen.has(text)) {
      seen.add(text);
      texts.push(text);
    }
  }

  return texts;
}

function getListingTextCandidates(item: Element): string[] {
  const link = getListingLink(item);
  const img = item.querySelector<HTMLImageElement>(SELECTORS.LISTING_IMAGE);
  const title = item.querySelector<HTMLElement>(SELECTORS.LISTING_TITLE);
  const price = item.querySelector<HTMLElement>(SELECTORS.LISTING_PRICE);

  return uniqueTexts([
    price?.textContent ?? undefined,
    title?.textContent ?? undefined,
    link?.title,
    img?.alt,
    link?.textContent ?? undefined,
    item.textContent ?? undefined,
  ]);
}

function getListingTitleCandidates(item: Element): string[] {
  const link = getListingLink(item);
  const img = item.querySelector<HTMLImageElement>(SELECTORS.LISTING_IMAGE);
  const title = item.querySelector<HTMLElement>(SELECTORS.LISTING_TITLE);

  return uniqueTexts([
    link?.title,
    img?.alt,
    title?.textContent ?? undefined,
    link?.textContent ?? undefined,
    item.textContent ?? undefined,
  ]);
}

function normalizeTitle(text: string): string {
  let title = compactText(text).replace(/^Ukryte\s+w\s+katalogu\s*/i, '');
  const afterPrice = title.match(PRICE_THEN_CURRENCY);
  const beforePrice = title.match(CURRENCY_THEN_PRICE);
  if (
    (afterPrice?.index === 0 && afterPrice[0].length === title.length) ||
    (beforePrice?.index === 0 && beforePrice[0].length === title.length)
  ) {
    return '';
  }

  const lowerTitle = title.toLowerCase();
  const metadataMarkers = [', stan:', ', marka:', ', rozmiar:', ', kolor:'];
  const markerIndex = metadataMarkers.reduce<number | undefined>((earliest, marker) => {
    const index = lowerTitle.indexOf(marker);
    if (index === -1) return earliest;
    return earliest === undefined ? index : Math.min(earliest, index);
  }, undefined);

  if (markerIndex !== undefined) {
    title = title.slice(0, markerIndex);
  }

  const priceIndex = title.search(PRICE_THEN_CURRENCY);
  if (priceIndex > 0) {
    title = title.slice(0, priceIndex);
  }

  return title.replace(/[,\s]+$/g, '').trim();
}

function extractTitle(item: Element, id: string): string {
  for (const candidate of getListingTitleCandidates(item)) {
    const title = normalizeTitle(candidate);
    if (title) {
      return title;
    }
  }

  return `Listing ${id}`;
}

function extractPrice(item: Element): { price: number; currency: string } {
  for (const candidate of getListingTextCandidates(item)) {
    const parsed = parsePrice(candidate);
    if (parsed.currency) {
      return parsed;
    }
  }

  return { price: 0, currency: '' };
}

function extractThumbnail(item: Element): string | undefined {
  // 1. Try <img> element with various lazy-loading attributes
  const img = item.querySelector<HTMLImageElement>(SELECTORS.LISTING_IMAGE);
  if (img) {
    const candidates = [
      img.currentSrc,
      img.src,
      img.dataset.src,
      img.dataset.lazySrc,
      img.getAttribute('data-original'),
    ];

    for (const candidate of candidates) {
      if (candidate && !candidate.startsWith('data:') && candidate.trim().length > 0) {
        return candidate;
      }
    }

    const srcset = img.srcset;
    if (srcset) {
      const firstSrc = srcset.split(',')[0]?.trim().split(' ')[0];
      if (firstSrc && !firstSrc.startsWith('data:')) {
        return firstSrc;
      }
    }
  }

  // 2. Try <picture> element
  const picture = item.querySelector(SELECTORS.LISTING_PICTURE);
  if (picture) {
    const source = picture.querySelector<HTMLSourceElement>(SELECTORS.LISTING_PICTURE_SOURCE);
    if (source?.srcset) {
      const firstSrc = source.srcset.split(',')[0]?.trim().split(' ')[0];
      if (firstSrc && !firstSrc.startsWith('data:')) {
        return firstSrc;
      }
    }
    const picImg = picture.querySelector<HTMLImageElement>(SELECTORS.LISTING_IMAGE);
    if (picImg?.src && !picImg.src.startsWith('data:')) {
      return picImg.src;
    }
  }

  // 3. Try background-image on ALL child divs (Vinted często używa div z background-image)
  const allDivs = Array.from(item.querySelectorAll<HTMLElement>(SELECTORS.LISTING_BACKGROUND_IMAGE_CANDIDATES));
  for (const el of allDivs) {
    const bg = el.style.backgroundImage;
    if (bg && bg.includes('url(') && !bg.includes('data:image/')) {
      const match = bg.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/i);
      if (match?.[1]) {
        return match[1];
      }
    }
    // Sprawdź też computed style dla elementów z klasami
    const comp = getComputedStyle(el).backgroundImage;
    if (comp && comp.includes('url(') && !comp.includes('data:image/')) {
      const match = comp.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/i);
      if (match?.[1]) {
        return match[1];
      }
    }
  }

  // 4. Try data-url attributes (Vinted używa czasem data-src na divach)
  for (const attr of SELECTORS.LISTING_THUMBNAIL_DATA_ATTRIBUTES) {
    const el = item.querySelector<HTMLElement>(attributeSelector(attr));
    const val = el?.getAttribute(attr);
    if (val && val.startsWith('http') && !val.startsWith('data:')) {
      return val;
    }
  }

  return undefined;
}

function extractDescription(item: Element): string | undefined {
  for (const selector of SELECTORS.LISTING_DESCRIPTION_CANDIDATES) {
    const el = item.querySelector<HTMLElement>(selector);
    const text = el?.textContent?.replace(/\s+/g, ' ').trim();
    if (text && text.length > 10) {
      return text.slice(0, 200);
    }
  }

  return undefined;
}

function formatListingSample(listings: Listing[]): string {
  return listings
    .slice(0, 3)
    .map((listing) => {
      const price = listing.currency ? `${listing.price} ${listing.currency}` : String(listing.price);
      return `${listing.id}: "${listing.title}" (${price})`;
    })
    .join(' | ');
}

/**
 * Scan the current page for visible user listings.
 *
 * The primary grid container may change with Vinted redesigns. When it is
 * missing, the scan falls back to the whole document so listing links are
 * still found instead of silently returning zero items.
 */
export async function scanVisibleListings(): Promise<Listing[]> {
  let container = document.querySelector(SELECTORS.USER_LISTINGS_CONTAINER);
  if (!container) {
    await log(
      `Listing container "${SELECTORS.USER_LISTINGS_CONTAINER}" not found; falling back to whole-document link scan`,
      'warn',
    );
    container = document.body;
  }

  const primaryItemElements = Array.from(container.querySelectorAll(SELECTORS.LISTING_ITEM));
  const itemElements =
    primaryItemElements.length > 0 ? primaryItemElements : findFallbackListingElements(container);

  if (primaryItemElements.length === 0) {
    await log(
      `Primary listing selector "${SELECTORS.LISTING_ITEM}" matched 0; fallback found ${itemElements.length} listing link container(s)`,
      itemElements.length > 0 ? 'warn' : 'info',
    );
  }

  await log(
    `Found ${itemElements.length} potential listing element(s) on ${window.location.pathname}`,
    'info',
  );

  const listings: Listing[] = [];
  const seenListingIds = new Set<string>();

  for (const element of itemElements) {
    const link = getListingLink(element);
    if (!link?.href) {
      await log('Skipping item: no listing detail link found', 'debug');
      continue;
    }

    const url = new URL(link.href, window.location.origin);
    const id = parseListingId(url);
    if (!id) {
      await log(`Skipping item: could not parse listing id from ${url.pathname}`, 'debug');
      continue;
    }

    if (seenListingIds.has(id)) {
      await log(`Skipping duplicate listing id ${id}`, 'debug');
      continue;
    }
    seenListingIds.add(id);

    const title = extractTitle(element, id);
    const { price, currency } = extractPrice(element);
    const thumbnailUrl = extractThumbnail(element);
    const description = extractDescription(element);
    const sourceStatus = resolveVisibleListingStatus(getListingTextCandidates(element));

    listings.push({
      id,
      title,
      price,
      currency,
      url: url.href,
      thumbnailUrl,
      description,
      sourceStatus,
      status: 'active',
    });
  }

  await log(`Extracted ${listings.length} listing(s)`, 'info');
  if (listings.length > 0) {
    await log(`Listing sample: ${formatListingSample(listings)}`, 'info');
  }
  return listings;
}
