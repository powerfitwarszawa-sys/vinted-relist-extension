/**
 * Background message tests for pre-relist backups.
 *
 * Uses the built dist/background/background.js service worker module with a
 * mocked chrome.* API, then sends ADD_TO_QUEUE through the registered runtime
 * message listener.
 */

const memStore = {};
let messageListener = null;
let alarmListener = null;

globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => {
        const k = typeof key === 'string' ? key : Object.keys(key)[0];
        return { [k]: memStore[k] ?? null };
      },
      set: async (obj) => {
        for (const [k, v] of Object.entries(obj)) {
          memStore[k] = v;
        }
      },
    },
  },
  action: {
    setBadgeText: async () => {},
    setBadgeBackgroundColor: async () => {},
  },
  alarms: {
    create: async () => {},
    clear: async () => true,
    onAlarm: {
      addListener: (fn) => {
        alarmListener = fn;
      },
    },
  },
  runtime: {
    onInstalled: {
      addListener: () => {},
    },
    onMessage: {
      addListener: (fn) => {
        messageListener = fn;
      },
    },
  },
  tabs: {
    query: async () => [],
    sendMessage: async () => ({}),
    update: async () => ({}),
    onUpdated: {
      addListener: () => {},
      removeListener: () => {},
    },
  },
};

function makeListing(id) {
  return {
    id: String(id),
    title: `Item ${id}`,
    price: 20 + Number(id),
    currency: 'zł',
    url: `https://www.vinted.pl/items/${id}-item-${id}`,
    status: 'active',
  };
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    if (!messageListener) {
      reject(new Error('runtime.onMessage listener was not registered'));
      return;
    }

    try {
      messageListener(message, {}, resolve);
    } catch (err) {
      reject(err);
    }
  });
}

let testCount = 0;
let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  testCount++;
  if (condition) {
    passCount++;
    console.log(`  ✓ ${message}`);
  } else {
    failCount++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log('========================================');
console.log('Background Backup Tests');
console.log('========================================');

await import('../dist/background/background.js');

assert(typeof messageListener === 'function', 'runtime message listener registered');
assert(typeof alarmListener === 'function', 'alarm listener registered');

const listings = [makeListing(101), makeListing(102)];
const response = await sendRuntimeMessage({
  type: 'ADD_TO_QUEUE',
  payload: { listings },
});

assert(response?.ok === true, 'ADD_TO_QUEUE returns ok');
assert(response?.added === 2, `ADD_TO_QUEUE added 2 listings (got ${response?.added})`);

const backups = memStore['vbr:backups'] ?? [];
const queue = memStore['vbr:queue'];
const logs = memStore['vbr:logs'] ?? [];

assert(backups.length === 2, `two pre-relist backups saved (got ${backups.length})`);
assert(backups.every((listing) => listing.status === 'active'), 'backups are normalized to active status');
assert(queue?.items?.length === 2, `queue has 2 items (got ${queue?.items?.length ?? 0})`);
assert(queue?.items?.every((item) => item.listing.status === 'queued'), 'queued listings have queued status');
assert(
  logs.some((entry) => entry.message.includes('Pre-relist backup saved for 2 listing(s)')),
  'pre-relist backup log entry recorded',
);

console.log('\n========================================');
console.log(`Results: ${passCount}/${testCount} passed, ${failCount} failed`);
console.log('========================================');

if (failCount > 0) {
  process.exit(1);
}
