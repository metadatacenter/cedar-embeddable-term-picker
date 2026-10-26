/**
 * What the published package contains, and which registry it belongs to.
 *
 * Shared by the staging step and the verification step so the two cannot
 * disagree about either question.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ROOT } from './build-output.mjs';
import { HOST_FONTS_MANIFEST, HOST_FONTS_OUT, MANIFEST, OUT, sha256 } from './make-bundle.mjs';

export const TYPES = join(ROOT, 'dist-types/cetp-public-api.d.ts');
/**
 * The one file the public API re-exports from, shipped beside it.
 *
 * CEE's package carries a single declaration because its contract is one
 * import-free file. The picker's contract is a discriminated union of four hit
 * shapes that the component itself uses, so duplicating it by hand for the
 * package would be a copy to keep in step. The re-export names a path inside the
 * package instead, and both files travel.
 */
export const TYPES_SEARCH = join(ROOT, 'dist-types/search/search-types.d.ts');
export const TARGET = join(ROOT, 'dist-npm/cedar-embeddable-term-picker');

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/**
 * The two channels the picker publishes on, and which one a version selects.
 *
 * A development snapshot goes to the CEDAR Nexus under the `@org.metadatacenter`
 * scope; a release goes to public npmjs unscoped. The channel is derived from the
 * version rather than passed at publish time, so a snapshot cannot be published
 * as a release by forgetting a flag. The scope is what makes selective resolution
 * possible: npm routes by scope, so an embedding application can take this one
 * package from Nexus while everything else comes from npmjs.
 */
const NEXUS_REGISTRY = 'https://nexus.bmir.stanford.edu/repository/npm-cedar/';
const DEV_VERSION = /-dev\./;

export function packageMetadata(rootPackage = readJson(join(ROOT, 'package.json'))) {
  const isDev = DEV_VERSION.test(rootPackage.version);
  return {
    name: isDev ? '@org.metadatacenter/cedar-embeddable-term-picker' : 'cedar-embeddable-term-picker',
    version: rootPackage.version,
    description: rootPackage.description,
    // The bundle is a side-effecting script that registers a custom element and
    // exports nothing, so `main` is a courtesy and `types` is what a host imports
    // `CedConfig` from. The declaration also carries the `HTMLElementTagNameMap`
    // entry that makes `document.querySelector('cedar-embeddable-term-picker')` typed.
    main: 'cedar-embeddable-term-picker.js',
    types: 'cedar-embeddable-term-picker.d.ts',
    files: [
      'cedar-embeddable-term-picker.js',
      'cedar-embeddable-term-picker.host-fonts.js',
      'cedar-embeddable-term-picker.d.ts',
      'search/search-types.d.ts',
      'search/constraint-set.d.ts',
      'bundle-manifest.json',
      'bundle-manifest.host-fonts.json',
      'README.md',
      'CHANGELOG.md',
      'license.txt',
    ],
    // A release carries no publishConfig, so it goes to registry.npmjs.org under
    // `latest`. A snapshot names Nexus here, so the destination cannot be lost by
    // forgetting a flag. The tag still has to be passed on the command line.
    ...(isDev ? { publishConfig: { registry: NEXUS_REGISTRY, tag: 'dev' } } : {}),
    repository: { type: 'git', url: 'git+https://github.com/metadatacenter/cedar-embeddable-term-picker.git' },
    keywords: ['metadata', 'CEDAR', 'ontology', 'terminology', 'picker', 'Web Component'],
    author: 'Metadata Center',
    license: 'BSD-2-Clause',
    bugs: { url: 'https://github.com/metadatacenter/cedar-embeddable-term-picker/issues' },
    homepage: 'https://github.com/metadatacenter/cedar-embeddable-term-picker#readme',
  };
}

/** One bundle and its manifest, refused if they do not agree. */
function readBundle(out, manifestPath) {
  const name = basename(out);
  if (!existsSync(out) || !existsSync(manifestPath)) {
    throw new Error(`${name} is missing.\n  Run: npm run bundle`);
  }
  const bundle = readFileSync(out);
  const manifest = readJson(manifestPath);
  if (sha256(bundle) !== manifest.sha256) {
    throw new Error(`${name} does not match its manifest digest.\n  Run: npm run bundle`);
  }
  return { bundle, manifest };
}

/**
 * Refuse a host-fonts bundle that still declares a font face.
 *
 * Both bundles are built from the same sources and differ only in the font registrar, so the
 * host-fonts bundle must declare no face and must be the smaller of the two. The picker draws
 * its icons as inline SVG, so the host-fonts bundle has no face of any kind to keep.
 */
export function assertHostFontsBundle(bundle, hostFontsBundle) {
  if (hostFontsBundle.includes(Buffer.from('@font-face'))) {
    throw new Error('the host-fonts bundle declares a font face.\n  Run: npm run build:production && npm run bundle');
  }
  if (hostFontsBundle.length >= bundle.length) {
    throw new Error(
      'the host-fonts bundle is no smaller than the default one.\n  Run: npm run build:production && npm run bundle',
    );
  }
}

/** Both bundles and their manifests, refused if a pair disagrees or the host-fonts bundle declares a face. */
export function assertSourceBundles() {
  const standalone = readBundle(OUT, MANIFEST);
  const hostFonts = readBundle(HOST_FONTS_OUT, HOST_FONTS_MANIFEST);
  assertHostFontsBundle(standalone.bundle, hostFonts.bundle);
  if (!existsSync(TYPES) || !existsSync(TYPES_SEARCH)) {
    throw new Error('the published declarations are missing.\n  Run: npm run types:public');
  }
  return { standalone, hostFonts };
}

const manifestBytes = (manifest) => Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);

/** Every file the staged package should contain, by name. */
export function expectedFiles() {
  const { standalone, hostFonts } = assertSourceBundles();
  return {
    'cedar-embeddable-term-picker.js': standalone.bundle,
    'cedar-embeddable-term-picker.host-fonts.js': hostFonts.bundle,
    'cedar-embeddable-term-picker.d.ts': readFileSync(TYPES),
    'search/search-types.d.ts': readFileSync(TYPES_SEARCH),
    'search/constraint-set.d.ts': readFileSync(join(ROOT, 'dist-types/search/constraint-set.d.ts')),
    'bundle-manifest.json': manifestBytes(standalone.manifest),
    'bundle-manifest.host-fonts.json': manifestBytes(hostFonts.manifest),
    'README.md': readFileSync(join(ROOT, 'README.md')),
    'CHANGELOG.md': readFileSync(join(ROOT, 'CHANGELOG.md')),
    'license.txt': readFileSync(join(ROOT, 'license.txt')),
    'package.json': Buffer.from(`${JSON.stringify(packageMetadata(), null, 2)}\n`),
  };
}
