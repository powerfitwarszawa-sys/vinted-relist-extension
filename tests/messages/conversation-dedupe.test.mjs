/**
 * Unit tests: conversation dedupe (T3.1/T3.5).
 * Run order: node tests/messages/build.mjs first (bundles the module).
 */

const { dedupeConversations } = await import(
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

function conv(id) {
  return {
    id,
    userId: 'u',
    username: 'n',
    lastMessageBody: '',
    unreadCount: 0,
    scanStatus: 'unknown',
    dataQuality: 'complete',
  };
}

console.log('conversation-dedupe');

// 1. Unique list untouched.
{
  const input = [conv('a'), conv('b'), conv('c')];
  const r = dedupeConversations(input);
  assert(r.conversations.length === 3, 'unique list keeps all entries');
  assert(r.duplicates.length === 0, 'no duplicates reported');
  assert(r.conversations[0].id === 'a' && r.conversations[2].id === 'c', 'order preserved');
}

// 2. Duplicates collapse to the first occurrence.
{
  const first = conv('a');
  first.lastMessageBody = 'first-seen';
  const r = dedupeConversations([first, conv('b'), conv('a'), conv('a'), conv('c')]);
  assert(r.conversations.length === 3, 'duplicates collapse');
  assert(r.conversations[0] === first, 'first occurrence wins (page order stays authoritative)');
  assert(JSON.stringify(r.duplicates) === JSON.stringify(['a']), 'duplicated id reported exactly once');
}

// 3. Empty input.
{
  const r = dedupeConversations([]);
  assert(r.conversations.length === 0 && r.duplicates.length === 0, 'empty input → empty result');
}

// 4. Input never mutated.
{
  const input = [conv('a'), conv('a')];
  const before = JSON.stringify(input);
  dedupeConversations(input);
  assert(JSON.stringify(input) === before, 'input array is not mutated');
}

// 5. Deterministic across runs.
{
  const input = [conv('x'), conv('y'), conv('x'), conv('z'), conv('y')];
  const a = dedupeConversations(input);
  const b = dedupeConversations(input);
  assert(
    JSON.stringify(a.conversations) === JSON.stringify(b.conversations) &&
      JSON.stringify(a.duplicates) === JSON.stringify(b.duplicates),
    'repeated dedupe is deterministic',
  );
}

console.log(`\nconversation-dedupe: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
