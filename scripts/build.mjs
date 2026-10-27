/**
 * Build the picker twice, once with its fonts and once without, and record beside each build what
 * it was compiled from.
 *
 * The inputs are fingerprinted before Angular starts and again after each build. A change between
 * the two means the output may mix old and new sources, so the build fails rather than record it.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { DEFAULT_DIST, HOST_FONTS_DIST, ROOT } from './build-output.mjs';
import { recordProvenance, sourceFingerprint } from './build-provenance.mjs';

const builds = [
  { args: ['--configuration=production'], dist: DEFAULT_DIST },
  { args: ['--configuration=production,host-fonts'], dist: HOST_FONTS_DIST },
];

const source = sourceFingerprint();
for (const { args, dist } of builds) {
  const result = spawnSync(process.execPath, [join(ROOT, 'node_modules/@angular/cli/bin/ng.js'), 'build', ...args], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (source !== sourceFingerprint()) {
    throw new Error('Build inputs changed while Angular was building. Rebuild before bundling.');
  }
  recordProvenance(dist, source);
}
