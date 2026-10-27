/**
 * The freshness check against a synthetic repository.
 *
 * Each test lays out a small tree with the inputs the build fingerprints, records two builds the
 * way the build step does, and bundles them the way the bundle step does. It then changes one
 * thing and asks the check for a verdict. The checkout's own builds are never read, so these
 * tests run before anything is built.
 */
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_DIST, HOST_FONTS_DIST, ROOT } from './build-output.mjs';
import { provenanceFile, recordProvenance, sourceFingerprint } from './build-provenance.mjs';
import { checkBundle } from './check-bundle-fresh.mjs';
import { BUNDLES, writeBundle } from './make-bundle.mjs';

/** One file of each kind the build fingerprints. */
const INPUTS = {
  'src/main.ts': "import './app/app';\n",
  'public/favicon.ico': 'icon',
  'scripts/make-bundle.mjs': '// flattens the build\n',
  'angular.json': '{ "projects": {} }\n',
  'tsconfig.app.json': '{ "extends": "./tsconfig.json" }\n',
  'package.json': '{ "name": "cedar-embeddable-term-picker" }\n',
  'package-lock.json': '{ "lockfileVersion": 3 }\n',
  'node_modules/@org.metadatacenter/cedar-design-tokens/dist/custom-properties.css': ':root {}\n',
  'node_modules/cedar-model-typescript-library/index.js': 'export {};\n',
};

const write = (file, content) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};

/** Replace a file's content and keep its timestamps, so only a content-based check can notice. */
function edit(file, content) {
  const { atime, mtime } = statSync(file);
  writeFileSync(file, content);
  utimesSync(file, atime, mtime);
}

/** A repository with both builds recorded and both bundles made from them. */
async function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'cetp-bundle-fresh-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(INPUTS)) {
    write(join(root, path), content);
  }

  const source = sourceFingerprint(root);
  const bundles = [
    { name: 'default', registrar: '@font-face{font-family:"CEDAR Roboto"}' },
    { name: 'host-fonts', registrar: '' },
  ].map(({ name, registrar }) => {
    const dist = join(root, 'dist', name);
    write(join(dist, 'browser/main.js'), `console.log(${JSON.stringify(registrar)});\n`);
    recordProvenance(dist, source);
    return {
      dist,
      out: join(root, 'dist-bundle', `${name}.js`),
      manifest: join(root, 'dist-bundle', `bundle-manifest.${name}.json`),
    };
  });
  for (const bundle of bundles) {
    await writeBundle(bundle, root);
  }
  return { root, bundles };
}

const assertFresh = (bundles, root) => {
  for (const bundle of bundles) {
    assert.doesNotThrow(() => checkBundle(bundle, root));
  }
};

const assertStale = (bundles, root, reason) => {
  for (const bundle of bundles) {
    assert.throws(
      () => checkBundle(bundle, root),
      (error) =>
        reason.test(error.message) && /must be rebuilt/.test(error.message) && /npm run dist/.test(error.message),
    );
  }
};

test('a bundle made from the current build of the current sources passes', async (t) => {
  const { root, bundles } = await repository(t);

  assertFresh(bundles, root);
  const manifest = JSON.parse(readFileSync(bundles[0].manifest, 'utf8'));
  assert.equal(manifest.provenance.source, sourceFingerprint(root));
});

test('a changed source file fails both bundles, even with its timestamps restored', async (t) => {
  const { root, bundles } = await repository(t);
  const file = join(root, 'src/main.ts');

  edit(file, "import './app/app';\nconsole.log('fixed');\n");
  assertStale(bundles, root, /sources, configuration or dependencies have changed/);

  edit(file, INPUTS['src/main.ts']);
  assertFresh(bundles, root);
});

test('a changed configuration file fails both bundles', async (t) => {
  const { root, bundles } = await repository(t);

  for (const path of ['angular.json', 'tsconfig.app.json', 'package.json']) {
    edit(join(root, path), '{}\n');
    assertStale(bundles, root, /sources, configuration or dependencies have changed/);
    edit(join(root, path), INPUTS[path]);
  }
  assertFresh(bundles, root);
});

