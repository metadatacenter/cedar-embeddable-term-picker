/**
 * A ceiling on what an embedder downloads.
 *
 * The gate is on the shipped file rather than on Angular's intermediate output,
 * because the shipped file is what the limit is actually about. Both a raw and a
 * gzip figure, because a CDN serves the compressed one and a file: URL serves the
 * raw one, and the two do not move together.
 *
 * Baseline on 2026-08-29: 395,685 raw and 201,618 gzip-9 bytes, at Angular 22.
 * The limits leave headroom deliberately. Raising one is a decision to be taken
 * on evidence and recorded here, not a step in making a build pass.
 *
 * `angular.json`'s `initial` budget gates the same bytes: Angular sums main.js and
 * polyfills.js, which is exactly what make-bundle.mjs concatenates. It therefore carries
 * RAW_LIMIT below as its `maximumError` and no warning band, so the two cannot disagree
 * about the same artifact. Move both together, or neither. Angular cannot gate the gzip
 * figure, which stays this script's alone.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { OUT, readManifest } from './make-bundle.mjs';

// 2026-09-18: shared semantic SVG registry and adapters bring the Angular output
// to about 480k raw bytes including the distribution wrapper. Keep the compressed ceiling unchanged (230k); this replaces
// local glyphs and includes only the curated registry, never the full Lucide set.
//
// 2026-09-25: localization. The picker states every string through @ngx-translate/core, the
// library and major version CEE uses, and compiles the English and Hungarian maps into the script
// so that nothing is fetched at runtime. Measured on the shipped file, that took it from 477,236
// to 515,572 raw bytes and from 224,014 to 234,634 gzip-9 bytes: about 13 kB raw for the two maps
// and the rest for the library and the templates that call it. Both ceilings move by the measured
// growth and keep roughly the headroom they had.
const RAW_LIMIT = 530_000;
const GZIP_LIMIT = 240_000;

const format = (bytes) => `${bytes.toLocaleString('en-US')} bytes`;

const bundle = readFileSync(OUT);
const manifest = readManifest();

if (bundle.length !== manifest.bytes) {
  console.error(`  bundle is ${format(bundle.length)} but its manifest says ${format(manifest.bytes)}.`);
  console.error('  Run: npm run bundle');
  process.exit(1);
}

const gzip = gzipSync(bundle, { level: 9 }).length;
let failed = false;

for (const [label, actual, limit] of [
  ['raw', bundle.length, RAW_LIMIT],
  ['gzip-9', gzip, GZIP_LIMIT],
]) {
  const headroom = limit - actual;
  if (headroom < 0) {
    console.error(`  ${label}: ${format(actual)} exceeds its ${format(limit)} ceiling by ${format(-headroom)}.`);
    failed = true;
  } else {
    console.log(`  ${label}: ${format(actual)}, ${format(headroom)} under the ceiling.`);
  }
}

process.exit(failed ? 1 : 0);
