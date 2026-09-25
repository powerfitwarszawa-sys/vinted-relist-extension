/**
 * Queue state machine tests.
 *
 * Run: node --experimental-vm-modules tests/queue-test.mjs
 * or:  node tests/queue-test.mjs
 *
 * Mocks chrome.* APIs and storage, then exercises QueueEngine through
 * pause, SW restart recovery, double alarm, mixed batch, API pause, and
 * reuse of a listing ID in a later cycle.
 */

import { QueueEngine } from '../dist/core/queue.js';

// ── Mock chrome APIs ────────────────────────────────────────────────

const memStore = {};

let alarmFireFn = null;
let alarmTimer = null;

globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => {
        const k = typeof key === 'string' ? key : Object.keys(key)[0];
        const val = memStore[k] ?? null;
        if (k === 'vbr:queue') {
          console.log(`  [mock] storage.get('vbr:queue') → ${val ? `${val.items?.length ?? 0} items, idx=${val.currentIndex}, state=${val.state}` : 'null'}`);
        }
        return { [k]: val };
      },
      set: async (obj) => {
        for (const [k, v] of Object.entries(obj)) {
          memStore[k] = v;
        }
      },
    },
  },
  alarms: {
    get: async (name) => (alarmTimer ? { name, scheduledTime: Date.now() + 20 } : undefined),
    create: async (name, opts) => {
      if (alarmTimer) clearTimeout(alarmTimer);
      // Fire after 20ms for test speed (delayInMinutes is ignored)
      alarmTimer = setTimeout(() => {
        if (alarmFireFn) alarmFireFn({ name });
      }, 20);
    },
    clear: async () => {
      if (alarmTimer) clearTimeout(alarmTimer);
      alarmTimer = null;
    },
    onAlarm: {
      addListener: (fn) => { alarmFireFn = fn; },
      removeListener: () => { alarmFireFn = null; },
    },
  },
};

function setupAlarmBridge(q) {
  chrome.alarms.onAlarm.addListener(() => q.onAlarm());
}

// ── Test helpers ───────────────────────────────────────────────────

let testCount = 0;
let passCount = 0;
let failCount = 0;

