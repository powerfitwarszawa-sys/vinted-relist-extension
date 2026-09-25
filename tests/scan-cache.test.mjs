const store = {};

globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => ({ [key]: store[key] }),
      set: async (values) => Object.assign(store, values),
    },
  },
};

const { getScanResult, markScanListingsRelisted, saveScanResult } = await import('../dist/core/scan-cache.js');

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

function listing(id) {
  return { id, title: `Item ${id}`, price: 10, currency: 'zł', url: `https://www.vinted.pl/items/${id}`, status: 'active', sourceStatus: 'active' };
}

console.log('========================================');
console.log('Scan Cache Tests');
console.log('========================================');

await saveScanResult([listing('old-1')], 'wardrobe-api');
await markScanListingsRelisted(['old-1', 'new-1'], 123456);
await saveScanResult([listing('new-1')], 'wardrobe-api');
const scan = await getScanResult();

assert(scan?.listings[0]?.id === 'new-1', 'new scan contains the replacement listing ID');
assert(scan?.listings[0]?.lastRelisted === 123456, 'replacement ID keeps the relist cooldown');

console.log(`Results: ${passed}/${passed + failed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);