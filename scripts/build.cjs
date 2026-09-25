/**
 * Professional build script using esbuild.
 *
 * - Bundles each entry point independently (ES modules for MV3).
 * - Minifies production output with source maps.
 * - Copies static assets (HTML, CSS, icons) to dist/.
 * - Runs type checking via tsc --noEmit.
 */

const esbuild = require('esbuild');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';

/** Source directories mapped to their entry points and output paths. */
const ENTRY_POINTS = [
  { name: 'Background', src: 'src/background/background.ts', dest: 'dist/background/background.js' },
  { name: 'Popup',      src: 'src/popup/popup.ts',           dest: 'dist/popup/popup.js' },
  { name: 'Options',    src: 'src/options/options.ts',       dest: 'dist/options/options.js' },
  { name: 'Dashboard',  src: 'src/dashboard/dashboard.ts',   dest: 'dist/dashboard/dashboard.js' },
  // Testable core entry points — tests import these built artifacts directly.
  { name: 'Core errors', src: 'src/core/errors.ts',           dest: 'dist/core/errors.js' },
  { name: 'Core queue',  src: 'src/core/queue.ts',            dest: 'dist/core/queue.js' },
  { name: 'Core listing status', src: 'src/core/listing-status.ts', dest: 'dist/core/listing-status.js' },
  { name: 'Core listing selection', src: 'src/core/listing-selection.ts', dest: 'dist/core/listing-selection.js' },
  { name: 'Core relist preflight', src: 'src/core/relist-preflight.ts', dest: 'dist/core/relist-preflight.js' },
  { name: 'Core auto-relist', src: 'src/core/auto-relist.ts', dest: 'dist/core/auto-relist.js' },
  { name: 'Core relist safety', src: 'src/core/relist-safety.ts', dest: 'dist/core/relist-safety.js' },
  { name: 'Core scan cache', src: 'src/core/scan-cache.ts', dest: 'dist/core/scan-cache.js' },
  // Content script entry (classic script — loads content-init as async chunk)
  { name: 'Content',    src: 'src/content/content.ts',       dest: 'dist/content/content.js' },
  // Content-init — loaded as ES module from content.ts
  { name: 'ContentInit', src: 'src/content/content-init.ts', dest: 'dist/content/content-init.js' },
];

/** Static asset pairs to copy: { from, to } */
const ASSETS = [
  { from: 'src/shared/tokens.css', to: 'dist/shared/tokens.css' },
  { from: 'src/popup/popup.html',    to: 'dist/popup/popup.html' },
  { from: 'src/popup/popup.css',     to: 'dist/popup/popup.css' },
  { from: 'src/options/options.html', to: 'dist/options/options.html' },
  { from: 'src/options/options.css',  to: 'dist/options/options.css' },
  { from: 'src/dashboard/dashboard.html', to: 'dist/dashboard/dashboard.html' },
  { from: 'src/dashboard/dashboard.css',  to: 'dist/dashboard/dashboard.css' },
];

async function build() {
  const start = Date.now();
  console.log(`\n  Vinted Batch Relister — ${isDev ? 'DEVELOPMENT' : 'PRODUCTION'} build\n`);

  // ── Step 1: TypeScript type checking ─────────────────────────────
  console.log('  • TypeScript check...');

  // Run tsc via Node directly — works on all platforms without shell.
  const tscScript = path.join(__dirname, '..', 'node_modules', 'typescript', 'bin', 'tsc');
  const tscArgs = ['--noEmit', '--pretty'];
  const tsc = spawnSync(process.execPath, [tscScript, ...tscArgs], {
    stdio: 'inherit',
    shell: false,
    cwd: path.join(__dirname, '..'),
  });
  if (tsc.status !== 0) {
    console.error('\n  ✗ TypeScript errors found. Aborting build.\n');
    process.exit(1);
  }
  console.log('  ✓ TypeScript check passed\n');

  // ── Step 2: esbuild bundling ─────────────────────────────────────
  const results = await Promise.allSettled(
    ENTRY_POINTS.map((entry) =>
      esbuild.build({
        entryPoints: [entry.src],
        outfile: entry.dest,
        format: 'esm',
        target: 'es2022',
        bundle: true,
        sourcemap: isDev ? 'inline' : 'linked',
        minify: !isDev,
        treeShaking: true,
        legalComments: 'none',
        logLevel: 'info',
        external: [],
      }).then(() => ({ name: entry.name, ok: true }))
        .catch((err) => ({ name: entry.name, ok: false, error: err.message })),
    ),
  );

  for (const res of results) {
    if (res.status === 'fulfilled' && res.value.ok) {
      console.log(`  ✓ ${res.value.name}`);
    } else if (res.status === 'fulfilled' && !res.value.ok) {
      console.error(`  ✗ ${res.value.name}: ${res.value.error}`);
    } else {
      console.error(`  ✗ ${res.reason}`);
    }
  }

  const anyFailed = results.some(
    (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok),
  );
  if (anyFailed) {
    console.error('\n  ✗ Bundle step failed.\n');
    process.exit(1);
  }

  // ── Step 3: Copy static assets ───────────────────────────────────
  for (const asset of ASSETS) {
    const destDir = path.dirname(asset.to);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(
      path.join(__dirname, '..', asset.from),
      path.join(__dirname, '..', asset.to),
    );
    console.log(`  ✓ ${path.basename(asset.from)}`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n  ✓ Build complete in ${elapsed}s\n`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
