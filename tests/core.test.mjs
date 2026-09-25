/**
 * Unit tests for core business logic.
 *
 * Tests pure functions directly by importing the built ESM output.
 * For storage tests, the logic is tested inline since the module is
 * bundled into the background entry point by esbuild.
 *
 * Run: node tests/core.test.mjs
 */

import {
  ErrorCode,
  isApiAccessOrRateLimitFailure,
  isApiAccessOrRateLimitMessage,
  isRecoverableError,
  RECOVERABLE_ERROR_CODES,
  successResult,
  failureResult,
} from '../dist/core/errors.js';
import {
  createSellerStatusSummary,
  formatListingScanSummary,
  formatSellerStatusSummary,
  getListingSourceStatus,
  LISTING_STATUS_LABELS,
  QUEUE_STATE_LABELS,
  SELLER_LISTING_STATUS_LABELS,
  summarizeListingSourceStatuses,
} from '../dist/core/listing-status.js';
import {
  formatRelistPreflightSummary,
  preflightRelistListings,
} from '../dist/core/relist-preflight.js';
import {
  getSelectedListings,
  getVisibleSelectionState,
  setListingSelection,
  setListingsSelection,
} from '../dist/core/listing-selection.js';

// ── Test runner ─────────────────────────────────────────────────────

let testCount = 0;
let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  testCount++;
  if (condition) { passCount++; console.log(`  ✓ ${message}`); }
  else { failCount++; console.error(`  ✗ FAIL: ${message}`); }
}