function assert(cond, msg) {
  testCount++;
  if (cond) {
    passCount++;
    console.log(`  ✓ ${msg}`);
  } else {
    failCount++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

function makeListing(id) {
  return {
    id: String(id),
    title: `Item ${id}`,
    price: 20,
    currency: 'zł',
    url: `https://www.vinted.pl/items/${id}`,
    thumbnailUrl: undefined,
    status: 'active',
  };
}

function getState(queue) {
  return queue.getStatus();
}

function resetStorage() {
  console.log('  [debug] memStore keys before reset:', Object.keys(memStore));
  for (const k of Object.keys(memStore)) delete memStore[k];
  console.log('  [debug] memStore keys after reset:', Object.keys(memStore));
  // Clear any pending alarm timer from previous test
  if (alarmTimer) {
    clearTimeout(alarmTimer);
    alarmTimer = null;
  }
  // Clear alarm listener from previous test
  alarmFireFn = null;
}

async function makeQueue(executor) {
  const q = new QueueEngine();
  await q.init(executor);
  return q;
}

// Executor that always succeeds after delay
function successExecutor(delay = 10) {
  return async (item) => {
    await new Promise((r) => setTimeout(r, delay));
    return { success: true, code: 'success', message: `Relisted ${item.listing.id}` };
  };
}

// Executor that fails for specific ids
function failExecutor(failIds) {
  return async (item) => {
    await new Promise((r) => setTimeout(r, 10));
    if (failIds.includes(item.listing.id)) {
      return { success: false, code: 'relist-button-missing', message: `Button not found for ${item.listing.id}` };
    }
    return { success: true, code: 'success', message: `Relisted ${item.listing.id}` };
  };
}

// ── Tests ──────────────────────────────────────────────────────────

async function test1_PauseRunning() {
  console.log('\nTest 1: Pause during running');
  resetStorage();

  const q = await makeQueue(successExecutor(50));
  setupAlarmBridge(q);
  await q.add([makeListing(1), makeListing(2), makeListing(3)]);

  // Start queue
  await q.resume();
  await new Promise((r) => setTimeout(r, 25)); // let the mock alarm fire and start the step

  // Pause while item 1 is running
  await q.pause();

  const status = getState(q);

  assert(status.state === 'paused', 'Queue state is paused');
  assert(status.items.some((i) => i.status === 'paused' || i.status === 'running'), 'At least one item is paused/running');

  // Resume
  await q.resume();
  await new Promise((r) => setTimeout(r, 500));

  const finalStatus = getState(q);
  assert(finalStatus.state === 'idle', 'Queue finished (idle)');
  assert(finalStatus.completed === 3, `All 3 succeeded (got ${finalStatus.completed})`);
}

async function test2_SWRestartDuringRunning() {
  console.log('\nTest 2: SW restart during running');
  resetStorage();

  memStore['vbr:queue'] = {
    items: [
      { listing: { ...makeListing(1), status: 'running' }, attempts: 0 },
      { listing: { ...makeListing(2), status: 'queued' }, attempts: 0 },
    ],
    currentIndex: 0,
    state: 'running',
  };

  const executedIds = [];
  const q2 = await makeQueue(async (item) => {
    executedIds.push(item.listing.id);
    return { success: true, code: 'success', message: `Relisted ${item.listing.id}` };
  });
  setupAlarmBridge(q2);

  const status = getState(q2);
  assert(status.state === 'paused', 'Queue state is paused after restart (was running)');
  assert(status.items[0].status === 'error', 'Interrupted item is marked as uncertain error');
  assert(!status.items.some((i) => i.status === 'running'), 'No items stuck in running');

  // Resume must continue with the next item, never repeat the uncertain action.
  await q2.resume();
  await new Promise((r) => setTimeout(r, 150));

  const finalStatus = getState(q2);
  assert(finalStatus.state === 'idle', 'Queue finished after recovery');
  assert(finalStatus.completed + finalStatus.failed === 2, `All items processed (got ${finalStatus.completed + finalStatus.failed})`);
  assert(executedIds.join(',') === '2', `Interrupted item was not executed twice (executed: ${executedIds.join(',')})`);
}

async function test2b_SWRestartBetweenStepsContinues() {
  console.log('\nTest 2b: SW restart between steps');
  resetStorage();

  memStore['vbr:queue'] = {
    items: [
      { listing: { ...makeListing(1), status: 'success' }, attempts: 0 },
      { listing: { ...makeListing(2), status: 'queued' }, attempts: 0 },
    ],
    currentIndex: 1,
    state: 'running',
  };

  const executedIds = [];
  const q = await makeQueue(async (item) => {
    executedIds.push(item.listing.id);
    return { success: true, code: 'success', message: `Relisted ${item.listing.id}` };
  });
  setupAlarmBridge(q);

  assert(getState(q).state === 'running', 'Queue remains running when no action was interrupted');
  await new Promise((r) => setTimeout(r, 150));
  assert(getState(q).state === 'idle', 'Queue finishes after restart between steps');
  assert(executedIds.join(',') === '2', `Only the pending item runs (executed: ${executedIds.join(',')})`);
}

async function test3_DoubleAlarm() {
  console.log('\nTest 3: Double alarm / re-entry');
  resetStorage();

  let callCount = 0;
  const q = await makeQueue(async (item) => {
    callCount++;
    await new Promise((r) => setTimeout(r, 50));
    return { success: true, code: 'success', message: 'ok' };
  });
  setupAlarmBridge(q);

  await q.add([makeListing(1), makeListing(2)]);
  await q.resume();

  // Wait for first alarm to fire + executor to start
  await new Promise((r) => setTimeout(r, 25));

  // Fire alarm twice rapidly — second should be skipped by isProcessing guard
  await q.onAlarm();

  // Wait for executor to finish + next alarm
  await new Promise((r) => setTimeout(r, 100));

  // Fire second alarm rapidly while second item might be processing
  await q.onAlarm();
  await q.onAlarm();

  await new Promise((r) => setTimeout(r, 300));

  const status = getState(q);
  assert(status.state === 'idle', 'Queue finished');
  assert(callCount === 2, `Executor called exactly 2 times (once per item), got ${callCount}`);
  assert(status.completed === 2, `Both items succeeded (got ${status.completed})`);
}

async function test4_MixedBatch() {
  console.log('\nTest 4: Mixed batch — some success, some error');
  resetStorage();

  const q = await makeQueue(failExecutor(['2', '4']));
  setupAlarmBridge(q);
  await q.add([makeListing(1), makeListing(2), makeListing(3), makeListing(4), makeListing(5)]);

  await q.resume();

  // Wait for all 5 to process (5 * ~70ms + 5 * 20ms alarm delays)
  await new Promise((r) => setTimeout(r, 800));

  const status = getState(q);
  assert(status.state === 'idle', `Queue finished (idle), got ${status.state}`);
  assert(status.total === 5, `Total 5 items (got ${status.total})`);
  assert(status.completed === 3, `3 succeeded (got ${status.completed})`);
  assert(status.failed === 2, `2 failed (got ${status.failed})`);

  // Verify per-item statuses
  const items = status.items;
  assert(items[0].status === 'success', `Item 1 success (got ${items[0].status})`);
  assert(items[1].status === 'error', `Item 2 error (got ${items[1].status})`);
  assert(items[1].lastError?.includes('Button not found'), 'Item 2 has error message');
  assert(items[2].status === 'success', `Item 3 success (got ${items[2].status})`);
  assert(items[3].status === 'error', `Item 4 error (got ${items[3].status})`);
  assert(items[4].status === 'success', `Item 5 success (got ${items[4].status})`);

  // Verify terminal: re-run onAlarm should do nothing
  await q.onAlarm();
  const status2 = getState(q);
  assert(status2.completed === 3, `Still 3 succeeded after re-alarm (got ${status2.completed})`);
  assert(status2.failed === 2, `Still 2 failed after re-alarm (got ${status2.failed})`);
}

async function test5_ApiRateLimitPausesBatch() {
  console.log('\nTest 5: API access/rate-limit pauses batch');
  resetStorage();

  let callCount = 0;
  const q = await makeQueue(async (item) => {
    callCount++;
    if (item.listing.id === '1') {
      return {
        success: false,
        code: 'api-access-or-rate-limit',
        message: 'API 429 /api/v2/item_upload/drafts: too many requests',
      };
    }
    return { success: true, code: 'success', message: `Relisted ${item.listing.id}` };
  });
  setupAlarmBridge(q);
  await q.add([makeListing(1), makeListing(2)]);

  await q.resume();
  await new Promise((r) => setTimeout(r, 100));

  const paused = getState(q);
  assert(paused.state === 'paused', `Queue pauses after API 429 (got ${paused.state})`);
  assert(paused.failed === 1, `API-blocked item is recorded as failed (got ${paused.failed})`);
  assert(paused.items[0].status === 'error', `API-blocked item is error (got ${paused.items[0].status})`);
  assert(paused.items[1].status === 'queued', `Remaining item stays queued (got ${paused.items[1].status})`);
  assert(callCount === 1, `No later item runs while queue is paused (got ${callCount} calls)`);

  await q.resume();
  await new Promise((r) => setTimeout(r, 100));

  const finalStatus = getState(q);
  assert(finalStatus.state === 'idle', `Queue finishes after explicit resume (got ${finalStatus.state})`);
  assert(finalStatus.completed === 1, `Remaining item succeeds after resume (got ${finalStatus.completed})`);
}

async function test6_NewCycleAcceptsPreviouslyFinishedId() {
  console.log('\nTest 6: New cycle can reuse a terminal listing ID');
  resetStorage();

  const q = await makeQueue(successExecutor(1));
  setupAlarmBridge(q);
  await q.add([makeListing(42)]);
  await q.resume();
  await new Promise((r) => setTimeout(r, 100));

  assert(getState(q).completed === 1, 'First cycle completed');
  const added = await q.add([makeListing(42)]);
  assert(added === 1, `Finished ID is accepted in a new cycle (added ${added})`);
  assert(getState(q).total === 1, `Terminal history is compacted for the new cycle (total ${getState(q).total})`);
}

// ── Run all tests ───────────────────────────────────────────────────

async function main() {
  console.log('========================================');
  console.log('Queue State Machine Tests');
  console.log('========================================');

  await test1_PauseRunning();
  // Wait for any remaining timers from test 1
  await new Promise((r) => setTimeout(r, 500));
  await test2_SWRestartDuringRunning();
  await new Promise((r) => setTimeout(r, 500));
  await test2b_SWRestartBetweenStepsContinues();
  await new Promise((r) => setTimeout(r, 200));
  await test3_DoubleAlarm();
  await new Promise((r) => setTimeout(r, 500));
  await test4_MixedBatch();
  await new Promise((r) => setTimeout(r, 200));
  await test5_ApiRateLimitPausesBatch();
  await new Promise((r) => setTimeout(r, 200));
  await test6_NewCycleAcceptsPreviouslyFinishedId();

  console.log('\n========================================');
  console.log(`Results: ${passCount}/${testCount} passed, ${failCount} failed`);
  console.log('========================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
