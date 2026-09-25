/**
 * Unit tests: conversation normalizer (T3.3/T3.5).
 * Run order: node tests/messages/build.mjs first (bundles the module).
 */

const { normalizeConversation } = await import(
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

const SELF = 'user-self-1';

function richRow(overrides = {}) {
  return {
    id: 4242,
    participant: { id: 'user-b', login: 'alice' },
    unread_count: 2,
    is_archived: false,
    url: '/messages/4242',
    item: { id: 'item-9', title: 'Sneakers', price: '199.99', currency: 'PLN' },
    last_message: {
      body: 'Cześć!',
      created_at: '2026-06-01T10:00:00+02:00',
      sender_id: 'user-b',
    },
    ...overrides,
  };
}

console.log('conversation-normalizer');

// 1. Correct full mapping.
{
  const r = normalizeConversation(richRow(), { selfUserId: SELF });
  assert(r.ok === true, 'rich row normalizes successfully');
  const c = r.conversation;
  assert(c.id === '4242', 'numeric id becomes a stable string id');
  assert(c.userId === 'user-b' && c.username === 'alice', 'participant id/username mapped');
  assert(c.unreadCount === 2, 'unread_count mapped');
  assert(c.lastMessageBody === 'Cześć!', 'last message body mapped');
  assert(c.lastMessageAt === '2026-06-01T08:00:00.000Z', 'date normalized to ISO UTC');
  assert(c.lastMessageFromSelf === false, 'foreign author resolves to false');
  assert(c.itemId === 'item-9' && c.itemTitle === 'Sneakers', 'item id/title mapped');
  assert(c.itemPrice === 199.99 && c.currency === 'PLN', 'price parsed + currency mapped');
  assert(c.conversationUrl === '/messages/4242', 'conversation url preserved');
  assert(c.scanStatus === 'unread', 'unread beats authorship in status priority');
  assert(c.dataQuality === 'complete', 'clean row → dataQuality complete');
  assert(c.replyStatus === undefined, 'scan does not invent a reply lifecycle');
}

// 2. Missing id → dropped, never a row without identity.
{
  const r = normalizeConversation({ participant: { id: 'x', login: 'y' } });
  assert(r.ok === false && r.warning.code === 'missing-id', 'row without id is dropped with missing-id');
}

// 3. Non-object rows.
{
  assert(normalizeConversation(null).ok === false && normalizeConversation(null).warning.code === 'invalid-item', 'null row rejected');
  assert(normalizeConversation('string').ok === false, 'string row rejected');
  assert(normalizeConversation([1, 2]).ok === false, 'array row rejected');
}

// 4. Missing date → kept, flagged, date stays unknown (not "now").
{
  const row = richRow();
  delete row.last_message.created_at;
  const r = normalizeConversation(row, { selfUserId: SELF });
  assert(r.ok === true, 'row with missing date is kept');
  assert(r.conversation.lastMessageAt === undefined, 'missing date → lastMessageAt unknown');
  assert(r.warnings.some((w) => w.code === 'missing-date'), 'missing-date warning emitted');
  assert(r.conversation.dataQuality === 'degraded', 'missing date degrades quality');
}

// 5. Invalid date → same treatment, never parsed to a guess.
{
  const r = normalizeConversation(richRow({ last_message: { body: 'x', created_at: 'not-a-date', sender_id: 'user-b' } }), { selfUserId: SELF });
  assert(r.ok === true && r.conversation.lastMessageAt === undefined, 'invalid date → unknown');
  assert(r.warnings.some((w) => w.code === 'invalid-date'), 'invalid-date warning emitted');
}

// 6. Unknown author → cannot claim replied/awaiting-reply.
{
  const row = richRow();
  row.last_message = { body: 'x', created_at: '2026-06-01T10:00:00Z' }; // no sender
  row.unread_count = 0;
  const r = normalizeConversation(row, { selfUserId: SELF });
  assert(r.ok === true, 'row with unknown author kept');
  assert(r.conversation.lastMessageFromSelf === undefined, 'author stays unknown (tri-state)');
  assert(r.warnings.some((w) => w.code === 'unknown-author'), 'unknown-author warning emitted');
  assert(r.conversation.scanStatus === 'unknown', 'unknown author + no unread → status unknown, NOT replied');
}

// 7. Own vs foreign last message.
{
  const own = normalizeConversation(
    richRow({ unread_count: 0, last_message: { body: 'ok', created_at: '2026-06-01T10:00:00Z', sender_id: SELF } }),
    { selfUserId: SELF },
  );
  assert(own.conversation.lastMessageFromSelf === true, 'own message resolves to true');
  assert(own.conversation.scanStatus === 'replied', 'own last message → replied');

  const foreign = normalizeConversation(
    richRow({ unread_count: 0, last_message: { body: 'q?', created_at: '2026-06-01T10:00:00Z', sender_id: 'user-b' } }),
    { selfUserId: SELF },
  );
  assert(foreign.conversation.lastMessageFromSelf === false, 'their message resolves to false');
  assert(foreign.conversation.scanStatus === 'awaiting-reply', 'their last message, no unread → awaiting-reply');
}

// 8. Unread / archived statuses.
{
  const unread = normalizeConversation(richRow({ unread_count: 1 }), { selfUserId: SELF });
  assert(unread.conversation.scanStatus === 'unread', 'unread flag → unread status');

  const archived = normalizeConversation(richRow({ is_archived: true }), { selfUserId: SELF });
  assert(archived.conversation.scanStatus === 'archived', 'archived wins over unread');

  const noMessages = normalizeConversation(richRow({ unread_count: 0, last_message: undefined }), { selfUserId: SELF });
  assert(noMessages.ok === true, 'conversation without messages is kept');
  assert(noMessages.conversation.scanStatus === 'unknown', 'no messages → unknown, NEVER assumed replied');
}

// 9. No selfUserId configured → author axis cannot resolve.
{
  const r = normalizeConversation(richRow({ unread_count: 0 }));
  assert(r.conversation.lastMessageFromSelf === undefined, 'without selfUserId author stays unknown');
  assert(r.conversation.scanStatus === 'awaiting-reply' || r.conversation.scanStatus === 'unknown', 'status never claims replied without proof');
}

// 10. Unsupported structure (object, known-id, zero recognized fields).
{
  const r = normalizeConversation({ id: 7, weird_field: { nested: true } });
  assert(r.ok === false && r.warning.code === 'unsupported-structure', 'unknown Vinted structure → explicit warning, excluded');
}

// 11. Unknown extra fields are tolerated (forward compatibility).
{
  const r = normalizeConversation(richRow({ brand_new_field: 'future', another: { deep: 1 } }), { selfUserId: SELF });
  assert(r.ok === true && r.conversation.id === '4242', 'unknown extra fields ignored, row still maps');
  assert(r.conversation.dataQuality === 'complete', 'unknown extra fields do not degrade quality');
}

// 12. Partial response: sparse but recognized row → kept + degraded.
{
  const r = normalizeConversation({ id: 'only-id', unread_count: 0 });
  assert(r.ok === true, 'sparse row with id kept');
  assert(r.conversation.dataQuality === 'degraded', 'sparse row → degraded quality');
  assert(r.warnings.length > 0, 'sparse row produces warnings');
  assert(r.conversation.scanStatus === 'unknown', 'sparse row status is unknown');
}

// 13. Determinism: same input → byte-identical output.
{
  const row = richRow();
  const a = normalizeConversation(row, { selfUserId: SELF });
  const b = normalizeConversation(row, { selfUserId: SELF });
  assert(JSON.stringify(a) === JSON.stringify(b), 'normalization is deterministic');
  assert(row.id === 4242 && row.unread_count === 2, 'input row is not mutated');
}

// 14. Aliased shapes (camelCase/positional variants) still map.
{
  const r = normalizeConversation({
    conversation_id: 'c-1',
    user_id: 'u-1',
    username: 'bob',
    unread: true,
    lastMessage: { message: 'hi', createdAt: '2026-01-02T03:04:05Z', senderId: 'u-1' },
  }, { selfUserId: 'u-1' });
  assert(r.ok === true, 'aliased field names map successfully');
  assert(r.conversation.id === 'c-1' && r.conversation.username === 'bob', 'aliases for id/username resolved');
  assert(r.conversation.unreadCount === 1, 'boolean unread flag → count 1');
  assert(r.conversation.lastMessageFromSelf === true && r.conversation.scanStatus === 'unread', 'camelCase sender resolves; unread still priority');
}

console.log(`\nconversation-normalizer: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
