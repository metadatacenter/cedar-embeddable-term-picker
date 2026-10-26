/**
 * The publish channel is derived from the version, so it cannot be lost by
 * forgetting a flag at the command line. That derivation is the thing worth a
 * test: getting it wrong publishes a development snapshot to public npmjs, which
 * is not an action anyone can take back.
 *
 * The package also carries two bundles, and the host-fonts one is refused if it
 * still declares a font face. The refusal is tested here against small stand-ins,
 * because the packaging tests run before anything is built.
 */
import { strict as assert } from 'node:assert';
import { basename } from 'node:path';
import { test } from 'node:test';
import { HOST_FONTS_MANIFEST, HOST_FONTS_OUT, MANIFEST, OUT } from './make-bundle.mjs';
import { assertHostFontsBundle, packageMetadata } from './npm-package.mjs';

test('a development snapshot goes to Nexus, under the CEDAR scope', () => {
  const metadata = packageMetadata({ version: '0.1.0-dev.20260829.abc1234', description: 'd' });

  assert.equal(metadata.name, '@org.metadatacenter/cedar-embeddable-term-picker');
  assert.equal(metadata.publishConfig.registry, 'https://nexus.bmir.stanford.edu/repository/npm-cedar/');
  assert.equal(metadata.publishConfig.tag, 'dev');
});

test('a release goes to the default registry, unscoped', () => {
  const metadata = packageMetadata({ version: '0.1.0', description: 'd' });

  assert.equal(metadata.name, 'cedar-embeddable-term-picker');
  assert.equal(metadata.publishConfig, undefined);
});

test('a release candidate that is not a dev snapshot is still a release', () => {
  assert.equal(packageMetadata({ version: '1.0.0-rc.1', description: 'd' }).name, 'cedar-embeddable-term-picker');
});

test('the package declares the licence the repository carries', () => {
  assert.equal(packageMetadata({ version: '0.1.0', description: 'd' }).license, 'BSD-2-Clause');
});

test('the declaration is what a host imports types from', () => {
  const metadata = packageMetadata({ version: '0.1.0', description: 'd' });

  assert.equal(metadata.types, 'cedar-embeddable-term-picker.d.ts');
  assert.ok(metadata.files.includes('cedar-embeddable-term-picker.d.ts'));
  assert.ok(metadata.files.includes('license.txt'));
});

test('the package ships the host-fonts bundle and its manifest beside the default pair', () => {
  const { files } = packageMetadata({ version: '0.1.0', description: 'd' });

  for (const out of [OUT, HOST_FONTS_OUT, MANIFEST, HOST_FONTS_MANIFEST]) {
    assert.ok(files.includes(basename(out)), basename(out));
  }
});

/** A stand-in for the default bundle: the element, and one embedded face as the registrar writes it. */
const FACE = '@font-face{font-family:"CEDAR Roboto";font-weight:400;src:url(data:font/woff2;base64,d09GMgAB)}';
const ELEMENT = 'customElements.define("cedar-embeddable-term-picker",class extends HTMLElement{});';
const standalone = Buffer.from(`${ELEMENT}var s=${JSON.stringify(FACE)};`);

test('a host-fonts bundle that declares no face and is the smaller one is accepted', () => {
  assert.doesNotThrow(() => assertHostFontsBundle(standalone, Buffer.from(`${ELEMENT}var s="";`)));
});

test('a host-fonts bundle that still declares a face is refused', () => {
  assert.throws(
    () => assertHostFontsBundle(Buffer.concat([standalone, standalone]), standalone),
    /declares a font face/,
  );
});

test('a host-fonts bundle no smaller than the default one is refused', () => {
  const padded = Buffer.from(ELEMENT.padEnd(standalone.length));

  assert.throws(() => assertHostFontsBundle(standalone, padded), /no smaller/);
});
