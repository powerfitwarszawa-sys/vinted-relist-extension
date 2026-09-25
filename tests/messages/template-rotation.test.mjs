/**
 * Unit tests: template-rotation (deterministic, injected random).
 * Run order: node tests/messages/build.mjs first (bundles the module).
 */

const { selectNextTemplate } = await import(
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

function tpl(id, enabled = true) {
  return {
    id,
    name: `Template ${id}`,
    body: `Treść ${id}`,
    enabled,
    usageCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function state(overrides = {}) {
  return { conversationId: 'c-1', usedTemplateIds: [], ...overrides };
}

const randomOf = (value) => () => value;

console.log('========================================');
console.log('Template Rotation Tests');
console.log('========================================');

// 1. Empty pool → explicit error.
{
  const r = selectNextTemplate([], state(), randomOf(0.5));
  assert(r.ok === false && r.code === 'no-templates', 'empty pool: explicit no-templates error');
  assert(r.template === undefined, 'empty pool: no template returned');
}

// 2. All disabled → explicit error.
{
  const r = selectNextTemplate([tpl('a', false), tpl('b', false)], state(), randomOf(0));
  assert(r.ok === false && r.code === 'no-enabled-templates', 'all disabled: explicit no-enabled-templates error');
}

// 3. Disabled templates are never selected (random sweeps the whole range).
{
  const templates = [tpl('a'), tpl('b'), tpl('disabled', false)];
  let sawDisabled = false;
  for (let r = 0; r < 100; r++) {
    const res = selectNextTemplate(templates, state(), randomOf(r / 100));
    if (res.template?.id === 'disabled') sawDisabled = true;
  }
  assert(!sawDisabled, 'disabled template never selected across 100 draws');
}

// 4. Deterministic mapping with injected random.
{
  const templates = [tpl('a'), tpl('b'), tpl('c')];
  assert(selectNextTemplate(templates, state(), randomOf(0)).template?.id === 'a', 'random 0 → first');
  assert(selectNextTemplate(templates, state(), randomOf(0.34)).template?.id === 'b', 'random 0.34 → second');
  assert(selectNextTemplate(templates, state(), randomOf(0.999999)).template?.id === 'c', 'random ~1 → last');
}

// 5. Last-used template is excluded while an alternative exists.
{
  const templates = [tpl('a'), tpl('b')];
  const st = state({ lastTemplateId: 'a' });
  assert(selectNextTemplate(templates, st, randomOf(0)).template?.id === 'b', 'last=a, random 0 → b');
  assert(selectNextTemplate(templates, st, randomOf(0.99)).template?.id === 'b', 'last=a, random ~1 → b');
}

// 6. Only enabled template is the last-used one → repeat instead of deadlock.
{
  const r = selectNextTemplate([tpl('a'), tpl('b', false)], state({ lastTemplateId: 'a' }), randomOf(0));
  assert(r.ok === true && r.template?.id === 'a', 'single enabled == last: selected anyway (no deadlock)');
}

// 7. random() = 1 → clamped, no out-of-range selection.
{
  const templates = [tpl('a'), tpl('b')];
  const r = selectNextTemplate(templates, state(), randomOf(1));
  assert(r.ok === true && r.template !== undefined, 'random 1: still selects a valid template');
}

// 8. random() = NaN / non-function → deterministic fallback (first candidate).
{
  const templates = [tpl('a'), tpl('b')];
  assert(selectNextTemplate(templates, state(), randomOf(Number.NaN)).template?.id === 'a', 'NaN random → first candidate');
  assert(
    selectNextTemplate(templates, state(), /** @type {any} */ (null)).template?.id === 'a',
    'non-function random → first candidate',
  );
}

// 9. Negative random → clamped to first candidate.
{
  const r = selectNextTemplate([tpl('a'), tpl('b')], state(), randomOf(-5));
  assert(r.template?.id === 'a', 'negative random → first candidate');
}

// 10. State and template array are never mutated.
{
  const templates = [tpl('a'), tpl('b')];
  const st = state({ lastTemplateId: 'a', usedTemplateIds: ['a'] });
  const stBefore = JSON.stringify(st);
  const arrBefore = JSON.stringify(templates);
  selectNextTemplate(templates, st, randomOf(0.7));
  assert(JSON.stringify(st) === stBefore, 'rotation: state not mutated');
  assert(JSON.stringify(templates) === arrBefore, 'rotation: template array not mutated');
}

// 11. Malformed entries (null / without body) are skipped, not crashed on.
{
  const garbage = [null, tpl('a'), { id: 'no-body', enabled: true }];
  const r = selectNextTemplate(/** @type {any} */ (garbage), state(), randomOf(0));
  assert(r.ok === true && r.template?.id === 'a', 'malformed entries skipped');
}

// 12. Math.random() is never consulted (stubbed to throw during the call).
{
  const original = Math.random;
  let threw = false;
  Math.random = () => {
    throw new Error('Math.random must not be used');
  };
  try {
    const r = selectNextTemplate([tpl('a'), tpl('b')], state(), randomOf(0.5));
    assert(r.ok === true, 'no global random: selection works with Math.random sabotaged');
  } catch {
    threw = true;
  } finally {
    Math.random = original;
  }
  assert(!threw, 'no global random: Math.random never called inside the logic');
}

// 13. Result reason/code are explicit.
{
  const r = selectNextTemplate([tpl('a')], state(), randomOf(0));
  assert(r.code === 'selected' && typeof r.reason === 'string' && r.reason.length > 0, 'selected result carries a reason');
}

console.log(`Results: ${passed}/${passed + failed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
