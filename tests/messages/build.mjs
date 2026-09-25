/**
 * Test-only bundler for the messages module.
 *
 * The production build (scripts/build.cjs) does not yet list messages-module
 * entries, and this phase may not touch it. Node tests therefore bundle
 * src/core/messages/index.ts themselves with esbuild (already a devDependency)
 * into node_modules/.cache/ (gitignored), then import the artifact.
 *
 * Run before the messages tests:  node tests/messages/build.mjs
 */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

// Two bundles: the core module (T1–T3) and the read-only content layer (T3).
const targets = [
  {
    entry: path.join(repoRoot, 'src', 'core', 'messages', 'index.ts'),
    outfile: path.join(repoRoot, 'node_modules', '.cache', 'vinted-messages', 'messages.js'),
  },
  {
    entry: path.join(repoRoot, 'src', 'content', 'messages', 'index.ts'),
    outfile: path.join(repoRoot, 'node_modules', '.cache', 'vinted-messages', 'content.js'),
  },
];

for (const target of targets) {
  await build({
    entryPoints: [target.entry],
    outfile: target.outfile,
    format: 'esm',
    target: 'es2022',
    bundle: true,
    platform: 'node',
    sourcemap: false,
    minify: false,
    logLevel: 'warning',
  });
  console.log(`✓ messages test bundle built: ${path.relative(repoRoot, target.outfile)}`);
}
