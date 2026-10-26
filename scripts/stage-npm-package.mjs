/**
 * Copy the tested bytes into `dist-npm/`, ready for `npm pack` or `npm publish`.
 *
 * Nothing here builds anything. The bundles it stages are the ones the size gate
 * measured and, in CI, the builds the browser check loaded — staging a freshly built
 * copy instead would publish bytes nothing had exercised.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TARGET, assertSourceBundles, expectedFiles } from './npm-package.mjs';

const { standalone, hostFonts } = assertSourceBundles();
mkdirSync(TARGET, { recursive: true });
for (const [name, bytes] of Object.entries(expectedFiles())) {
  const file = join(TARGET, name);
  // `search/search-types.d.ts` sits in a subdirectory the public API re-exports from.
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

for (const [name, { manifest }] of [
  ['cedar-embeddable-term-picker.js', standalone],
  ['cedar-embeddable-term-picker.host-fonts.js', hostFonts],
]) {
  console.log(
    `  staged ${name}, ${manifest.bytes.toLocaleString('en-US')} bytes, to dist-npm/ (${manifest.sha256.slice(0, 12)}…)`,
  );
}
