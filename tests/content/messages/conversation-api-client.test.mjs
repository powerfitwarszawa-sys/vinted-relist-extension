/**
 * Unit tests: read-only conversation client (T3.2).
 * Run order: node tests/messages/build.mjs first (bundles content.js).
 *
 * The fake fetch records every call; any non-GET method throws on the
 * spot, so a write attempt fails the test suite immediately.
 */

const { createReadOnlyConversationClient } = await import(
  '../../../node_modules/.cache/vinted-messages/content.js'
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

const ALLOWED_METHOD = 'GET';
const requests = [];

function fakeFetch(handler) {
  return async (url, init) => {
    const method = init?.method ?? 'GET';
    if (method !== ALLOWED_METHOD) {
      throw new Error(`FORBIDDEN METHOD IN TEST: ${method} (read-only client must only issue GET)`);
    }
    requests.push({ url: String(url), method });
    return handler(String(url));
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

console.log('conversation-api-client');

// 1. listConversations builds a GET URL; cursor only when provided.
{
  requests.length = 0;
  const client = createReadOnlyConversationClient({
    fetchImpl: fakeFetch(() => jsonResponse({ items: [] })),
  });

  await client.listConversations({});
  await client.listConversations({ cursor: 'abc', perPage: 50 });

  assert(requests.length === 2, 'two requests issued');
  assert(requests[0].method === 'GET' && requests[1].method === 'GET', 'every request uses GET');
  assert(!requests[0].url.includes('cursor'), 'no cursor param when cursor absent');
  assert(requests[1].url.includes('cursor=abc') && requests[1].url.includes('limit=50'), 'cursor + limit serialized when provided');
  assert(requests.every((r) => r.url.startsWith('https://www.vinted.pl/api/v2/conversations')), 'read-only conversations endpoint used');
}

// 2. getConversation encodes the id.
{
  requests.length = 0;
  const client = createReadOnlyConversationClient({
    fetchImpl: fakeFetch(() => jsonResponse({ id: 'a b/c' })),
  });
  const res = await client.getConversation('a b/c');
  assert(res.ok === true, 'single conversation read succeeds');
  assert(requests[0].url.endsWith('/conversations/a%20b%2Fc'), 'id path segment is encoded');
  assert(requests[0].method === 'GET', 'detail read uses GET');
}

// 3. Success parses JSON.
{
  const client = createReadOnlyConversationClient({
    fetchImpl: fakeFetch(() => jsonResponse({ items: [{ id: 1 }], next_cursor: 'x' })),
  });
  const res = await client.listConversations({});
  assert(res.ok === true && res.status === 200, '200 → ok:true with status');
  assert(res.ok === true && JSON.stringify(res.data).includes('next_cursor'), 'payload preserved as data');
}

// 4. Status mapping — fail closed with precise codes.
{
  const cases = [
    [401, 'session-expired'],
    [403, 'session-expired'],
    [429, 'rate-limited'],
    [500, 'http-error'],
  ];
  for (const [status, code] of cases) {
    const client = createReadOnlyConversationClient({
      fetchImpl: fakeFetch(() => new Response('nope', { status })),
    });
    const res = await client.listConversations({});
    assert(res.ok === false && res.code === code, `status ${String(status)} → ${code}`);
  }
}

// 5. CAPTCHA challenge body beats the plain status mapping.
{
  const client = createReadOnlyConversationClient({
    fetchImpl: fakeFetch(() => new Response('<html>datadome captcha</html>', { status: 403 })),
  });
  const res = await client.listConversations({});
  assert(res.ok === false && res.code === 'captcha', 'DataDome body → captcha code');
}

// 6. Network failure → network-error (no throw).
{
  const client = createReadOnlyConversationClient({
    fetchImpl: async () => {
      throw new Error('ECONNRESET');
    },
  });
  const res = await client.listConversations({});
  assert(res.ok === false && res.code === 'network-error', 'network failure → network-error, returned as data');
}

// 7. Invalid JSON on 200 → http-error, never a crash.
{
  const client = createReadOnlyConversationClient({
    fetchImpl: fakeFetch(() => new Response('<html>login wall</html>', { status: 200 })),
  });
  const res = await client.listConversations({});
  assert(res.ok === false && res.code === 'http-error', 'non-JSON 200 → http-error');
}

console.log(`\nconversation-api-client: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
