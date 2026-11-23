// The release notes for one version, taken from CHANGELOG.md.
//
//   node scripts/release-notes.mjs v0.3.0            prints the notes
//   node scripts/release-notes.mjs --check v0.3.0    exits 1 unless package.json
//                                                     and CHANGELOG.md both have
//                                                     that version
//
// Used by the release workflow and by scripts/release.mjs.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const tag = args.find((a) => !a.startsWith('--'));
if (!tag) {
  console.error('Usage: node scripts/release-notes.mjs [--check] v<version>');
  process.exit(2);
}
const version = tag.replace(/^v/, '');

/** The body of the "## [version]" section of the changelog, or null. */
export function changelogSection(changelog, wanted) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^## \\[${wanted.replace(/\./g, '\\.')}\\]`).test(line));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  return rest.slice(0, end === -1 ? rest.length : end).join('\n').trim();
}

const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
const notes = changelogSection(changelog, version);
const packageVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;

const problems = [];
if (packageVersion !== version) problems.push(`package.json is at ${packageVersion}, the tag says ${version}.`);
if (!notes) problems.push(`CHANGELOG.md has no "## [${version}]" section.`);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

if (check) {
  console.log(`v${version}: package.json and CHANGELOG.md agree.`);
} else {
  console.log(
    [
      notes,
      '',
      '### Install',
      '',
      '- **Chrome:** download `fastmail-assist-chrome-*.zip`, unzip it, open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and choose the unzipped folder.',
      '- **Firefox:** download `fastmail-assist-firefox-*.zip`; load it as a temporary add-on from `about:debugging#/runtime/this-firefox`, or sign it as an unlisted add-on for a permanent install. `fastmail-assist-source-*.zip` is the matching source, for the add-on review.',
      '',
      'Then open the extension settings and follow the setup in the README. The extension cannot send mail: it only saves drafts or writes into the draft you have open.',
    ].join('\n'),
  );
}
