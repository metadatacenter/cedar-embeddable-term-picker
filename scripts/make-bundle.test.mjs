/**
 * The bundle step makes two bundles from two builds, and each manifest has to
 * describe its own bundle and the build that bundle came from.
 *
 * The builds here are synthetic, because the packaging tests run before
 * anything is built.
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { DEFAULT_DIST, HOST_FONTS_DIST } from './build-output.mjs';
import {
  BUNDLES,
  HOST_FONTS_MANIFEST,
  HOST_FONTS_OUT,
  MANIFEST,
  OUT,
  OUT_DIR,
  produceBundle,
  sha256,
} from './make-bundle.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'cetp-make-bundle-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** A build with Angular's layout: one entry module under `browser/`, importing a chunk. */
function syntheticBuild(name, registrar) {
  const dist = join(scratch, name);
  mkdirSync(join(dist, 'browser'), { recursive: true });
  writeFileSync(join(dist, 'browser/registrar.js'), `export const faces = ${JSON.stringify(registrar)};\n`);
  writeFileSync(
    join(dist, 'browser/main.js'),
    `import { faces } from './registrar.js';\ncustomElements.define('cedar-embeddable-term-picker', class extends HTMLElement {});\nconsole.log(faces);\n`,
  );
  return dist;
}

test('each bundle comes from its own build and is written beside the other', () => {
  assert.deepEqual(
    BUNDLES.map(({ dist, out, manifest }) => [dist, out, manifest]),
    [
      [DEFAULT_DIST, OUT, MANIFEST],
      [HOST_FONTS_DIST, HOST_FONTS_OUT, HOST_FONTS_MANIFEST],
    ],
  );
  assert.equal(basename(HOST_FONTS_OUT), 'cedar-embeddable-term-picker.host-fonts.js');
  assert.equal(basename(HOST_FONTS_MANIFEST), 'bundle-manifest.host-fonts.json');
  for (const { out, manifest } of BUNDLES) {
    assert.equal(dirname(out), OUT_DIR);
    assert.equal(dirname(manifest), OUT_DIR);
  }
});

test('each manifest records the bytes, digest and entry of its own build', async () => {
  const standalone = await produceBundle(syntheticBuild('default', '@font-face{font-family:"CEDAR Roboto"}'));
  const hostFonts = await produceBundle(syntheticBuild('host-fonts', ''));

  for (const [{ bundle, manifest }, name] of [
    [standalone, 'default'],
    [hostFonts, 'host-fonts'],
  ]) {
    assert.equal(manifest.bytes, bundle.length);
    assert.equal(manifest.sha256, sha256(bundle));
    assert.equal(manifest.inputs.length, 1);
    assert.ok(manifest.inputs[0].endsWith(join(name, 'browser/main.js')), manifest.inputs[0]);
    // Flattened into a classic script: the chunk is inlined and nothing is left to import.
    assert.doesNotMatch(bundle.toString(), /\bimport\b|\bexport\b/);
  }
  assert.match(standalone.bundle.toString(), /@font-face/);
  assert.doesNotMatch(hostFonts.bundle.toString(), /@font-face/);
  assert.notEqual(standalone.manifest.sha256, hostFonts.manifest.sha256);
});
