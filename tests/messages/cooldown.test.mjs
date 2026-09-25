/**
 * Unit tests: cooldown gate (fail-closed, time injected as nowMs).
 * Run order: node tests/messages/build.mjs first (bundles the module).
 */

const { evaluateMessageCooldown } = await import(
  '../../node_modules/.cache/vinted-messages/messages.js'
);

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

const HOUR = 3_600_000;
const DAY = 86_400_000;
// Fixed clock — no test reads the system time.
const NOW = Date.parse('2026-06-01T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

const SETTINGS = {
  mode: 'manual',
  conversationCooldownMinutes: 30,
  userCooldownMinutes: 120,
  maxMessagesPerHour: 6,
  maxMessagesPerDay: 30,
  randomDelayMinSeconds: 20,
  randomDelayMaxSeconds: 90,
  stopOnCaptcha: true,
  stopAfterConsecutiveErrors: 3,
};

function entry(overrides = {}) {
  return {
    id: 'h-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    bodyPreview: 'Hello',
    bodyHash: 'hash-1',
    renderedAt: iso(NOW - HOUR),
    status: 'sent',
    mode: 'manual',
    sentAt: iso(NOW - 2 * HOUR),
    ...overrides,
  };
}

function evaluate(overrides = {}) {
  const { history, settings, ...rest } = overrides;
  return evaluateMessageCooldown({
    nowMs: NOW,
    conversationId: 'conv-1',
    userId: 'user-1',
    bodyHash: 'hash-new',
    settings: { ...SETTINGS, ...(settings ?? {}) },
    history: history ?? [],
    ...rest,
  });
}

console.log('========================================');
console.log('Cooldown Gate Tests');
console.log('========================================');

// 1. Empty history → allowed.
{
  const r = evaluate();
  assert(r.allowed === true && r.code === 'ok', 'empty history: allowed');
}

// 2. Failed entries are not sends: they never block or count.
{
  const r = evaluate({ history: [entry({ status: 'failed', sentAt: undefined })] });
  assert(r.allowed === true && r.code === 'ok', 'failed entries: ignored (not sends)');
}

// 3. In-flight reservation blocks.
{
  const r = evaluate({ history: [entry({ status: 'reserved', sentAt: undefined })] });
  assert(r.allowed === false && r.code === 'in-flight', 'reserved entry: blocks with in-flight');
}

// 4. Uncertain blocks and demands manual verification.
{
  const r = evaluate({ history: [entry({ status: 'uncertain', sentAt: undefined })] });
  assert(
    r.allowed === false && r.code === 'uncertain-verification-required' && r.retryAtMs === undefined,
    'uncertain entry: blocks without auto-retry',
  );
}

// 5. Priority: in-flight wins over uncertain.
{
  const r = evaluate({
    history: [entry({ status: 'reserved' }), entry({ id: 'h-2', status: 'uncertain' })],
  });
  assert(r.code === 'in-flight', 'priority: in-flight reported before uncertain');
}

// 6. Duplicate: identical body already sent in this conversation.
{
  const r = evaluate({ bodyHash: 'hash-1', history: [entry({ status: 'sent', sentAt: iso(NOW - 5 * HOUR) })] });
  assert(r.allowed === false && r.code === 'duplicate-content', 'duplicate: same hash sent → blocked');
}

// 7. Same hash in ANOTHER conversation does not block.
{
  const r = evaluate({
    bodyHash: 'hash-1',
    history: [entry({ conversationId: 'other-conv', userId: 'other-user', sentAt: iso(NOW - 5 * HOUR) })],
  });
  assert(r.allowed === true && r.code === 'ok', 'duplicate scope: other conversation does not block');
}

// 8. Failed identical body does not block a retry.
{
  const r = evaluate({ bodyHash: 'hash-1', history: [entry({ status: 'failed', sentAt: undefined })] });
  assert(r.allowed === true, 'duplicate scope: failed send allows resending the same content');
}

// 9. Hourly limit: 6 sends inside the hour → blocked, retryAt = oldest + 1 h.
{
  const history = [];
  for (let i = 0; i < 6; i++) {
    history.push(
      entry({
        id: `h-${i}`,
        conversationId: `c-${i}`,
        userId: `u-${i}`,
        sentAt: iso(NOW - 10 * 60_000 - i * 60_000), // 10..15 min ago
      }),
    );
  }
  const r = evaluate({ history });
  const oldest = NOW - 10 * 60_000 - 5 * 60_000;
  assert(r.allowed === false && r.code === 'hourly-limit', 'hourly: 6 sends in window → blocked');
  assert(r.retryAtMs === oldest + HOUR, 'hourly: retryAt = oldest in-window send + 1 h');
}

// 10. Hourly boundary: a send exactly 1 h old is out of the window.
{
  const history = [];
  for (let i = 0; i < 5; i++) {
    history.push(entry({ id: `h-${i}`, conversationId: `c-${i}`, userId: `u-${i}`, sentAt: iso(NOW - 30 * 60_000) }));
  }
  history.push(entry({ id: 'h-old', conversationId: 'c-old', userId: 'u-old', sentAt: iso(NOW - HOUR) }));
  const r = evaluate({ history });
  assert(r.allowed === true && r.code === 'ok', 'hourly boundary: entry exactly 1 h old left the window');
}

// 11. Daily limit: 30 sends in 24 h (all older than 1 h) → blocked.
{
  const history = [];
  for (let i = 0; i < 30; i++) {
    history.push(
      entry({ id: `h-${i}`, conversationId: `c-${i}`, userId: `u-${i}`, sentAt: iso(NOW - 2 * HOUR - i * 30 * 60_000) }),
    );
  }
  const r = evaluate({ history });
  assert(r.allowed === false && r.code === 'daily-limit', 'daily: 30 sends in 24 h → blocked');
}

// 12. Daily boundary: a send exactly 24 h old is out of the window.
{
  const history = [];
  for (let i = 0; i < 29; i++) {
    history.push(entry({ id: `h-${i}`, conversationId: `c-${i}`, userId: `u-${i}`, sentAt: iso(NOW - 2 * HOUR) }));
  }
  history.push(entry({ id: 'h-old', conversationId: 'c-old', userId: 'u-old', sentAt: iso(NOW - DAY) }));
  const r = evaluate({ history });
  assert(r.allowed === true && r.code === 'ok', 'daily boundary: entry exactly 24 h old left the window');
}

// 13. Conversation cooldown: 10 min ago < 30 min → blocked with retryAt.
{
  const r = evaluate({ history: [entry({ sentAt: iso(NOW - 10 * 60_000) })] });
  assert(r.allowed === false && r.code === 'conversation-cooldown', 'conversation cooldown: recent send blocks');
  assert(r.retryAtMs === NOW - 10 * 60_000 + 30 * 60_000, 'conversation cooldown: retryAt = lastSent + 30 min');
}

// 14. Conversation cooldown boundary: exactly 30 min → allowed.
{
  // userCooldown disabled so only the conversation window is under test.
  const r = evaluate({
    settings: { userCooldownMinutes: 0 },
    history: [entry({ sentAt: iso(NOW - 30 * 60_000) })],
  });
  assert(r.allowed === true && r.code === 'ok', 'conversation cooldown boundary: exactly at the limit → allowed');
}

// 15. Conversation cooldown boundary: 1 s inside → blocked.
{
  const r = evaluate({ history: [entry({ sentAt: iso(NOW - 30 * 60_000 + 1000) })] });
  assert(r.allowed === false && r.code === 'conversation-cooldown', 'conversation cooldown boundary: 1 s inside → blocked');
}

// 16. User cooldown across conversations: 60 min ago < 120 min → blocked.
{
  const r = evaluate({
    conversationId: 'conv-2',
    history: [entry({ conversationId: 'conv-1', sentAt: iso(NOW - 60 * 60_000) })],
  });
  assert(r.allowed === false && r.code === 'user-cooldown', 'user cooldown: earlier send in another thread blocks');
  assert(r.retryAtMs === NOW - 60 * 60_000 + 120 * 60_000, 'user cooldown: retryAt = lastUserSend + 120 min');
}

// 17. User cooldown boundary: exactly 120 min → allowed.
{
  const r = evaluate({
    conversationId: 'conv-2',
    history: [entry({ conversationId: 'conv-1', sentAt: iso(NOW - 120 * 60_000) })],
  });
  assert(r.allowed === true && r.code === 'ok', 'user cooldown boundary: exactly at the limit → allowed');
}

// 18. Zero conversation cooldown → immediate reply allowed (equality holds).
{
  const r = evaluate({
    settings: { conversationCooldownMinutes: 0, userCooldownMinutes: 0 },
    history: [entry({ sentAt: iso(NOW - 1000) })],
  });
  assert(r.allowed === true && r.code === 'ok', 'zero cooldowns: explicit 0 minutes allows immediate reply');
}

// 19. Fail-closed: NaN conversation cooldown blocks a conversation with history.
{
  const r = evaluate({
    settings: { conversationCooldownMinutes: Number.NaN },
    history: [entry({ sentAt: iso(NOW - 10 * HOUR) })],
  });
  assert(r.allowed === false && r.code === 'conversation-cooldown', 'invalid cooldown setting: fails closed');
}

// 20. Fail-closed: NaN hourly limit → zero capacity, blocked even with no history.
{
  const r = evaluate({ settings: { maxMessagesPerHour: Number.NaN } });
  assert(r.allowed === false && r.code === 'hourly-limit', 'invalid hourly limit: fails closed (0 capacity)');
}

// 21. Fail-closed: NaN nowMs → blocked, reason mentions the clock.
{
  const r = evaluate({ nowMs: Number.NaN });
  assert(
    r.allowed === false && /clock/i.test(r.reason),
    'invalid nowMs: fails closed with an explicit clock reason',
  );
}

// 22. Fail-closed: sent entry without a timestamp → conversation blocked (unknown time).
{
  const r = evaluate({ history: [entry({ sentAt: undefined })] });
  assert(
    r.allowed === false && r.code === 'conversation-cooldown' && /unknown/i.test(r.reason),
    'missing sentAt: fail-closed until verified manually',
  );
}

// 23. Fail-closed: corrupt ISO timestamp → same treatment as missing.
{
  const r = evaluate({ history: [entry({ sentAt: 'not-a-date' })] });
  assert(r.allowed === false && /unknown/i.test(r.reason), 'corrupt sentAt: fail-closed');
}

// 24. Future-dated send blocks until its cooldown passes.
{
  const r = evaluate({ history: [entry({ sentAt: iso(NOW + HOUR) })] });
  assert(r.allowed === false && r.code === 'conversation-cooldown', 'future sentAt: blocked (clock skew is suspicious)');
}

// 25. Priority: hourly limit reported before conversation cooldown.
{
  const history = [];
  for (let i = 0; i < 6; i++) {
    history.push(entry({ id: `h-${i}`, conversationId: `c-${i}`, userId: `u-${i}`, sentAt: iso(NOW - 5 * 60_000) }));
  }
  history.push(entry({ id: 'conv-sent', conversationId: 'conv-1', userId: 'user-1', sentAt: iso(NOW - 5 * 60_000) }));
  const r = evaluate({ history });
  assert(r.code === 'hourly-limit', 'priority: hourly limit wins over conversation cooldown');
}

// 26. Inputs are never mutated.
{
  const history = [entry({ sentAt: iso(NOW - 5 * HOUR) })];
  const settings = { ...SETTINGS };
  const before = JSON.stringify({ history, settings });
  evaluateMessageCooldown({
    nowMs: NOW,
    conversationId: 'conv-1',
    userId: 'user-1',
    bodyHash: 'hash-1',
    settings,
    history,
  });
  assert(JSON.stringify({ history, settings }) === before, 'purity: history and settings untouched');
}

// 27. Non-array history fails closed instead of crashing.
{
  const r = evaluateMessageCooldown({
    nowMs: NOW,
    conversationId: 'conv-1',
    userId: 'user-1',
    bodyHash: 'x',
    settings: SETTINGS,
    history: /** @type {any} */ (undefined),
  });
  assert(r.allowed === true && r.code === 'ok', 'non-array history treated as empty (no crash)');
}

console.log(`Results: ${passed}/${passed + failed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
