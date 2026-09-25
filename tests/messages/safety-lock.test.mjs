/**
 * Unit tests: safety-lock (fail-closed, boundaries, explicit release).
 * Run order: node tests/messages/build.mjs first (bundles the module).
 */

const {
  createSafetyLock,
  isSafetyLockActive,
  canStartMessageOperation,
  releaseSafetyLock,
} = await import('../../node_modules/.cache/vinted-messages/messages.js');

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

const NOW = Date.parse('2026-06-01T12:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();

console.log('========================================');
console.log('Safety Lock Tests');
console.log('========================================');

// 1. createSafetyLock: active lock with ISO timestamps, timed reason keeps until.
{
  const lock = createSafetyLock('captcha', NOW, NOW + 15 * 60_000, { source: 'test' });
  assert(lock.active === true, 'create: lock is active');
  assert(lock.reason === 'captcha', 'create: reason stored');
  assert(lock.createdAt === iso(NOW), 'create: createdAt is ISO');
  assert(lock.unlockAt === iso(NOW + 15 * 60_000), 'create: captcha keeps its until as unlockAt');
  assert(lock.metadata?.source === 'test', 'create: metadata preserved');
}

// 2. Timed reason without until → no auto-release (manual only).
{
  const lock = createSafetyLock('rate-limit', NOW);
  assert(lock.unlockAt === null, 'create: rate-limit without until → unlockAt null');
  assert(isSafetyLockActive(lock, NOW + 365 * 24 * 3600_000) === true, 'create: no until → never auto-releases');
}

// 3. manual with until passed → until dropped (manual never auto-releases).
{
  const lock = createSafetyLock('manual', NOW, NOW + 1000);
  assert(lock.unlockAt === null, 'manual: until is dropped');
  assert(isSafetyLockActive(lock, NOW + 10_000) === true, 'manual: still active after the would-be expiry');
}

// 4. uncertain-operation with until passed → until dropped (never timed out).
{
  const lock = createSafetyLock('uncertain-operation', NOW, NOW + 1000);
  assert(lock.unlockAt === null, 'uncertain: until is dropped');
  assert(isSafetyLockActive(lock, NOW + 10_000) === true, 'uncertain: never auto-released by timeout');
}

// 5. Timed boundary: active before unlockAt, inactive exactly at and after.
{
  const until = NOW + 15 * 60_000;
  const lock = createSafetyLock('captcha', NOW, until);
  assert(isSafetyLockActive(lock, until - 1) === true, 'boundary: active 1 ms before unlockAt');
  assert(isSafetyLockActive(lock, until) === false, 'boundary: inactive exactly at unlockAt');
  assert(isSafetyLockActive(lock, until + 1) === false, 'boundary: inactive 1 ms after unlockAt');
  assert(canStartMessageOperation(lock, until) === true, 'boundary: operation allowed exactly at unlockAt');
  assert(canStartMessageOperation(lock, until - 1) === false, 'boundary: operation blocked 1 ms before unlockAt');
}

// 6. session-expired and consecutive-errors are timed too.
{
  const until = NOW + 60_000;
  assert(
    isSafetyLockActive(createSafetyLock('session-expired', NOW, until), until) === false,
    'session-expired: auto-releases at unlockAt',
  );
  assert(
    isSafetyLockActive(createSafetyLock('consecutive-errors', NOW, until), until) === false,
    'consecutive-errors: auto-releases at unlockAt',
  );
}

// 7. Inactive lock never blocks.
{
  const lock = { ...createSafetyLock('captcha', NOW), active: false };
  assert(isSafetyLockActive(lock, NOW) === false, 'inactive lock: not active');
  assert(canStartMessageOperation(lock, NOW) === true, 'inactive lock: operation allowed');
}

// 8. No lock at all → operation allowed (absence of a lock is not a lock).
{
  assert(canStartMessageOperation(null, NOW) === true, 'null lock: allowed');
  assert(canStartMessageOperation(undefined, NOW) === true, 'undefined lock: allowed');
}

// 9. Active lock always blocks.
{
  const lock = createSafetyLock('captcha', NOW, NOW + HOUR);
  assert(canStartMessageOperation(lock, NOW) === false, 'active lock: operation blocked');
}

// 10. Unknown clock (NaN) on an active timed lock → fail closed (stays active).
{
  const lock = createSafetyLock('captcha', NOW, NOW + 60_000);
  assert(isSafetyLockActive(lock, Number.NaN) === true, 'NaN now: fail-closed (still active)');
}

// 11. Malformed unlockAt on an active lock → fail closed (stays active).
{
  const lock = { ...createSafetyLock('captcha', NOW, NOW + 60_000), unlockAt: 'garbage' };
  assert(isSafetyLockActive(lock, NOW + 10_000_000) === true, 'garbage unlockAt: fail-closed (still active)');
}

// 12. Hand-crafted lock: non-timed reason with unlockAt still never expires.
{
  const lock = { ...createSafetyLock('manual', NOW), unlockAt: iso(NOW - 1000) };
  assert(isSafetyLockActive(lock, NOW + 1) === true, 'manual with stray unlockAt: never auto-releases');
}

// 13. Explicit user release returns a NEW inactive lock.
{
  const lock = createSafetyLock('captcha', NOW, NOW + 60_000);
  const released = releaseSafetyLock(lock, NOW + 1000, 'user');
  assert(released.ok === true, 'user release: ok');
  assert(released.lock.active === false, 'user release: inactive');
  assert(released.lock.releasedBy === 'user' && released.lock.releasedAt === iso(NOW + 1000), 'user release: actor + ISO timestamp');
  assert(lock.active === true, 'purity: original lock untouched');
}

// 14. system cannot release an uncertain-operation lock.
{
  const lock = createSafetyLock('uncertain-operation', NOW);
  const res = releaseSafetyLock(lock, NOW + 1000, 'system');
  assert(res.ok === false && typeof res.error === 'string', 'system + uncertain: refused with an error');
  assert(res.lock.active === true, 'system + uncertain: lock still active');
}

// 15. system cannot release a manual lock either.
{
  const res = releaseSafetyLock(createSafetyLock('manual', NOW), NOW + 1000, 'system');
  assert(res.ok === false && res.lock.active === true, 'system + manual: refused');
}

// 16. system MAY release a timed lock (e.g. captcha window acknowledged).
{
  const res = releaseSafetyLock(createSafetyLock('captcha', NOW, NOW + 60_000), NOW + 1000, 'system');
  assert(res.ok === true && res.lock.active === false && res.lock.releasedBy === 'system', 'system + captcha: released');
}

// 17. Releasing an already inactive lock is idempotent.
{
  const inactive = { ...createSafetyLock('captcha', NOW), active: false };
  const res = releaseSafetyLock(inactive, NOW, 'system');
  assert(res.ok === true && res.lock === inactive, 'idempotent release: ok, same object');
}

// 18. Releasing nothing yields an inactive lock (no crash).
{
  const res = releaseSafetyLock(null, NOW, 'user');
  assert(res.ok === true && res.lock.active === false, 'null release: safe inactive result');
}

// 19. Invalid release clock → refused (fail-closed).
{
  const res = releaseSafetyLock(createSafetyLock('captcha', NOW), Number.NaN, 'user');
  assert(res.ok === false && res.lock.active === true, 'NaN release time: refused, lock untouched');
}

// 20. createSafetyLock with malformed now does not throw and stays valid ISO.
{
  let threw = false;
  let lock;
  try {
    lock = createSafetyLock('captcha', Number.NaN);
  } catch {
    threw = true;
  }
  assert(!threw && lock.createdAt === iso(0), 'malformed create now: no throw, valid ISO fallback');
}

console.log(`Results: ${passed}/${passed + failed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
