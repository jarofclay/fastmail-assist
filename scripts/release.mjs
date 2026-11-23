// Tags a release locally, after the same checks the release workflow runs:
//
//   npm run release
//
// Needs a clean working tree, a package.json version that is not tagged yet,
// and a matching section in CHANGELOG.md. It runs `npm run check`, creates an
// annotated tag v<version>, and prints the push command. Pushing the tag is
// what publishes the release (see .github/workflows/release.yml); that step
// is left to you on purpose.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });

const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const tag = `v${version}`;

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (run('git', ['status', '--porcelain']).trim()) fail('The working tree has uncommitted changes. Commit or stash them first.');
if (run('git', ['tag', '--list', tag]).trim()) fail(`Tag ${tag} already exists. Bump the version in package.json (npm version <new> --no-git-tag-version) and add a CHANGELOG.md section.`);
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
if (branch !== 'main') console.warn(`Note: you are on branch "${branch}", not main.`);

run('node', ['scripts/release-notes.mjs', '--check', tag], { stdio: 'inherit' });
run('npm', ['run', 'check'], { stdio: 'inherit' });

run('git', ['tag', '-a', tag, '-m', `Fastmail Assist ${tag}`], { stdio: 'inherit' });
console.log(`\nTagged ${tag}. To publish the release, push the tag:\n\n  git push origin ${tag}\n\nThe Release workflow then builds both zips and attaches them to the GitHub release.`);
