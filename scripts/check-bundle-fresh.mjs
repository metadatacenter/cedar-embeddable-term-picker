/**
 * Refuse a bundle that was built from anything other than the current sources.
 *
 * The browser tests and the visual baselines run against the build already in `dist/`, the
 * packaging step stages the bundles already in `dist-bundle/`, and the designer loads those
 * bundles from this checkout. None of them builds anything, so after a source edit each would
 * still run, and pass, against the previous build. The gates here run this check first, so a
 * stale build fails them instead, and a sibling that loads the bundles can run it the same way.
 *
 * The build records a fingerprint of its inputs and output, and the bundle step copies that
 * record into each manifest. A bundle passes when its record matches the current sources,
 * configuration and CEDAR dependencies, when the build it was made from is unchanged, and when
 * its bytes are the ones its manifest describes.
 *
 * Usable as a module: `checkBundle()` throws rather than exiting, so the check is testable against
 * a synthetic repository and the packaging step can apply it before staging.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, relative } from 'node:path';
import { ROOT } from './build-output.mjs';
import { verifyProvenance } from './build-provenance.mjs';
import { BUNDLES, sha256 } from './make-bundle.mjs';

const REBUILD = '\n  Run: npm run dist';

/** Return the manifest of a bundle that is current, and refuse one that is not. */
export function checkBundle({ dist, out, manifest: manifestPath }, root = ROOT) {
  const name = relative(root, out);
  const stale = (reason) => new Error(`${name} must be rebuilt. ${reason}${REBUILD}`);

  if (!existsSync(out)) {
    throw new Error(`${name} is missing.${REBUILD}`);
  }
  if (!existsSync(manifestPath)) {
    throw stale(
      `Its manifest, ${relative(root, manifestPath)}, is missing, so nothing records what it was built from.`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!manifest.provenance) {
    throw stale('Its manifest records no build inputs, so it was made before builds recorded them.');
  }
  try {
    verifyProvenance(manifest.provenance, root, dist);
  } catch (error) {
    throw stale(error.message);
  }
  if (sha256(readFileSync(out)) !== manifest.sha256) {
    throw stale('Its bytes differ from the ones its manifest records.');
  }
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const target of BUNDLES) {
    try {
      const manifest = checkBundle(target);
      console.log(`  ${basename(target.out)}: ${manifest.sha256.slice(0, 12)}… matches the current sources.`);
    } catch (error) {
      console.error(`  ${error.message}`);
      process.exit(1);
    }
  }
}