test('a changed dependency lock or installed CEDAR package fails both bundles', async (t) => {
  const { root, bundles } = await repository(t);

  for (const path of [
    'package-lock.json',
    'node_modules/@org.metadatacenter/cedar-design-tokens/dist/custom-properties.css',
    'node_modules/cedar-model-typescript-library/index.js',
  ]) {
    edit(join(root, path), 'changed\n');
    assertStale(bundles, root, /sources, configuration or dependencies have changed/);
    edit(join(root, path), INPUTS[path]);
  }
  assertFresh(bundles, root);
});

test('a new source file fails both bundles', async (t) => {
  const { root, bundles } = await repository(t);

  write(join(root, 'src/app/added.ts'), 'export const added = true;\n');
  assertStale(bundles, root, /sources, configuration or dependencies have changed/);
});

test('a bundle whose record is missing fails', async (t) => {
  const { root, bundles } = await repository(t);
  const [standalone, hostFonts] = bundles;

  const manifest = JSON.parse(readFileSync(standalone.manifest, 'utf8'));
  delete manifest.provenance;
  writeFileSync(standalone.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  assertStale([standalone], root, /records no build inputs/);

  rmSync(hostFonts.manifest);
  assertStale([hostFonts], root, /manifest, .*, is missing/);
});

test('a missing bundle fails', async (t) => {
  const { root, bundles } = await repository(t);

  rmSync(bundles[0].out);
  assert.throws(() => checkBundle(bundles[0], root), /is missing\.\n {2}Run: npm run dist/);
  assertFresh([bundles[1]], root);
});

test('each bundle answers for its own build', async (t) => {
  const { root, bundles } = await repository(t);
  const [standalone, hostFonts] = bundles;

  edit(join(hostFonts.dist, 'browser/main.js'), 'console.log("rebuilt");\n');
  assertStale([hostFonts], root, /build output has changed/);
  assertFresh([standalone], root);

  rmSync(standalone.dist, { recursive: true });
  assertStale([standalone], root, /build output has changed since it was recorded, or is missing/);
});

test('a bundle edited after it was made fails', async (t) => {
  const { root, bundles } = await repository(t);

  edit(bundles[1].out, 'console.log("edited");\n');
  assertStale([bundles[1]], root, /bytes differ/);
  assertFresh([bundles[0]], root);
});

test('the bundle step refuses a build that is unrecorded or older than its sources', async (t) => {
  const { root, bundles } = await repository(t);
  const [standalone, hostFonts] = bundles;

  rmSync(provenanceFile(standalone.dist));
  await assert.rejects(writeBundle(standalone, root), /records no build inputs.*\n {2}Run: npm run dist/);

  edit(join(root, 'src/main.ts'), 'changed\n');
  await assert.rejects(
    writeBundle(hostFonts, root),
    /must be rebuilt\. The sources, configuration or dependencies have changed/,
  );
});

test('each build keeps its own record, so one build cannot vouch for the other', () => {
  assert.deepEqual(
    BUNDLES.map(({ dist }) => dist),
    [DEFAULT_DIST, HOST_FONTS_DIST],
  );
  assert.notEqual(provenanceFile(DEFAULT_DIST), provenanceFile(HOST_FONTS_DIST));
  assert.equal(dirname(provenanceFile(HOST_FONTS_DIST)), HOST_FONTS_DIST);
});

test('the browser tests and the visual baselines run the check before using the build', () => {
  const { scripts } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  for (const name of ['test:browser:prebuilt', 'test:visual']) {
    assert.ok(scripts[name].startsWith('npm run check:fresh && '), name);
  }
  // The gate bundles before the browser tests, so the check they run first sees current bundles.
  const gate = scripts['test:ci'];
  assert.ok(gate.indexOf('npm run bundle') < gate.indexOf('npm run test:browser:prebuilt'), gate);
});
