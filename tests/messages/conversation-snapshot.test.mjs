/**
 * Unit tests: conversation snapshot (T3.4/T3.5) — persistence rules,
 * fail-closed reads, fingerprint determinism.
 * Run order: node tests/messages/build.mjs first (bundles the module).
 *
 * chrome.storage.local is mocked on globalThis; when absent the modules
 * must fail closed (no crash, no write).
 */

const {
  CONVERSATION_SNAPSHOT_KEY,
  CONVERSATION_SNAPSHOT_SCHEMA_VERSION,
  fingerprintConversations,
  buildConversationSnapshot,
  saveConversationSnapshot,
  getConversationSnapshot,
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

const SAVED_AT = Date.parse('2026-06-02T10:00:00.000Z');

function conversation(id) {
  return {
    id,
    userId: `u-${id}`,
    username: `user-${id}`,
    lastMessageBody: `msg-${id}`,
    lastMessageAt: '2026-06-01T10:00:00.000Z',
    lastMessageFromSelf: false,
    unreadCount: 1,
    scanStatus: 'unread',
    dataQuality: 'complete',
  };
}

function result(overrides = {}) {
  return {
    scanId: 'scan-1',
    startedAt: '2026-06-02T09:00:00.000Z',
    finishedAt: '2026-06-02T09:00:01.000Z',
    source: 'read-only-api',
    conversations: [conversation('a'), conversation('b')],
    warnings: [],
    hasMore: false,
    complete: true,
    ...overrides,
  };
}

console.log('conversation-snapshot');

// 1. No chrome storage → fail closed on both directions.
{
  delete globalThis.chrome;
  const save = await saveConversationSnapshot(result(), SAVED_AT);
  assert(save.ok === false, 'save without chrome.storage refuses (ok:false)');
  const loaded = await getConversationSnapshot();
  assert(loaded === null, 'load without chrome.storage → null (never a crash)');
}

// 2. Build: full field set from a complete result.
{
  const snapshot = buildConversationSnapshot(result(), SAVED_AT);
  assert(snapshot.schemaVersion === CONVERSATION_SNAPSHOT_SCHEMA_VERSION, 'schema version stamped');
  assert(snapshot.scanId === 'scan-1', 'scanId carried');
  assert(snapshot.savedAt === '2026-06-02T10:00:00.000Z', 'savedAt from the injected timestamp');
  assert(snapshot.conversationCount === 2, 'conversation count recorded');
  assert(snapshot.hasMore === false && snapshot.nextCursor === undefined, 'pagination state recorded');
  assert(Array.isArray(snapshot.warnings) && snapshot.warnings.length === 0, 'warnings recorded');
  assert(typeof snapshot.fingerprint === 'string' && snapshot.fingerprint.length >= 8, 'fingerprint computed');
  assert(snapshot.conversations[0].id === 'a', 'conversations embedded');
}

// 3. Incomplete result → build throws, save refuses, storage untouched.
{
  const incomplete = result({ complete: false, warnings: [{ code: 'session-expired', message: 'x' }] });
  let threw = false;
  try {
    buildConversationSnapshot(incomplete, SAVED_AT);
  } catch {
    threw = true;
  }
  assert(threw, 'buildConversationSnapshot throws for an incomplete scan');
}

// 4. Round trip through mocked storage + no overwrite of a stored snapshot
//    by an unsuccessful scan (T3.5: "niezmieniania istniejącego snapshotu").
{
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: store[key] }),
        set: async (values) => Object.assign(store, values),
      },
    },
  };

  const first = await saveConversationSnapshot(result(), SAVED_AT);
  assert(first.ok === true, 'complete scan saves successfully');
  const storedAfterFirst = JSON.stringify(store[CONVERSATION_SNAPSHOT_KEY]);

  // Failed/incomplete scan attempts to save…
  const bad = await saveConversationSnapshot(
    result({ complete: false, scanId: 'scan-failed', conversations: [conversation('z')] }),
    SAVED_AT,
  );
  assert(bad.ok === false, 'incomplete scan refuses to save');
  assert(
    JSON.stringify(store[CONVERSATION_SNAPSHOT_KEY]) === storedAfterFirst,
    'existing snapshot is byte-identical after a failed scan',
  );

  const loaded = await getConversationSnapshot();
  assert(loaded !== null && loaded.scanId === 'scan-1', 'round trip returns the stored snapshot');
  assert(loaded.conversationCount === 2, 'stored count intact');

  // Corrupt/foreign schema → null (fail-closed read).
  store[CONVERSATION_SNAPSHOT_KEY] = { schemaVersion: 999, scanId: 'x', conversations: [] };
  assert((await getConversationSnapshot()) === null, 'foreign schema version → null');
  store[CONVERSATION_SNAPSHOT_KEY] = { schemaVersion: CONVERSATION_SNAPSHOT_SCHEMA_VERSION };
  assert((await getConversationSnapshot()) === null, 'incomplete stored object → null');
  store[CONVERSATION_SNAPSHOT_KEY] = 'garbage';
  assert((await getConversationSnapshot()) === null, 'non-object stored value → null');
}

// 5. Fingerprint: deterministic, order/content sensitive.
{
  const a = fingerprintConversations([conversation('a'), conversation('b')], 'read-only-api');
  const b = fingerprintConversations([conversation('a'), conversation('b')], 'read-only-api');
  assert(a === b, 'same data → same fingerprint');

  const changed = fingerprintConversations([conversation('a'), conversation('c')], 'read-only-api');
  assert(changed !== a, 'different data → different fingerprint');

  const reordered = fingerprintConversations([conversation('b'), conversation('a')], 'read-only-api');
  assert(reordered !== a, 'row order is part of the fingerprint');

  const otherSource = fingerprintConversations([conversation('a'), conversation('b')], 'dom');
  assert(otherSource !== a, 'scan source is part of the fingerprint');
}

// 6. Stored schemaVersion mirrors the module constant.
{
  assert(CONVERSATION_SNAPSHOT_KEY === 'vbr:messages:conversation-snapshot', 'dedicated storage key (independent of relist keys)');
}

console.log(`\nconversation-snapshot: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
