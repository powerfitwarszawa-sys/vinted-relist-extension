/**
 * Unit tests for the scheduled (automatic) relist cycle decisions.
 *
 * Tests the pure core module directly by importing the built ESM output.
 *
 * Run: node tests/auto-relist.test.mjs
 */

import {
  evaluateAutoRelistGate,
  hasPendingQueueItems,
  SCAN_MAX_AGE_MS,
  selectDueForAutoRelist,
} from '../dist/core/auto-relist.js';

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

// ── Fixtures ────────────────────────────────────────────────────────

const HOUR = 60 * 60 * 1000;

function listing(id, overrides = {}) {
  return {
    id,
    title: `Item ${id}`,
    price: 10,
    currency: 'PLN',
    url: `https://www.vinted.pl/items/${id}`,
    status: 'active',
    sourceStatus: 'active',
    ...overrides,
  };
}

function idleQueue() {
  return { state: 'idle', items: [] };
}

function scanFixture(listings, scannedAt = 1_000_000) {
  return { scannedAt, source: 'wardrobe-api', listings };
}

// ── selectDueForAutoRelist ─────────────────────────────────────────

function testSelection() {
  console.log('\n── selectDueForAutoRelist ──');

  // Large now so every lastRelisted stays positive and distinct from the
  // never-relisted fallback value of 0.
  const now = 100 * HOUR;

  // Never-relisted active items are always due and sorted first.
  const neverRelisted = selectDueForAutoRelist(
    [listing('a'), listing('b'), listing('c')],
    { minHoursSinceRelist: 24, maxPerCycle: 5, now },
  );
  assertEqual(neverRelisted.length, 3, 'never-relisted active items are all due');

  // Cap limits the batch size.
  const capped = selectDueForAutoRelist(
    [listing('a'), listing('b'), listing('c')],
    { minHoursSinceRelist: 24, maxPerCycle: 2, now },
  );
  assertEqual(capped.length, 2, 'maxPerCycle caps the due batch');

  // Minimum age since last relist is respected.
  const recent = selectDueForAutoRelist(
    [
      listing('fresh', { lastRelisted: now - 2 * HOUR }),
      listing('old', { lastRelisted: now - 30 * HOUR }),
    ],
    { minHoursSinceRelist: 24, maxPerCycle: 5, now },
  );
  assertEqual(recent.map((l) => l.id).join(','), 'old', 'items relisted within minHours are excluded');

  // Oldest (or never) relisted sort to the front, so the wardrobe rotates fairly.
  const order = selectDueForAutoRelist(
    [
      listing('mid', { lastRelisted: now - 10 * HOUR }),
      listing('never', { lastRelisted: undefined }),
      listing('oldest', { lastRelisted: now - 40 * HOUR }),
    ],
    { minHoursSinceRelist: 5, maxPerCycle: 5, now },
  );
  assertEqual(order.map((l) => l.id).join(','), 'never,oldest,mid', 'never-relisted sorts first, then oldest');

  // Non-active seller statuses are never auto-bumped.
  const skipNonActive = selectDueForAutoRelist(
    [
      listing('active1'),
      listing('sold1', { sourceStatus: 'sold' }),
      listing('hidden1', { sourceStatus: 'hidden' }),
      listing('reserved1', { sourceStatus: 'reserved' }),
      listing('draft1', { sourceStatus: 'draft' }),
    ],
    { minHoursSinceRelist: 0, maxPerCycle: 5, now },
  );
  assertEqual(skipNonActive.map((l) => l.id).join(','), 'active1', 'sold/hidden/reserved/draft items are excluded');

  // Unknown source status is NOT auto-bumped: an unresolved item may be
  // hidden/sold on Vinted, so automation stays conservative (unlike the
  // manual queue, which can still inspect it at runtime).
  const unknownSkipped = selectDueForAutoRelist(
    [listing('unk', { sourceStatus: 'unknown' })],
    { minHoursSinceRelist: 0, maxPerCycle: 5, now },
  );
  assertEqual(unknownSkipped.length, 0, 'unknown source status is not auto-relisted');

  // Zero cap never selects anything.
  const zeroCap = selectDueForAutoRelist([listing('a')], { minHoursSinceRelist: 0, maxPerCycle: 0, now });
  assertEqual(zeroCap.length, 0, 'maxPerCycle=0 selects nothing');

  // Items without an id are ignored defensively.
  const noId = selectDueForAutoRelist(
    [{ ...listing('x'), id: '' }],
    { minHoursSinceRelist: 0, maxPerCycle: 5, now },
  );
  assertEqual(noId.length, 0, 'listing without id is ignored');
}