function assertEqual(actual, expected, message) {
  testCount++;
  if (actual === expected) { passCount++; console.log(`  ✓ ${message}`); }
  else { failCount++; console.error(`  ✗ FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

// ── errors.ts ───────────────────────────────────────────────────────

function testErrorHelpers() {
  console.log('\n── errors.ts ──');

  const s = successResult('All good');
  assert(s.success === true, 'successResult returns success=true');
  assertEqual(s.code, ErrorCode.SUCCESS, 'successResult code is SUCCESS');
  assertEqual(s.message, 'All good', 'successResult message preserved');

  const f = failureResult(ErrorCode.QUEUE_EMPTY, 'Nothing to process');
  assert(f.success === false, 'failureResult returns success=false');
  assertEqual(f.code, ErrorCode.QUEUE_EMPTY, 'failureResult code matches');
  assertEqual(f.message, 'Nothing to process', 'failureResult message preserved');

  // Recoverable errors
  assert(isRecoverableError(ErrorCode.NOT_ON_DETAIL_PAGE) === true, 'NOT_ON_DETAIL_PAGE is recoverable');
  assert(isRecoverableError(ErrorCode.TAB_COMMUNICATION_ERROR) === true, 'TAB_COMMUNICATION_ERROR is recoverable');
  assert(isRecoverableError(ErrorCode.CONTENT_ERROR) === true, 'CONTENT_ERROR is recoverable');
  assert(isRecoverableError(ErrorCode.DETAIL_MARKER_MISSING) === true, 'DETAIL_MARKER_MISSING is recoverable');
  assert(isRecoverableError(ErrorCode.RELIST_BUTTON_MISSING) === true, 'RELIST_BUTTON_MISSING is recoverable');
  assert(isRecoverableError(ErrorCode.SUCCESS) === false, 'SUCCESS is not recoverable');
  assert(isRecoverableError(ErrorCode.UNKNOWN) === false, 'UNKNOWN is not recoverable');
  assert(isRecoverableError(ErrorCode.QUEUE_EMPTY) === false, 'QUEUE_EMPTY is not recoverable');

  assertEqual(RECOVERABLE_ERROR_CODES.length, 5, `Exactly 5 recoverable error codes`);
  assert(isApiAccessOrRateLimitMessage('API 401 /api/v2/users/current') === true, 'API 401 message pauses a batch');
  assert(isApiAccessOrRateLimitMessage('API 403 /api/v2/photos') === true, 'API 403 message pauses a batch');
  assert(isApiAccessOrRateLimitMessage('API 429 /api/v2/item_upload/drafts') === true, 'API 429 message pauses a batch');
  assert(isApiAccessOrRateLimitMessage('API 400 validation error') === false, 'API 400 message does not pause a batch');
  assert(
    isApiAccessOrRateLimitFailure({ code: ErrorCode.API_ACCESS_OR_RATE_LIMIT, message: 'session expired' }) === true,
    'structured API access/rate-limit code pauses a batch',
  );
}

// ── listing-status.ts ─────────────────────────────────────────────

function testListingStatusHelpers() {
  console.log('\n── listing-status.ts ──');

  assertEqual(LISTING_STATUS_LABELS.success, 'Gotowe', 'queue success label is shared');
  assertEqual(QUEUE_STATE_LABELS.paused, 'wstrzymana', 'queue paused label is shared');
  assertEqual(SELLER_LISTING_STATUS_LABELS.hidden, 'Ukryta', 'seller hidden label is shared');
  assertEqual(
    getListingSourceStatus({ status: 'active' }),
    'active',
    'legacy active queue listing resolves to active seller status',
  );
  assertEqual(
    getListingSourceStatus({ status: 'success' }),
    'unknown',
    'legacy completed queue listing does not claim active seller status',
  );
  assertEqual(
    getListingSourceStatus({ status: 'active', sourceStatus: 'sold' }),
    'sold',
    'explicit seller source status takes precedence over queue status',
  );

  const summary = summarizeListingSourceStatuses([
    { status: 'active', sourceStatus: 'active' },
    { status: 'active', sourceStatus: 'hidden' },
    { status: 'queued', sourceStatus: 'sold' },
    { status: 'active', sourceStatus: 'draft' },
    { status: 'error' },
  ]);
  assertEqual(summary.active, 1, 'summary counts active seller items');
  assertEqual(summary.hidden, 1, 'summary counts hidden seller items');
  assertEqual(summary.sold, 1, 'summary counts sold seller items');
  assertEqual(summary.draft, 1, 'summary counts draft seller items');
  assertEqual(summary.unknown, 1, 'summary counts legacy unknown seller items');
  assertEqual(
    formatSellerStatusSummary(summary),
    'aktywne 1, ukryte 1, sprzedane 1, zarezerwowane 0, szkice 1, nieznane 1',
    'summary format is stable across UI surfaces',
  );
  assertEqual(createSellerStatusSummary().reserved, 0, 'empty summary initializes every seller status');
  assertEqual(
    formatListingScanSummary({
      source: 'visible-dom-fallback',
      total: 2,
      statusCounts: {
        active: 2,
        hidden: 0,
        sold: 0,
        reserved: 0,
        draft: 0,
        unknown: 0,
      },
    }),
    'Widoczna strona (fallback): 2 pozycji · aktywne 2, ukryte 0, sprzedane 0, zarezerwowane 0, szkice 0, nieznane 0',
    'scan summary includes source and stable status counts',
  );
}

// ── relist-preflight.ts ───────────────────────────────────────────

function testRelistPreflight() {
  console.log('\n── relist-preflight.ts ──');

  const result = preflightRelistListings([
    { id: 'active-1', title: 'Aktywna', price: 10, currency: 'PLN', url: 'https://www.vinted.pl/items/active-1', status: 'active', sourceStatus: 'active' },
    { id: 'hidden-1', title: 'Ukryta', price: 11, currency: 'PLN', url: 'https://www.vinted.pl/items/hidden-1', status: 'active', sourceStatus: 'hidden' },
    { id: 'active-1', title: 'Duplikat', price: 10, currency: 'PLN', url: 'https://www.vinted.pl/items/active-1', status: 'active', sourceStatus: 'active' },
    { id: '', title: 'Bez ID', price: 10, currency: 'PLN', url: 'https://www.vinted.pl/items/no-id', status: 'active', sourceStatus: 'active' },
    { id: 'no-url', title: 'Bez URL', price: 10, currency: 'PLN', url: '', status: 'active', sourceStatus: 'active' },
  ]);

  assertEqual(result.accepted.length, 2, 'preflight keeps valid unique listings');
  assertEqual(
    result.issues.filter((entry) => entry.severity === 'block').length,
    3,
    'preflight blocks duplicate, missing ID, and missing URL',
  );
  assertEqual(
    result.issues.filter((entry) => entry.code === 'non-active-source-status').length,
    1,
    'preflight warns for non-active seller status without silently dropping it',
  );
  assertEqual(
    formatRelistPreflightSummary(result),
    'Preflight: gotowe 2, blokady 3, ostrzeżenia 1.',
    'preflight summary is stable for UI and logs',
  );
}

// ── Storage stats logic (test inline — module bundled by esbuild) ───

function testListingSelectionHelpers() {
  console.log('\n-- listing-selection.ts --');

  const listings = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
    { id: 'c', title: 'C' },
  ];
  const initiallySelected = new Set(['b']);
  const afterSingleSelect = setListingSelection(initiallySelected, 'a', true);

  assertEqual(initiallySelected.has('a'), false, 'single selection does not mutate the prior set');
  assertEqual(afterSingleSelect.has('a'), true, 'single selection adds a listing ID');
  assertEqual(
    getSelectedListings(listings, afterSingleSelect).map((listing) => listing.id).join(','),
    'a,b',
    'selected listings retain source-list order',
  );

  const afterVisibleBulkSelect = setListingsSelection(afterSingleSelect, ['a', 'c'], true);
  assertEqual(afterVisibleBulkSelect.size, 3, 'bulk select adds visible listing IDs');

  const afterVisibleBulkClear = setListingsSelection(afterVisibleBulkSelect, ['a', 'c'], false);
  assertEqual(afterVisibleBulkClear.has('b'), true, 'bulk clear preserves IDs outside the filtered view');
  assertEqual(afterVisibleBulkClear.size, 1, 'bulk clear removes only supplied visible listing IDs');

  const allVisible = getVisibleSelectionState(['b'], afterVisibleBulkClear);
  assertEqual(allVisible.visibleCount, 1, 'visible selection counts unique visible IDs');
  assertEqual(allVisible.allVisibleSelected, true, 'single selected visible ID marks select-all as checked');
  assertEqual(allVisible.someVisibleSelected, true, 'single selected visible ID marks an active selection');

  const partialVisible = getVisibleSelectionState(['a', 'b', 'a', 'c'], afterVisibleBulkClear);
  assertEqual(partialVisible.visibleCount, 3, 'visible selection ignores duplicate IDs');
  assertEqual(partialVisible.selectedVisibleCount, 1, 'visible selection counts only selected visible IDs');
  assertEqual(partialVisible.allVisibleSelected, false, 'partial visible selection does not mark all selected');
  assertEqual(partialVisible.someVisibleSelected, true, 'partial visible selection is marked indeterminate');

  const emptyVisible = getVisibleSelectionState([], afterVisibleBulkClear);
  assertEqual(emptyVisible.allVisibleSelected, false, 'empty visible view never marks select-all checked');
  assertEqual(emptyVisible.someVisibleSelected, false, 'empty visible view has no active visible selection');
}

async function testStatsDayReset() {
  console.log('\n── storage.ts (stats day-reset logic) ──');

  // Inline the core logic of the getStats function to test it independently
  // This avoids the esbuild bundling issue where storage.ts is only in background.js
  function simulateGetStats(stored, today) {
    const storedDate = stored && stored.lastDate ? stored.lastDate : undefined;
    const stats = {
      todayRelisted: storedDate === today ? (stored.todayRelisted ?? 0) : 0,
      todaySuccess: storedDate === today ? (stored.todaySuccess ?? 0) : 0,
      todayError: storedDate === today ? (stored.todayError ?? 0) : 0,
      totalRelisted: stored?.totalRelisted ?? 0,
      lastDate: today,
    };
    return stats;
  }

  const today = new Date().toISOString().slice(0, 10);

  // 1. No data — all zeros
  const r1 = simulateGetStats(null, today);
  assertEqual(r1.todayRelisted, 0, 'no data: todayRelisted = 0');
  assertEqual(r1.totalRelisted, 0, 'no data: totalRelisted = 0');
  assertEqual(r1.lastDate, today, 'no data: lastDate set');

  // 2. Same day — counters preserved
  const r2 = simulateGetStats(
    { todayRelisted: 5, todaySuccess: 4, todayError: 1, totalRelisted: 42, lastDate: today },
    today,
  );
  assertEqual(r2.todayRelisted, 5, 'same day: todayRelisted preserved');
  assertEqual(r2.totalRelisted, 42, 'same day: totalRelisted preserved');
  assertEqual(r2.todaySuccess, 4, 'same day: todaySuccess preserved');
  assertEqual(r2.todayError, 1, 'same day: todayError preserved');

  // 3. Different day — today counters reset, total preserved
  const r3 = simulateGetStats(
    { todayRelisted: 5, todaySuccess: 4, todayError: 1, totalRelisted: 42, lastDate: '2000-01-01' },
    today,
  );
  assertEqual(r3.todayRelisted, 0, 'new day: todayRelisted reset');
  assertEqual(r3.totalRelisted, 42, 'new day: totalRelisted preserved');
  assertEqual(r3.todaySuccess, 0, 'new day: todaySuccess reset');
  assertEqual(r3.todayError, 0, 'new day: todayError reset');
  assertEqual(r3.lastDate, today, 'new day: lastDate updated');

  // 4. Migration — no lastDate, today counters reset
  const r4 = simulateGetStats(
    { todayRelisted: 99, totalRelisted: 100, todaySuccess: 50, todayError: 49 },
    today,
  );
  assertEqual(r4.todayRelisted, 0, 'migration: todayRelisted reset');
  assertEqual(r4.totalRelisted, 100, 'migration: totalRelisted preserved');
  assertEqual(r4.lastDate, today, 'migration: lastDate set');
}

// ── listing-scanner logic (inline — content module) ─────────────────

function testPriceParsing() {
  console.log('\n── listing-scanner.ts (parsePrice logic) ──');

  // Inline the regex-based price parsing logic
  const CURRENCY_PATTERN = String.raw`z\u0142|zl|pln|\u20ac|eur|\$|usd|\u00a3|gbp`;
  const PRICE_THEN_CURRENCY = new RegExp(
    String.raw`(\d+(?:[,.]\d{1,2})?)\s*(${CURRENCY_PATTERN})`, 'i',
  );
  const CURRENCY_THEN_PRICE = new RegExp(
    String.raw`(${CURRENCY_PATTERN})\s*(\d+(?:[,.]\d{1,2})?)`, 'i',
  );

  function normalizeCurrency(c) {
    const lc = c.toLowerCase();
    if (lc === 'zl' || lc === 'pln') return 'zł';
    if (lc === 'eur') return '€';
    if (lc === 'usd') return '$';
    if (lc === 'gbp') return '£';
    return c;
  }

  function parsePrice(text) {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    const afterMatch = collapsed.match(PRICE_THEN_CURRENCY);
    if (afterMatch) {
      return { price: Number(afterMatch[1].replace(',', '.')), currency: normalizeCurrency(afterMatch[2]) };
    }
    const beforeMatch = collapsed.match(CURRENCY_THEN_PRICE);
    if (beforeMatch) {
      return { price: Number(beforeMatch[2].replace(',', '.')), currency: normalizeCurrency(beforeMatch[1]) };
    }
    return { price: 0, currency: '' };
  }

  // PLN
  let p = parsePrice('123,45 zł');
  assertEqual(p.price, 123.45, 'PLN dot: "123,45 zł" → 123.45');
  assertEqual(p.currency, 'zł', 'PLN dot: currency = zł');

  p = parsePrice('100 zł');
  assertEqual(p.price, 100, 'PLN no cents: "100 zł" → 100');

  // €
  p = parsePrice('€12.34');
  assertEqual(p.price, 12.34, 'EUR prefix: "€12.34" → 12.34');
  assertEqual(p.currency, '€', 'EUR prefix: currency = €');

  p = parsePrice('12,34 €');
  assertEqual(p.price, 12.34, 'EUR suffix: "12,34 €" → 12.34');

  // $ / USD
  p = parsePrice('$50.00');
  assertEqual(p.price, 50, 'USD prefix: "$50.00" → 50');
  assertEqual(p.currency, '$', 'USD prefix: currency = $');

  p = parsePrice('50 usd');
  assertEqual(p.currency, '$', 'USD suffix: "50 usd" → $');

  // £ / GBP
  p = parsePrice('£25');
  assertEqual(p.price, 25, 'GBP: "£25" → 25');

  // Edge: no price
  p = parsePrice('Free');
  assertEqual(p.price, 0, 'no price: "Free" → 0');
  assertEqual(p.currency, '', 'no price: currency = ""');

  // Edge: empty
  p = parsePrice('');
  assertEqual(p.price, 0, 'empty string → 0');

  // Edge: just currency
  p = parsePrice('zł');
  assertEqual(p.price, 0, 'just currency → price 0');
}

function testListingIdParsing() {
  console.log('\n── listing-scanner.ts (parseListingId logic) ──');

  function parseListingId(pathname) {
    const match = pathname.match(/^\/items\/(\d+)/);
    return match ? match[1] : undefined;
  }

  assertEqual(parseListingId('/items/12345678'), '12345678', 'basic path');
  assertEqual(parseListingId('/items/12345678-title'), '12345678', 'path with suffix');
  assertEqual(parseListingId('/items/98765/something'), '98765', 'path with trailing segments');
  assertEqual(parseListingId('/member/123'), undefined, 'not a detail path');
  assertEqual(parseListingId(''), undefined, 'empty path');
}

function testSellerListingStatusMapping() {
  console.log('\n── wardrobe source-status mapping ──');

  function asBoolean(value) {
    if (value === true || value === 1 || value === '1') return true;
    if (value === false || value === 0 || value === '0') return false;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    return undefined;
  }

  function sourceStatus(item, statusHint) {
    const state = [item.status, item.status_name, item.state]
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim().toLowerCase())
      .join(' ');
    if (asBoolean(item.is_sold) === true || state.includes('sold') || state.includes('sprzed')) return 'sold';
    if (asBoolean(item.is_draft) === true || state.includes('draft') || state.includes('robocz')) return 'draft';
    if (asBoolean(item.is_reserved) === true || state.includes('reserv') || state.includes('zarezer')) return 'reserved';
    if (state.includes('active') || state.includes('available') || asBoolean(item.is_visible) === true) return 'active';
    if (statusHint) return statusHint;
    if (asBoolean(item.is_visible) === false || state.includes('hidden') || state.includes('ukryt') || state.includes('inactive')) return 'hidden';
    return 'unknown';
  }

  assertEqual(sourceStatus({ is_visible: true }), 'active', 'visible API item maps to active');
  assertEqual(sourceStatus({ is_visible: false }), 'hidden', 'invisible API item maps to hidden');
  assertEqual(sourceStatus({ is_sold: true, is_visible: true }), 'sold', 'sold takes precedence over visible');
  assertEqual(sourceStatus({ is_reserved: 'true' }), 'reserved', 'reserved string flag maps to reserved');
  assertEqual(sourceStatus({ status: 'draft' }), 'draft', 'draft status text maps to draft');
  assertEqual(sourceStatus({ status_name: 'Ukryty' }), 'hidden', 'Polish hidden status text maps to hidden');
  assertEqual(sourceStatus({ is_visible: false }, 'sold'), 'sold', 'sold status query labels a non-public item without flags');
  assertEqual(sourceStatus({ is_visible: true }, 'sold'), 'active', 'ignored sold query does not relabel visible public item');
  assertEqual(sourceStatus({}), 'unknown', 'missing API state maps to unknown');
}

// ── Queue helpers ───────────────────────────────────────────────────

function testQueueStateHelpers() {
  console.log('\n── queue.ts (status computation logic) ──');

  function computeStatus(items) {
    const completed = items.filter((i) => i.listing.status === 'success').length;
    const failed = items.filter((i) => i.listing.status === 'error').length;
    return { completed, failed };
  }

  const items1 = [
    { listing: { id: '1', status: 'success' } },
    { listing: { id: '2', status: 'error' } },
    { listing: { id: '3', status: 'success' } },
  ];
  assertEqual(computeStatus(items1).completed, 2, '2 successes');
  assertEqual(computeStatus(items1).failed, 1, '1 failure');

  const items2 = [
    { listing: { id: '1', status: 'queued' } },
    { listing: { id: '2', status: 'running' } },
  ];
  assertEqual(computeStatus(items2).completed, 0, 'no completed when queued/running');
  assertEqual(computeStatus(items2).failed, 0, 'no failed when queued/running');
}

// ── Run ─────────────────────────────────────────────────────────────

async function main() {
  console.log('========================================');
  console.log('Core Business Logic Unit Tests');
  console.log('========================================');

  testErrorHelpers();
  testListingStatusHelpers();
  testRelistPreflight();
  testListingSelectionHelpers();
  await testStatsDayReset();
  testPriceParsing();
  testListingIdParsing();
  testSellerListingStatusMapping();
  testQueueStateHelpers();

  console.log('\n========================================');
  console.log(`Results: ${passCount}/${testCount} passed, ${failCount} failed`);
  console.log('========================================');

  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
