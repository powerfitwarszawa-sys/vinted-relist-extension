/**
 * Unit tests: conversation data source adapter (T3.1/T3.2) — response
 * extraction, pagination, error classification into ConversationScanError.
 * Run order: node tests/messages/build.mjs first (bundles both files).
 */

const { createConversationApiDataSource, createReadOnlyConversationClient } = await import(
  '../../../node_modules/.cache/vinted-messages/content.js'
);
const { ConversationScanError, scanConversations } = await import(
  '../../../node_modules/.cache/vinted-messages/messages.js'
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

function clientWith(handler) {
  return createReadOnlyConversationClient({
    fetchImpl: async (url, init) => {
      if ((init?.method ?? 'GET') !== 'GET') {
        throw new Error(`FORBIDDEN: ${String(init?.method)}`);
      }
      return handler(String(url));
    },
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

console.log('conversation-data-source');

// 1. Standard page: items + cursor.
{
  const src = createConversationApiDataSource(
    clientWith(() => jsonResponse({ items: [{ id: 1 }, { id: 2 }], next_cursor: 'cursor-2' })),
  );
  assert(src.kind === 'read-only-api', 'source kind is read-only-api');
  const page = await src.fetchPage();
  assert(Array.isArray(page.raw) && page.raw.length === 2, 'items extracted as raw rows');
  assert(page.hasMore === true && page.nextCursor === 'cursor-2', 'cursor → hasMore + nextCursor');
}

// 2. Last page: no cursor → hasMore false.
{
  const src = createConversationApiDataSource(
    clientWith(() => jsonResponse({ items: [{ id: 1 }] })),
  );
  const page = await src.fetchPage('cursor-9');
  assert(page.hasMore === false && page.nextCursor === undefined, 'no cursor on the last page');
}

// 3. Explicit has_more=false wins over a stale cursor.
{
  const src = createConversationApiDataSource(
    clientWith(() => jsonResponse({ items: [], has_more: false, next_cursor: 'same-as-requested' })),
  );
  const page = await src.fetchPage('same-as-requested');
  assert(page.hasMore === false, 'explicit has_more:false respected');
}

// 4. Bare array response tolerated.
{
  const src = createConversationApiDataSource(clientWith(() => jsonResponse([{ id: 7 }])));
  const page = await src.fetchPage();
  assert(page.raw.length === 1 && page.hasMore === false, 'bare array page handled');
}

// 5. Unknown structure → ConversationScanError(unsupported-structure).
{
  const src = createConversationApiDataSource(clientWith(() => jsonResponse({ totally: 'different' })));
  try {
    await src.fetchPage();
    assert(false, 'unknown structure must throw');
  } catch (error) {
    assert(error.name === 'ConversationScanError' && error.code !== undefined, 'throws ConversationScanError');
    assert(error.code === 'unsupported-structure', 'code is unsupported-structure');
  }
}

// 6. Failure codes map onto scan errors (401/429/500).
{
  const cases = [
    [401, 'session-expired'],
    [429, 'rate-limited'],
    [500, 'unknown'],
  ];
  for (const [status, code] of cases) {
    const src = createConversationApiDataSource(
      clientWith(() => new Response('err', { status })),
    );
    try {
      await src.fetchPage();
      assert(false, `status ${String(status)} must throw`);
    } catch (error) {
      assert(error.name === 'ConversationScanError' && error.code === code, `status ${String(status)} → ConversationScanError(${code})`);
    }
  }
}

// 7. End-to-end: adapter + scanner happy path through a real HTTP shape.
{
  const pages = {
    'https://www.vinted.pl/api/v2/conversations': { items: [{ id: 1, unread_count: 1 }], next_cursor: 'c2' },
    'https://www.vinted.pl/api/v2/conversations?cursor=c2': { items: [{ id: 2, unread_count: 0 }], next_cursor: null },
  };
  const src = createConversationApiDataSource(
    clientWith((url) => jsonResponse(pages[url] ?? { items: [] })),
  );
  const result = await scanConversations(src, {
    makeScanId: () => 'e2e-scan',
    now: () => Date.parse('2026-06-02T09:00:00.000Z'),
    maxPages: 5,
  });
  assert(result.complete === true, 'scanner + adapter complete a paginated scan');
  assert(result.conversations.length === 2, 'both pages collected');
  assert(result.source === 'read-only-api', 'source kind reported');
}

console.log(`\nconversation-data-source: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
