/**
 * What each build was compiled from, recorded beside its output.
 *
 * The build step fingerprints its inputs before Angular runs and writes that fingerprint, with one
 * of the compiled output, into the output directory. The bundle step refuses a build whose record
 * no longer matches and copies the record into the bundle's manifest. The freshness check then
 * compares the manifest's record with the current inputs and the current output.
 *
 * The designer records its builds the same way, so the two components answer the question of
 * whether a bundle is current by the same rule.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DEFAULT_DIST, ROOT } from './build-output.mjs';

const RECORD = 'cetp-build-inputs.json';

/** Each build output records the inputs it was compiled from beside itself. */
export const provenanceFile = (dist = DEFAULT_DIST) => join(dist, RECORD);

function fingerprint(root, paths) {
  const hash = createHash('sha256');
  const visit = (path) => {
    hash.update(relative(root, path) + '\0');
    if (!existsSync(path)) {
      hash.update('missing\0');
      return;
    }
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        if (name !== 'node_modules' && name !== '.git' && name !== RECORD) visit(join(path, name));
      }
    } else {
      hash.update(readFileSync(path));
      hash.update('\0');
    }
  };
  for (const path of paths) visit(join(root, path));
  return hash.digest('hex');
}

/**
 * The sources, the scripts that build and flatten them, the root configuration and the two CEDAR
 * packages the build compiles in.
 *
 * The root configuration includes `package-lock.json`, which pins every other dependency, so the
 * installed copies of those are not read. The two CEDAR packages are read as installed, because an
 * installed copy can differ from what the lock names: a development build can install one from a
 * sibling checkout.
 *
 * Content-based: touching a file or restoring timestamps cannot change the verdict.
 */
export function sourceFingerprint(root = ROOT) {
  const config = readdirSync(root)
    .filter((name) => /^(?:package(?:-lock)?\.json|angular\.json|tsconfig.*\.json|\.postcssrc\.json)$/.test(name))
    .sort();
  return fingerprint(root, [
    'src',
    'public',
    'scripts',
    ...config,
    'node_modules/@org.metadatacenter/cedar-design-tokens',
    'node_modules/cedar-model-typescript-library',
  ]);
}

export function outputFingerprint(dist = DEFAULT_DIST) {
  return fingerprint(dist, ['.']);
}

/** Record, beside a finished build, the inputs fingerprinted before it started and the output it produced. */
export function recordProvenance(dist, source) {
  const record = { source, output: outputFingerprint(dist) };
  writeFileSync(provenanceFile(dist), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/** A build's record, or null when the build was not made by `npm run build:production`. */
export function readProvenance(dist = DEFAULT_DIST) {
  const file = provenanceFile(dist);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

/** Refuse a record that no longer describes the current inputs or the current output. */
export function verifyProvenance(record, root = ROOT, dist = DEFAULT_DIST) {
  if (!record || record.source !== sourceFingerprint(root)) {
    throw new Error('The sources, configuration or dependencies have changed since the build.');
  }
  if (record.output !== outputFingerprint(dist)) {
    throw new Error('The build output has changed since it was recorded, or is missing.');
  }
}
