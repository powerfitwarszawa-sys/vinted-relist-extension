import {
  canStartNewRelist,
  canUseVisibleDomFallback,
  hasCompletePhotoUpload,
  resolveVisibleListingStatus,
  shouldReadNextPage,
} from '../dist/core/relist-safety.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

console.log('========================================');
console.log('Relist Safety Tests');
console.log('========================================');

assert(canUseVisibleDomFallback('user-listings'), 'DOM fallback is allowed on the wardrobe page');
assert(!canUseVisibleDomFallback('item-detail'), 'DOM fallback is blocked on an item detail page');
assert(!canUseVisibleDomFallback('other'), 'DOM fallback is blocked on unrelated Vinted pages');

assert(
  resolveVisibleListingStatus(['Ukryte w katalogu', 'Kurtka']) === 'hidden',
  'visible hidden marker maps to hidden seller status',
);
assert(
  resolveVisibleListingStatus(['Kurtka', '40 zł']) === 'active',
  'ordinary visible card maps to active seller status',
);

assert(hasCompletePhotoUpload(3, 3), 'all source photos uploaded is complete');
assert(!hasCompletePhotoUpload(3, 1), 'partial photo upload is rejected');
assert(!hasCompletePhotoUpload(3, 0), 'zero uploaded photos is rejected');

assert(shouldReadNextPage(1, null, 20, 20), 'server page size drives pagination without totals');
assert(!shouldReadNextPage(1, null, 19, 20), 'short page ends pagination without totals');
assert(shouldReadNextPage(1, 2, 3, 20), 'explicit total pages requests the next page');
assert(!shouldReadNextPage(2, 2, 20, 20), 'explicit last page ends pagination');

const idle = { state: 'idle', items: [{ id: '1', status: 'success' }] };
const running = { state: 'running', items: [{ id: '1', status: 'running' }] };
const paused = { state: 'paused', items: [{ id: '1', status: 'paused' }] };
const idlePending = { state: 'idle', items: [{ id: '1', status: 'queued' }] };
assert(canStartNewRelist(idle), 'finished idle queue may be replaced');
assert(!canStartNewRelist(running), 'running queue may not be replaced');
assert(!canStartNewRelist(paused), 'paused queue may not be replaced');
assert(!canStartNewRelist(idlePending), 'idle queue with pending items may not be replaced');

console.log(`Results: ${passed}/${passed + failed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);