// The update manifest Firefox polls for a self-distributed (unlisted) add-on,
// so installs made from the signed .xpi update themselves. The release
// workflow attaches it to every GitHub release, and the unlisted build's
// manifest points at the fixed address of the latest release's copy.
//
//   node scripts/firefox-updates.mjs <signed.xpi> <version> <download base URL>
//
// prints the JSON. The base URL is the release's download folder, e.g.
// https://github.com/jarofclay/fastmail-assist/releases/download/v0.4.1

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The add-on id from the Firefox manifest (scripts/manifest.mjs). */
export const ADDON_ID = 'fastmail-assist@extensions.invalid';

/** Firefox's update manifest for one version of the add-on. */
export function updatesManifest({ id = ADDON_ID, version, fileName, sha256, baseUrl }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Not a release version: ${version}`);
  const base = baseUrl.replace(/\/+$/, '');
  return {
    addons: {
      [id]: {
        updates: [{ version, update_link: `${base}/${encodeURIComponent(fileName)}`, update_hash: `sha256:${sha256}` }],
      },
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [xpi, version, baseUrl] = process.argv.slice(2);
  if (!xpi || !version || !baseUrl) {
    console.error('Usage: node scripts/firefox-updates.mjs <signed.xpi> <version> <download base URL>');
    process.exit(2);
  }
  const sha256 = createHash('sha256').update(readFileSync(xpi)).digest('hex');
  console.log(JSON.stringify(updatesManifest({ version, fileName: basename(xpi), sha256, baseUrl }), null, 2));
}
