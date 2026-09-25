/**
 * Read-only enforcement tests (T3.2/T3.5) — "testy dla próby użycia
 * metody zapisu".
 *
 * Two independent guards:
 *  1. STATIC — every message-module source file is scanned for write
 *     methods (POST/PUT/PATCH/DELETE) in fetch-style calls; any hit fails
 *     the suite. The scanner's dependency surface must stay GET-only.
 *  2. RUNTIME — a full scan runs through a fake transport that THROWS the
 *     moment any non-GET method is issued, plus an explicit attempt to
 *     smuggle a write method through the client options must not change
 *     the wire method.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { scanConversations } = await import('../../../node_modules/.cache/vinted-messages/messages.js');
const { createReadOnlyConversationClient, createConversationApiDataSource } = await import(
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

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const scannedDirs = [
  path.join(repoRoot, 'src', 'core', 'messages'),
  path.join(repoRoot, 'src', 'content', 'messages'),
];

console.log('read-only-guard');

// ── 1. Static: no write methods in the message module ──────────────

const WRITE_METHOD = /(?:method\s*[:=]\s*["'](POST|PUT|PATCH|DELETE)["'])|\.(?:post|put|patch|delete)\s*\(/;

{
  const offenders = [];
  let fileCount = 0;
  for (const dir of scannedDirs) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts')) continue;
      fileCount++;
      const source = readFileSync(path.join(dir, name), 'utf8');
      const match = source.match(WRITE_METHOD);
      if (match !== null) {
        offenders.push(`${path.join(path.basename(dir), name)} → ${match[0]}`);
      }
    }
  }
  assert(fileCount >= 8, `scanned ${fileCount} message-module files (expected all of them)`);
  assert(offenders.length === 0, `no write-method usage in src messages files${offenders.length > 0 ? ` — offenders: ${offenders.join('; ')}` : ''}`);
}

// ── 2. Static: transport lives only in the API client ──────────────

{
  const strayFetch = [];
  for (const dir of scannedDirs) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts') || name === 'conversation-api-client.ts') continue;
      const source = readFileSync(path.join(dir, name), 'utf8');
      if (/(?:^|[^.\w])fetch\s*\(/.test(source)) {
        strayFetch.push(name);
      }
    }
  }
  assert(strayFetch.length === 0, `fetch() outside the dedicated client — ${strayFetch.length === 0 ? 'none' : strayFetch.join(', ')}`);
}

// ── 3. Static: scanner module does not import the write-capable client ──

{
  const scannerSource = readFileSync(
    path.join(repoRoot, 'src', 'core', 'messages', 'conversation-scanner.ts'),
    'utf8',
  );
  assert(!scannerSource.includes('vinted-api'), 'scanner does not reference the general write-capable API client');
  const dataSourceSource = readFileSync(
    path.join(repoRoot, 'src', 'content', 'messages', 'conversation-data-source.ts'),
    'utf8',
  );
  assert(!dataSourceSource.includes('vinted-api'), 'data source adapter does not reference the write-capable API client');
}

// ── 4. Runtime: full scan through a hostile transport ──────────────

{
  const issuedMethods = [];
  const hostileFetch = async (url, init) => {
    const method = init?.method ?? 'GET';
    issuedMethods.push(method);
    if (method !== 'GET') {
      throw new Error(`WRITE ATTEMPTED: ${method}`);
    }
    const body =
      String(url).includes('cursor=')
        ? { items: [{ id: 2, unread_count: 0 }] }
        : { items: [{ id: 1, unread_count: 1 }], next_cursor: 'c2' };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const client = createReadOnlyConversationClient({ fetchImpl: hostileFetch });
  const src = createConversationApiDataSource(client);
  const result = await scanConversations(src, {
    makeScanId: () => 'guarded-scan',
    now: () => Date.parse('2026-06-02T09:00:00.000Z'),
  });

  assert(result.complete === true, 'scan completes through the guarded transport');
  assert(result.conversations.length === 2, 'pagination worked with GET-only transport');
  assert(issuedMethods.length === 2 && issuedMethods.every((m) => m === 'GET'), `every issued method was GET (${issuedMethods.join(', ')})`);
}

// ── 5. Runtime: extra client options cannot smuggle a write ────────

{
  const seen = [];
  const client = createReadOnlyConversationClient({
    fetchImpl: async (url, init) => {
      seen.push(init?.method ?? 'GET');
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    },
    // Even a hostile option bag must not alter the wire method: the client
    // takes no method parameter at all (type ReadOnlyHttpMethod = "GET").
    method: 'POST',
  });
  await client.listConversations({ cursor: 'x' });
  assert(seen.length === 1 && seen[0] === 'GET', 'client ignores any external method hint — wire method stays GET');
}

console.log(`\nread-only-guard: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
