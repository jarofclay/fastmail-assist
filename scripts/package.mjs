// Zips the two builds for handing to someone else or uploading to a store,
// and the source for Firefox Add-ons, which asks for it because the build is
// bundled:
//   dist/fastmail-assist-chrome-<version>.zip
//   dist/fastmail-assist-firefox-<version>.zip
//   dist/fastmail-assist-source-<version>.zip   (git archive of HEAD)
// Run through `npm run package`, which checks and builds first.

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

for (const browser of ['chrome', 'firefox']) {
  const zip = resolve(root, 'dist', `fastmail-assist-${browser}-${version}.zip`);
  rmSync(zip, { force: true });
  // The manifest has to sit at the top level of the archive.
  execFileSync('zip', ['-qr', zip, '.', '-x', '.DS_Store'], { cwd: resolve(root, 'dist', browser) });
  console.log(`Wrote ${zip}`);
}

const source = resolve(root, 'dist', `fastmail-assist-source-${version}.zip`);
rmSync(source, { force: true });
execFileSync('git', ['archive', '--format=zip', `--prefix=fastmail-assist-${version}/`, '-o', source, 'HEAD'], { cwd: root });
console.log(`Wrote ${source}`);
