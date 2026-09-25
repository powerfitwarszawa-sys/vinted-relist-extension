/**
 * Unit tests: template-engine (pure rendering, no DOM/storage/network).
 * Run order: node tests/messages/build.mjs first (bundles the module).
 */

const { renderMessageTemplate } = await import(
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

function tpl(body, overrides = {}) {
  return {
    id: 't-1',
    name: 'Test template',
    body,
    enabled: true,
    usageCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const ALL_VARS = {
  username: 'Ola',
  itemTitle: 'Sukienka',
  itemPrice: '49.99',
  currency: 'zł',
  conversationId: '987',
};

console.log('========================================');
console.log('Template Engine Tests');
console.log('========================================');

// 1. Happy path — all five variables substituted.
{
  const r = renderMessageTemplate(
    tpl('Cześć {{username}}, {{itemTitle}} za {{itemPrice}} {{currency}} (wątek {{conversationId}}).'),
    ALL_VARS,
  );
  assert(r.ok === true, 'happy path: ok=true');
  assert(
    r.body === 'Cześć Ola, Sukienka za 49.99 zł (wątek 987).',
    'happy path: every variable replaced',
  );
  assert(r.unknownVariables.length === 0 && r.missingVariables.length === 0, 'happy path: no reports');
}

// 2. Repeated placeholders.
{
  const r = renderMessageTemplate(tpl('{{username}} i znowu {{username}}'), ALL_VARS);
  assert(r.ok === true && r.body === 'Ola i znowu Ola', 'repeats: every occurrence replaced');
}

// 3. Empty value → substituted as empty string (text around it preserved).
{
  const r = renderMessageTemplate(tpl('[{{itemTitle}}] koniec'), { itemTitle: '' });
  assert(r.ok === true && r.body === '[] koniec', 'empty value: replaced with empty text');
}

// 4. Special replacement chars stay literal ($&, $`, $1).
{
  const r = renderMessageTemplate(tpl('price: {{itemTitle}}'), { itemTitle: "$& $` $' $1 $$" });
  assert(
    r.ok === true && r.body === "price: $& $` $' $1 $$",
    'special chars: replacement uses a callback, $-sequences stay literal',
  );
}

// 5. No recursive substitution of inserted values.
{
  const r = renderMessageTemplate(tpl('{{itemTitle}}'), { itemTitle: 'see {{currency}} now' });
  assert(r.ok === true && r.body === 'see {{currency}} now', 'injection: value placeholders are not re-scanned');
}

// 6. Unknown variable → explicit error, placeholder kept.
{
  const r = renderMessageTemplate(tpl('Hej {{firstName}}, {{username}}'), { username: 'Ola' });
  assert(r.ok === false, 'unknown variable: ok=false');
  assert(r.body === 'Hej {{firstName}}, Ola', 'unknown variable: placeholder text kept, known one replaced');
  assert(r.unknownVariables.includes('firstName'), 'unknown variable: name reported');
  assert(typeof r.error === 'string' && r.error.includes('{{firstName}}'), 'unknown variable: error names the placeholder');
}

// 7. Multiple unknown variables are all reported.
{
  const r = renderMessageTemplate(tpl('{{foo}} {{bar}} {{foo}}'), {});
  assert(r.ok === false, 'multiple unknowns: ok=false');
  assert(
    r.unknownVariables.length === 2 && r.unknownVariables.includes('foo') && r.unknownVariables.includes('bar'),
    'multiple unknowns: both reported once each',
  );
}

// 8. Supported-but-not-provided variable keeps its placeholder (optional/unused).
{
  const r = renderMessageTemplate(tpl('Cześć {{username}}, tytuł: {{itemTitle}}'), { username: 'Ola' });
  assert(r.ok === true, 'missing optional: still ok=true');
  assert(r.body === 'Cześć Ola, tytuł: {{itemTitle}}', 'missing optional: placeholder text preserved');
  assert(r.missingVariables.includes('itemTitle') && !r.missingVariables.includes('username'), 'missing optional: reported');
}

// 9. Whitespace inside braces is accepted.
{
  const r = renderMessageTemplate(tpl('{{  username }}'), { username: 'Ola' });
  assert(r.ok === true && r.body === 'Ola', 'whitespace: {{ username }} style matches');
}

// 10. Unicode and emoji survive untouched.
{
  const r = renderMessageTemplate(tpl('Żółć ✓ 🎉 {{username}}'), { username: 'Ąć' });
  assert(r.ok === true && r.body === 'Żółć ✓ 🎉 Ąć', 'unicode: Polish characters and emoji preserved');
}

// 11. No placeholders → body unchanged.
{
  const body = 'Zwykły tekst {i} {{ nawiasy bez zmiennej }}';
  const r = renderMessageTemplate(tpl(body), ALL_VARS);
  assert(r.ok === true && r.body === body, 'no placeholders: body untouched');
}

// 12. Numeric variable values are coerced to strings.
{
  const r = renderMessageTemplate(tpl('{{itemPrice}} {{currency}}'), { itemPrice: 12.5, currency: '€' });
  assert(r.ok === true && r.body === '12.5 €', 'numbers: coerced via String()');
}

// 13. Malformed placeholder shape (hyphen) is not a variable → untouched, no error.
{
  const r = renderMessageTemplate(tpl('{{ name-with-dash }}'), {});
  assert(r.ok === true && r.body === '{{ name-with-dash }}', 'malformed: non-variable braces left as-is without error');
}

// 14. Determinism: same input → same output (no clock/random reads).
{
  const t = tpl('Dzień dobry {{username}}');
  const a = renderMessageTemplate(t, { username: 'X' });
  const b = renderMessageTemplate(t, { username: 'X' });
  assert(a.body === b.body && a.ok === b.ok, 'determinism: identical inputs give identical outputs');
}

console.log(`Results: ${passed}/${passed + failed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
