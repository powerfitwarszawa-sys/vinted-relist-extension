/**
 * Unit tests: snapshot storage — adapter without Chrome API, atomic
 * complete writes, previous-snapshot preservation, no silent resets,
 * no input mutation (T4A).
 * Run order: node tests/messages/build.mjs first (bundles the module).
 *
 * This file NEVER installs a chrome mock — everything runs through the
 * injectable SnapshotStorageAdapter (memory adapter + spies).
 */

const {
  CONVERSATION_SNAPSHOT_KEY,
  CONVERSATION_SNAPSHOT_SCHEMA_VERSION,
  buildConversationSnapshot,
  saveConversationSnapshot,
  getConversationSnapshot,
  createMemorySnapshotStorage,
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

// The whole point of T4A: no Chrome API anywhere in these tests.
assert(typeof globalThis.chrome === 'undefined', 'adapter testowy bez Chrome API (chrome nie istnieje w tym procesie)');

const SAVED_AT = Date.parse('2026-06-02T10:00:00.000Z');
const SAVED_AT_2 = Date.parse('2026-06-03T11:00:00.000Z');

function conversation(id, overrides = {}) {
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
    ...overrides,
  };
}

function completeResult(overrides = {}) {
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

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

console.log('snapshot-storage (T4A)');

// ── 1. Poprawny zapis i odczyt (memory adapter) ────────────────────
{
  const mem = createMemorySnapshotStorage();
  const save = await saveConversationSnapshot(completeResult(), SAVED_AT, mem);
  assert(save.ok === true, 'save through the memory adapter succeeds');
  const loaded = await getConversationSnapshot(mem);
  assert(loaded !== null, 'read returns a snapshot');
  assert(loaded.scanId === 'scan-1', 'round trip keeps scanId');
  assert(loaded.conversationCount === 2 && loaded.conversations[0].id === 'a', 'round trip keeps rows');
  assert(loaded.savedAt === '2026-06-02T10:00:00.000Z', 'savedAt from the injected timestamp');
}

// ── 2. Wersja schematu na zapisie ──────────────────────────────────
{
  const mem = createMemorySnapshotStorage();
  await saveConversationSnapshot(completeResult(), SAVED_AT, mem);
  const stored = mem.dump()[CONVERSATION_SNAPSHOT_KEY];
  assert(stored.schemaVersion === CONVERSATION_SNAPSHOT_SCHEMA_VERSION, 'stored payload carries schemaVersion 1');
  assert(mem.dump()[CONVERSATION_SNAPSHOT_KEY] !== undefined, 'payload stored under the dedicated key');
}

// ── 3. Domyślny adapter (chrome) fail-closed w środowisku bez Chrome ──
{
  const noChromeSave = await saveConversationSnapshot(completeResult(), SAVED_AT);
  assert(noChromeSave.ok === false, 'default (chrome) save without Chrome API → {ok:false}, no crash');
  const noChromeGet = await getConversationSnapshot();
  assert(noChromeGet === null, 'default (chrome) read without Chrome API → null, no crash');
}

// ── 4. Niekompletny snapshot → odmowa, storage nietknięty ───────────
{
  const mem = createMemorySnapshotStorage();
  const refused = await saveConversationSnapshot(completeResult({ complete: false }), SAVED_AT, mem);
  assert(refused.ok === false, 'incomplete scan → save refused');
  assert(mem.dump()[CONVERSATION_SNAPSHOT_KEY] === undefined, 'refused save writes nothing to a fresh store');
}

// ── 5. Poprzedni snapshot przetrzymuje błąd zapisu ─────────────────
{
  const seedMem = createMemorySnapshotStorage();
  await saveConversationSnapshot(completeResult({ scanId: 'scan-A' }), SAVED_AT, seedMem);
  const before = JSON.stringify(seedMem.dump());

  // (a) failing write transport
  const failing = {
    read: (key) => seedMem.read(key),
    write: () => {
      throw new Error('disk full');
    },
  };
  const failedWrite = await saveConversationSnapshot(completeResult({ scanId: 'scan-B' }), SAVED_AT_2, failing);
  assert(failedWrite.ok === false && failedWrite.error.includes('disk full'), 'storage write failure → {ok:false} with reason');
  assert(JSON.stringify(seedMem.dump()) === before, 'poprzedni snapshot nietknięty po błędzie transportu');

  // (b) incomplete attempt on the same seeded store
  const failedIncomplete = await saveConversationSnapshot(
    completeResult({ scanId: 'scan-C', complete: false }),
    SAVED_AT_2,
    seedMem,
  );
  assert(failedIncomplete.ok === false, 'incomplete attempt → refused');
  assert(JSON.stringify(seedMem.dump()) === before, 'poprzedni snapshot nietknięty po niekompletnym skanie');

  const stillA = await getConversationSnapshot(seedMem);
  assert(stillA !== null && stillA.scanId === 'scan-A', 'odczyt nadal zwraca oryginalny snapshot A');
}

// ── 6. Atomowość: dokładnie jeden zapis, dopiero po kompletności ────
{
  let writeCalls = 0;
  const spyMem = createMemorySnapshotStorage();
  const spy = {
    read: (key) => spyMem.read(key),
    write: (key, value) => {
      writeCalls++;
      return spyMem.write(key, value);
    },
  };

  await saveConversationSnapshot(completeResult({ complete: false }), SAVED_AT, spy);
  assert(writeCalls === 0, 'incomplete result → zero write calls (gate before any I/O)');

  const okSave = await saveConversationSnapshot(completeResult(), SAVED_AT, spy);
  assert(okSave.ok === true && writeCalls === 1, 'complete result → exactly ONE atomic write');
}

// ── 7. Brak cichego resetu: uszkodzony payload nie jest kasowany ───
{
  const mem = createMemorySnapshotStorage();
  await mem.write(CONVERSATION_SNAPSHOT_KEY, 'garbage-not-a-snapshot');
  const beforeCorrupt = JSON.stringify(mem.dump());

  const loaded = await getConversationSnapshot(mem);
  assert(loaded === null, 'corrupt stored payload → null (fail closed)');
  assert(JSON.stringify(mem.dump()) === beforeCorrupt, 'read NEVER clears or rewrites corrupt data');

  await mem.write(CONVERSATION_SNAPSHOT_KEY, { schemaVersion: 999, scanId: 'future', conversations: [] });
  const beforeUnknown = JSON.stringify(mem.dump());
  assert((await getConversationSnapshot(mem)) === null, 'unknown schema version → null');
  assert(JSON.stringify(mem.dump()) === beforeUnknown, 'unknown version is left untouched, not reset');

  const emptyMem = createMemorySnapshotStorage();
  assert((await getConversationSnapshot(emptyMem)) === null, 'empty store → null (missing ≠ corrupt ≠ reset)');
}

// ── 8. Pusty snapshot zapisuje się i odczytuje ─────────────────────
{
  const mem = createMemorySnapshotStorage();
  const save = await saveConversationSnapshot(completeResult({ conversations: [] }), SAVED_AT, mem);
  assert(save.ok === true, 'empty (complete) snapshot saves');
  const loaded = await getConversationSnapshot(mem);
  assert(loaded !== null && loaded.conversationCount === 0, 'empty snapshot reads back with count 0');
}

// ── 9. Brak mutacji danych wejściowych ─────────────────────────────
{
  const mem = createMemorySnapshotStorage();
  const frozen = deepFreeze(completeResult());
  const before = JSON.stringify(frozen);
  const save = await saveConversationSnapshot(frozen, SAVED_AT, mem);
  assert(save.ok === true, 'saving a deep-frozen result succeeds (writes never mutate it)');
  assert(JSON.stringify(frozen) === before, 'wynik wejściowy byte-identyczny po zapisie');

  // And the store is a deep copy: mutating the caller's object afterwards
  // must not leak into stored/read data.
  const mutable = completeResult({ scanId: 'scan-mutable' });
  await saveConversationSnapshot(mutable, SAVED_AT, mem);
  mutable.conversations.push(conversation('injected'));
  mutable.scanId = 'mutated-after-save';
  const loaded = await getConversationSnapshot(mem);
  assert(loaded.scanId === 'scan-mutable' && loaded.conversationCount === 2, 'store is decoupled from later caller mutations');
}

// ── 10. Adapter bez Chrome trzyma dane tylko lokalnie ──────────────
{
  const mem = createMemorySnapshotStorage();
  await saveConversationSnapshot(completeResult(), SAVED_AT, mem);
  assert(Object.keys(mem.dump()).length === 1, 'memory adapter holds exactly the snapshot key');
  assert(typeof globalThis.chrome === 'undefined', 'chrome API nadal nie istnieje po testach');
}

console.log(`\nsnapshot-storage (T4A): ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
