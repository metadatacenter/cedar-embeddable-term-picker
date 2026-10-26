/**
 * Build `dist-bundle/cedar-embeddable-term-picker.js` — the single file an embedder
 * downloads — and a manifest recording what went into it. Build its host-fonts
 * counterpart, `cedar-embeddable-term-picker.host-fonts.js`, with a manifest of its own.
 *
 * The manifest exists so the size gate and the packaging step can check the copy
 * they are looking at without re-deriving it, and so a staged package can be
 * verified byte for byte against the bundle that was tested.
 *
 * Usable as a module: `produceBundle()` returns the bytes and the manifest
 * without writing, so the packaging step is testable against a synthetic build.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { DEFAULT_DIST, HOST_FONTS_DIST, ROOT, resolveBuildOutput } from './build-output.mjs';

export const OUT_DIR = join(ROOT, 'dist-bundle');
export const OUT = join(OUT_DIR, 'cedar-embeddable-term-picker.js');
export const MANIFEST = join(OUT_DIR, 'bundle-manifest.json');
export const HOST_FONTS_OUT = join(OUT_DIR, 'cedar-embeddable-term-picker.host-fonts.js');
export const HOST_FONTS_MANIFEST = join(OUT_DIR, 'bundle-manifest.host-fonts.json');

/**
 * The two bundles, each flattened from its own build and recorded in its own manifest.
 *
 * The default embeds the CEDAR Roboto faces and needs nothing from its host. The
 * host-fonts bundle leaves them to a host page that registers them once for every
 * CEDAR component it loads. A host loads one of the two, never both.
 */
export const BUNDLES = [
  { dist: DEFAULT_DIST, out: OUT, manifest: MANIFEST },
  { dist: HOST_FONTS_DIST, out: HOST_FONTS_OUT, manifest: HOST_FONTS_MANIFEST },
];

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Flatten one ES module and its chunks into a classic script.
 *
 * `iife` matters: the file is loaded with a plain `<script>` by embedders who
 * are not obliged to use `type="module"`, and a top-level `import` would fail
 * there.
 */
async function flatten(entry) {
  const esbuild = await import('esbuild');
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    /*
     * Whitespace only. Angular has already minified, downleveled and tree-shaken
     * this; re-mangling names would add risk for nothing. But esbuild re-prints
     * what it parses, and printing minified input with default formatting
     * inflates the result substantially, so this undoes that and touches nothing
     * else.
     */
    minifyWhitespace: true,
    write: false,
    logLevel: 'silent',
    platform: 'browser',
  });
  return Buffer.from(result.outputFiles[0].contents);
}

export async function produceBundle(dist = DEFAULT_DIST) {
  const { inputs } = resolveBuildOutput(dist);

  const parts = [];
  for (const input of inputs) {
    parts.push(await flatten(input.path));
  }
  const bundle = Buffer.concat(parts);

  return {
    bundle,
    /*
     * No timestamp. A build time here would make the manifest differ on every
     * rebuild even when the bundle was byte-identical, so a staged copy could
     * never be verified by comparison. The freshness guard takes its timestamps
     * from the filesystem instead.
     */
    manifest: {
      bytes: bundle.length,
      sha256: sha256(bundle),
      inputs: inputs.map((input) => relative(ROOT, input.path)),
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const { dist, out, manifest: manifestPath } of BUNDLES) {
    const { bundle, manifest } = await produceBundle(dist);
    writeFileSync(out, bundle);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(
      `  ${basename(out)}: ${manifest.bytes.toLocaleString('en-US')} bytes (${manifest.sha256.slice(0, 12)}…)`,
    );
  }
}

export const readManifest = (path = MANIFEST) => JSON.parse(readFileSync(path, 'utf8'));