// ── hasPendingQueueItems ────────────────────────────────────────────

function testPendingQueueItems() {
  console.log('\n── hasPendingQueueItems ──');

  assert(hasPendingQueueItems(idleQueue()) === false, 'empty idle queue has no pending items');
  assert(
    hasPendingQueueItems({ state: 'idle', items: [{ id: '1', status: 'success' }] }) === false,
    'terminal items alone are not pending',
  );
  assert(
    hasPendingQueueItems({ state: 'idle', items: [{ id: '1', status: 'queued' }] }) === true,
    'queued items are pending even when state is idle',
  );
  assert(
    hasPendingQueueItems({ state: 'paused', items: [{ id: '1', status: 'paused' }] }) === true,
    'paused items are pending',
  );
  assert(
    hasPendingQueueItems({ state: 'running', items: [{ id: '1', status: 'running' }] }) === true,
    'running items are pending',
  );
}

// ── evaluateAutoRelistGate ──────────────────────────────────────────

function testGate() {
  console.log('\n── evaluateAutoRelistGate ──');

  const now = 10 * HOUR;
  const freshScan = scanFixture([listing('a')], now - HOUR);

  // Disabled setting blocks the cycle.
  const disabled = evaluateAutoRelistGate(false, idleQueue(), freshScan, { now });
  assert(disabled.allowed === false, 'disabled auto-relist blocks the cycle');
  assert(disabled.reason.includes('wyłączone'), 'disabled reason is explicit');

  // Busy manual queue blocks the cycle (never interrupts a running batch).
  const busy = evaluateAutoRelistGate(true, { state: 'running', items: [{ id: '1', status: 'queued' }] }, freshScan, { now });
  assert(busy.allowed === false, 'running batch blocks an automatic cycle');
  assert(busy.reason.includes('kolejka nie jest bezczynna'), 'busy reason names the queue state');

  // Paused queue with pending items also blocks.
  const paused = evaluateAutoRelistGate(true, { state: 'paused', items: [{ id: '1', status: 'queued' }] }, freshScan, { now });
  assert(paused.allowed === false, 'paused queue with pending items blocks an automatic cycle');

  // Missing scan blocks the cycle.
  const noScan = evaluateAutoRelistGate(true, idleQueue(), null, { now });
  assert(noScan.allowed === false, 'missing saved scan blocks the cycle');
  assert(noScan.reason.includes('brak zapisanego skanu'), 'missing scan reason guides the user to scan first');

  // Empty scan listings block the cycle.
  const emptyScan = evaluateAutoRelistGate(true, idleQueue(), scanFixture([], now - HOUR), { now });
  assert(emptyScan.allowed === false, 'empty saved scan blocks the cycle');

  // Stale scan blocks the cycle with its age in the reason.
  const stale = evaluateAutoRelistGate(true, idleQueue(), scanFixture([listing('a')], now - 8 * 24 * HOUR), { now });
  assert(stale.allowed === false, 'scan older than the default maximum blocks the cycle');
  assert(stale.reason.includes('dni'), 'stale reason includes the scan age in days');

  // Custom max scan age is honoured.
  const acceptsCustom = evaluateAutoRelistGate(
    true,
    idleQueue(),
    scanFixture([listing('a')], now - 3 * 24 * HOUR),
    { now, maxScanAgeMs: 4 * 24 * HOUR },
  );
  assert(acceptsCustom.allowed === true, 'scan within custom max age is accepted');

  // A fresh scan with an idle queue is allowed.
  const fresh = evaluateAutoRelistGate(true, idleQueue(), freshScan, { now });
  assert(fresh.allowed === true, 'fresh scan with idle queue allows the cycle');
  assert(fresh.reason === undefined, 'allowed gate carries no reason');

  // Default maximum scan age constant is seven days.
  assertEqual(SCAN_MAX_AGE_MS, 7 * 24 * HOUR, 'default scan max age is 7 days');
}

// ── Run ─────────────────────────────────────────────────────────────

function main() {
  console.log('========================================');
  console.log('Auto-Relist Decision Unit Tests');
  console.log('========================================');

  testSelection();
  testPendingQueueItems();
  testGate();

  console.log('\n========================================');
  console.log(`Results: ${passCount}/${testCount} passed, ${failCount} failed`);
  console.log('========================================');

  if (failCount > 0) process.exit(1);
}

main();