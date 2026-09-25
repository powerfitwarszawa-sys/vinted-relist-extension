/**
 * Unit tests: snapshot schema — versioning, read validation, legacy
 * migration, fail-closed unknown versions (T4A).
 * Run order: node tests/messages/build.mjs first (bundles the module).
 */

const {
  CONVERSATION_SNAPSHOT_SCHEMA_VERSION,
  buildConversationSnapshot,
  fingerprintConversations,
  validateStoredSnapshot,
  migrateStoredSnapshot,
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

// Baseline: a payload produced by the real builder — the source of every
// "valid" expectation below.
const VALID = buildConversationSnapshot(completeResult(), SAVED_AT);
const clone = () => JSON.parse(JSON.stringify(VALID));

console.log('snapshot-schema (T4A)');

// ── 1. Wersja schematu ─────────────────────────────────────────────
assert(CONVERSATION_SNAPSHOT_SCHEMA_VERSION === 1, 'current schema version is 1');
assert(VALID.schemaVersion === 1, 'builder stamps the current version');

// ── 2. Walidacja danych ────────────────────────────────────────────
{
  const ok = validateStoredSnapshot(clone());
  assert(ok !== null, 'builder payload validates');
  assert(ok.scanId === 'scan-1' && ok.conversationCount === 2, 'validated payload keeps its data');
  assert(fingerprintConversations(ok.conversations, ok.source) === ok.fingerprint, 'fingerprint consistent with rows');

  const input = clone();
  const out = validateStoredSnapshot(input);
  assert(out !== input, 'validation returns a fresh object (no aliasing of the payload)');
  assert(JSON.stringify(input) === JSON.stringify(clone()), 'validation does not mutate its input');

  const junk = clone();
  junk.unknown_top_level_junk = { hack: true };
  const outJunk = validateStoredSnapshot(junk);
  assert(outJunk !== null && !('unknown_top_level_junk' in outJunk), 'unknown top-level keys are dropped, not rejected');
}

// ── 3. Uszkodzony payload → null ───────────────────────────────────
{
  const cases = [
    ['string', 'garbage'],
    ['number', 42],
    ['null', null],
    ['undefined', undefined],
    ['array', [1, 2]],
    ['boolean', true],
    ['empty object', {}],
    ['version only', { schemaVersion: 1 }],
    ['missing scanId', { ...clone(), scanId: '' }],
    ['bad startedAt', { ...clone(), startedAt: 'not-a-date' }],
    ['bad savedAt', { ...clone(), savedAt: 12345 }],
    ['bad source', { ...clone(), source: 'ftp' }],
    ['count mismatch', { ...clone(), conversationCount: 5 }],
    ['hasMore not boolean', { ...clone(), hasMore: 'yes' }],
    ['warnings not array', { ...clone(), warnings: 'x' }],
    ['warning entry broken', { ...clone(), warnings: [{ code: 'x' }] }],
    ['empty warning code', { ...clone(), warnings: [{ code: ' ', message: 'm' }] }],
    ['conversations not array', { ...clone(), conversations: 'nope' }],
    ['row without id', { ...clone(), conversations: [{ ...conversation('a'), id: '' }] }],
    ['row bad scanStatus', { ...clone(), conversations: [{ ...conversation('a'), scanStatus: 'maybe' }] }],
    ['row negative unread', { ...clone(), conversations: [{ ...conversation('a'), unreadCount: -1 }] }],
    ['row bad dataQuality', { ...clone(), conversations: [{ ...conversation('a'), dataQuality: 'perfect' }] }],
    ['row unreadCount NaN', { ...clone(), conversations: [{ ...conversation('a'), unreadCount: NaN }] }],
    ['empty nextCursor', { ...clone(), nextCursor: '' }],
  ];
  for (const [label, payload] of cases) {
    assert(validateStoredSnapshot(payload) === null, `corrupt (${label}) → null`);
  }
}

// ── 4. Fingerprint wykrywa podmianę danych ─────────────────────────
{
  const tampered = clone();
  tampered.conversations[0].lastMessageBody = 'injected text';
  assert(validateStoredSnapshot(tampered) === null, 'row edited after fingerprinting → rejected');
}

// ── 5. Fail-closed dla nieznanej wersji schematu ───────────────────
{
  const unknownVersions = [999, 2, -1, 1.5, '1', true, '', 0.001];
  for (const version of unknownVersions) {
    const payload = { ...clone(), schemaVersion: version };
    assert(migrateStoredSnapshot(payload) === null, `unknown schemaVersion ${JSON.stringify(version)} → null (fail closed)`);
    assert(validateStoredSnapshot(payload) === null, `validate rejects schemaVersion ${JSON.stringify(version)}`);
  }
}

// ── 6. Migracja: legacy bez wersji → v1 ────────────────────────────
function legacySnapshot(overrides = {}, conversationOverrides = {}) {
  return {
    // no schemaVersion (legacy/unversioned)
    scanId: 'legacy-scan',
    startedAt: '2026-05-01T08:00:00.000Z',
    finishedAt: '2026-05-01T08:00:05.000Z',
    source: 'read-only-api',
    conversationCount: 999, // stale legacy claim — must NOT be trusted
    fingerprint: 'bogus-legacy-fingerprint',
    warnings: 'not-an-array', // tolerated → []
    conversations: [
      {
        id: 'c1',
        userId: 'u1',
        username: 'n1',
        lastMessageBody: 'hi',
        unreadCount: 2,
        scanStatus: 'replied',
        dataQuality: 'complete',
        lastMessageAt: '2026-05-01T07:00:00.000Z',
        lastMessageFromSelf: true,
        ...conversationOverrides,
      },
      { id: 'c2' }, // minimal row — everything must be filled honestly
    ],
    ...overrides,
  };
}

{
  const migrated = migrateStoredSnapshot(legacySnapshot());
  assert(migrated !== null, 'legacy unversioned payload migrates');
  assert(migrated.schemaVersion === 1, 'migration stamps current version');
  assert(migrated.conversationCount === 2, 'stale count claim (999) recomputed from actual rows');
  assert(
    migrated.fingerprint === fingerprintConversations(migrated.conversations, migrated.source),
    'legacy fingerprint replaced by a recomputed one',
  );
  assert(Array.isArray(migrated.warnings) && migrated.warnings.length === 0, 'invalid legacy warnings → []');
  assert(migrated.savedAt === '2026-05-01T08:00:05.000Z', 'savedAt falls back to finishedAt (explicit timestamp, never now)');

  const [c1, c2] = migrated.conversations;
  assert(c1.dataQuality === 'complete' && c1.scanStatus === 'replied', 'complete legacy row with no fills keeps its valid claims');
  assert(c2.userId === '' && c2.username === '' && c2.lastMessageBody === '', 'missing legacy fields → empty strings (not invented)');
  assert(c2.unreadCount === 0, 'missing unreadCount → 0');
  assert(c2.scanStatus === 'unknown', 'missing scanStatus → unknown (NOT replied)');
  assert(c2.dataQuality === 'unknown', 'legacy row without any quality claim → unknown');

  assert(validateStoredSnapshot(migrated) !== null, 'migrated payload passes strict v1 validation');
}

{
  const explicitZero = migrateStoredSnapshot({ ...legacySnapshot(), schemaVersion: 0 });
  assert(explicitZero !== null && explicitZero.schemaVersion === 1, 'explicit schemaVersion 0 migrates like unversioned');
}

// ── 7. Migracja odmawia zamiast zgadywać/resetować ─────────────────
{
  assert(migrateStoredSnapshot(legacySnapshot({ scanId: undefined })) === null, 'legacy without scanId → null');
  assert(migrateStoredSnapshot(legacySnapshot({ source: 'carrier-pigeon' })) === null, 'legacy with unknown source → null');
  assert(migrateStoredSnapshot(legacySnapshot({ startedAt: 'yesterday-ish' })) === null, 'legacy with bad timestamp → null');
  assert(migrateStoredSnapshot(legacySnapshot({ conversations: 'x' })) === null, 'legacy without rows array → null');

  const brokenRow = legacySnapshot({}, { id: '' });
  assert(migrateStoredSnapshot(brokenRow) === null, 'legacy row without id → whole migration rejected (no silent row dropping)');

  const missingRow = legacySnapshot();
  missingRow.conversations[1] = { not: 'a conversation' };
  assert(migrateStoredSnapshot(missingRow) === null, 'unmigratable row → whole migration rejected');

  assert(migrateStoredSnapshot('junk') === null, 'non-object payload → null (no crash)');
}

// ── 8. Pusty snapshot ──────────────────────────────────────────────
{
  const empty = buildConversationSnapshot(completeResult({ conversations: [] }), SAVED_AT);
  assert(validateStoredSnapshot(empty) !== null, 'empty (0 conversations) snapshot is valid');
  assert(empty.conversationCount === 0, 'empty snapshot count is 0');

  const legacyEmpty = legacySnapshot();
  legacyEmpty.conversations = [];
  const migratedEmpty = migrateStoredSnapshot(legacyEmpty);
  assert(migratedEmpty !== null && migratedEmpty.conversationCount === 0, 'legacy empty snapshot migrates (empty ≠ corrupt)');
}

console.log(`\nsnapshot-schema (T4A): ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
