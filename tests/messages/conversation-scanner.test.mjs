/**
 * Unit tests: conversation scanner (T3.1/T3.5) — pagination, failure
 * classification, dedupe across pages, determinism.
 * Run order: node tests/messages/build.mjs first (bundles the module).
 */

const { scanConversations, ConversationScanError } = await import(
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

const SELF = 'self-1';
const FIXED_NOW = Date.parse('2026-06-02T09:00:00.000Z');
const NOW = () => FIXED_NOW;
const IDS = () => 'scan-fixed-1';

function row(id, extra = {}) {
  return {
    id,
    participant: { id: `u-${id}`, login: `user-${id}` },
    unread_count: 1,
    last_message: { body: `msg-${id}`, created_at: '2026-06-01T10:00:00Z', sender_id: `u-${id}` },
    ...extra,
  };
}

/** Data source over a fixed list of pages. */
function source(pages, kind = 'read-only-api') {
  return {
    kind,
    async fetchPage(cursor) {
      const pageIndex = cursor === undefined ? 0 : Number(cursor);
      const page = pages[pageIndex];
      if (page instanceof Error) throw page;
      return page;
    },
  };
}

const BASE = { selfUserId: SELF, makeScanId: IDS, now: NOW };

console.log('conversation-scanner');

// 1. Single complete page.
{
  const r = await scanConversations(source([{ raw: [row('1'), row('2')], hasMore: false }]), BASE);
  assert(r.scanId === 'scan-fixed-1', 'injected scan id used');
  assert(r.startedAt === '2026-06-02T09:00:00.000Z' && r.finishedAt === r.startedAt, 'timestamps come from the injected clock');
  assert(r.source === 'read-only-api', 'source kind propagated');
  assert(r.conversations.length === 2, 'rows normalized into conversations');
  assert(r.complete === true, 'clean scan → complete');
  assert(r.hasMore === false && r.nextCursor === undefined, 'final page → no cursor');
  assert(r.conversations[0].dataQuality === 'complete', 'clean rows carry complete quality');
}

// 2. Pagination across three pages with cursor advance.
{
  const pages = [
    { raw: [row('1')], hasMore: true, nextCursor: '1' },
    { raw: [row('2')], hasMore: true, nextCursor: '2' },
    { raw: [row('3')], hasMore: false },
  ];
  const seenCursors = [];
  const tracking = {
    kind: 'read-only-api',
    async fetchPage(cursor) {
      seenCursors.push(cursor);
      return pages[Number(cursor ?? 0)];
    },
  };
  const r = await scanConversations(tracking, BASE);
  assert(seenCursors.length === 3 && seenCursors[0] === undefined && seenCursors[1] === '1' && seenCursors[2] === '2', 'cursor chain followed exactly once per page');
  assert(r.conversations.length === 3 && r.complete === true, 'all pages collected, scan complete');
  assert(r.hasMore === false, 'end of pagination → hasMore false');
}

// 3. Page cap with resume cursor.
{
  const pages = [
    { raw: [row('1')], hasMore: true, nextCursor: '1' },
    { raw: [row('2')], hasMore: true, nextCursor: '2' },
    { raw: [row('3')], hasMore: true, nextCursor: '3' },
  ];
  const r = await scanConversations(source(pages), { ...BASE, maxPages: 2 });
  assert(r.conversations.length === 2, 'page cap respected');
  assert(r.complete === true, 'page cap is not a failure');
  assert(r.hasMore === true && r.nextCursor === '2', 'resume cursor returned');
  assert(r.warnings.some((w) => w.code === 'max-pages-reached'), 'max-pages-reached warning emitted');
}

// 4. Cursor loop guard.
{
  const looping = {
    kind: 'read-only-api',
    async fetchPage() {
      return { raw: [row('1')], hasMore: true, nextCursor: 'same' };
    },
  };
  const r = await scanConversations(looping, BASE);
  assert(r.complete === true, 'loop guard stops without marking the scan failed');
  assert(r.warnings.some((w) => w.code === 'pagination-loop'), 'pagination-loop warning emitted');
}

// 5. More data but no cursor.
{
  const r = await scanConversations(source([{ raw: [row('1')], hasMore: true }]), BASE);
  assert(r.warnings.some((w) => w.code === 'missing-cursor'), 'missing-cursor warning emitted');
  assert(r.complete === true, 'missing cursor is a truncation, not a failure');
}

// 6. Duplicates across pages.
{
  const pages = [
    { raw: [row('dup'), row('a')], hasMore: true, nextCursor: '1' },
    { raw: [row('dup'), row('b')], hasMore: false },
  ];
  const r = await scanConversations(source(pages), BASE);
  assert(r.conversations.length === 3, 'cross-page duplicates collapse (4 rows → 3 unique)');
  assert(r.warnings.some((w) => w.code === 'duplicate-item' && w.itemId === 'dup'), 'duplicate reported with its id');
  assert(r.conversations[0].id === 'dup', 'first occurrence wins');
}

// 7. Page fetch failure → fail closed, earlier rows kept.
{
  const pages = [
    { raw: [row('1')], hasMore: true, nextCursor: '1' },
    new Error('network down'),
  ];
  const r = await scanConversations(source(pages), BASE);
  assert(r.complete === false, 'mid-scan failure → complete false');
  assert(r.conversations.length === 1, 'rows collected before the failure are kept for diagnostics');
  assert(r.warnings.some((w) => w.code === 'page-fetch-failed'), 'generic failure → page-fetch-failed warning');
}

// 8. Session failure → classified, fail closed, no retry.
{
  let calls = 0;
  const src = {
    kind: 'read-only-api',
    async fetchPage() {
      calls++;
      throw new ConversationScanError('session-expired', 'Conversation listing failed (session-expired).');
    },
  };
  const r = await scanConversations(src, BASE);
  assert(r.complete === false, 'session error → complete false');
  assert(r.warnings.some((w) => w.code === 'session-expired'), 'session-expired warning emitted');
  assert(calls === 1, 'no retry after a session failure');
}

// 9. Plain errors classified by message (401/429/captcha).
{
  const cases = [
    [new Error('Request failed with 401'), 'session-expired'],
    [new Error('Request failed with 403'), 'session-expired'],
    [new Error('429 Too Many Requests'), 'rate-limited'],
    [new Error('DataDome captcha challenge'), 'captcha'],
  ];
  for (const [err, expected] of cases) {
    const r = await scanConversations(source([err]), BASE);
    assert(r.complete === false, `failure "${expected}" → complete false`);
    assert(r.warnings.some((w) => w.code === expected), `plain error classified as ${expected}`);
  }
}

// 10. Empty list.
{
  const r = await scanConversations(source([{ raw: [], hasMore: false }]), BASE);
  assert(r.complete === true && r.conversations.length === 0, 'empty page → complete, zero conversations');
  assert(r.warnings.length === 0, 'empty page produces no warnings');
}

// 11. Partial response: mixed valid/invalid rows.
{
  const r = await scanConversations(
    source([{ raw: [row('1'), { no_id: true }, 'garbage', { id: 'x', weird: 1 }], hasMore: false }]),
    BASE,
  );
  assert(r.complete === true, 'partial rows do not fail the scan');
  assert(r.conversations.length === 1, 'only the single usable row becomes a conversation');
  const codes = r.warnings.map((w) => w.code);
  assert(codes.includes('missing-id') || codes.includes('invalid-item'), 'unusable row 1 flagged');
  assert(codes.includes('unsupported-structure'), 'unsupported row flagged explicitly');
}

// 12. Response with unknown top-level structure → fail closed.
{
  const badPage = {
    kind: 'read-only-api',
    async fetchPage() {
      return { raw: { not: 'an array' }, hasMore: false };
    },
  };
  const r = await scanConversations(badPage, BASE);
  assert(r.complete === false, 'page without raw array → complete false');
  assert(r.warnings.some((w) => w.code === 'unsupported-structure'), 'structure failure flagged');
}

// 13. Rescan determinism: two identical scans → identical results.
{
  const pages = [{ raw: [row('1'), row('2')], hasMore: false }];
  const a = await scanConversations(source(pages), BASE);
  const b = await scanConversations(source(pages), BASE);
  assert(JSON.stringify(a) === JSON.stringify(b), 'powtórny skan jest deterministyczny (identyczny wynik)');
}

// 14. DOM source kind is carried through (reserved for the DOM adapter).
{
  const r = await scanConversations(source([{ raw: [], hasMore: false }], 'dom'), BASE);
  assert(r.source === 'dom', 'dom source kind preserved in the result');
}

// 15. maxPages floor: 0/negative is clamped, never a silent no-op.
{
  const r = await scanConversations(source([{ raw: [row('1')], hasMore: false }]), { ...BASE, maxPages: 0 });
  assert(r.conversations.length === 1 && r.complete === true, 'maxPages clamped to at least 1');
}

console.log(`\nconversation-scanner: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
