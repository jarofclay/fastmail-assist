// Zips the two builds for handing to someone else or uploading to a store:
//   dist/fastmail-assist-chrome-<version>.zip
//   dist/fastmail-assist-firefox-<version>.zip
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
