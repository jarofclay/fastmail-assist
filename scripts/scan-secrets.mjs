// Looks for keys, tokens and real email addresses before they leave this
// machine. Run it before every push; `npm run check` and the pre-push hook
// (.githooks/pre-push) both do.
//
//   node scripts/scan-secrets.mjs          files in the working tree
//   node scripts/scan-secrets.mjs --push   also every commit not yet on a remote,
//                                          including commit messages
//
// A finding prints the file, line and rule, never the secret itself.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RULES = [
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{16,}/],
  ['Fastmail API token', /fmu\d-[A-Za-z0-9]{6,}-[A-Za-z0-9-]{12,}/],
  ['OpenAI API key', /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ['GitHub token', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['AWS access key', /(?:AKIA|ASIA)[0-9A-Z]{16}/],
  ['Slack token', /xox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['Private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Bearer token', /Bearer\s+[A-Za-z0-9._~+/-]{24,}/],
  ['JSON Web Token', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  [
    'Hard-coded credential',
    /(?:api[_-]?key|secret|token|passw(?:or)?d|authorization)["']?\s*[:=]\s*["'][A-Za-z0-9+/_=.-]{20,}["']/i,
  ],
];

// Addresses that are fine to commit: reserved example domains and the
// attribution address used in commit trailers.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const SAFE_EMAIL = /@(?:example\.(?:org|com|net)|[a-z0-9.-]+\.(?:invalid|test|example))$|^noreply@anthropic\.com$|^git@github\.com$/i;
// Package names such as vue@3.5.45 or @types/node@26.6.6 are not addresses.
const looksLikeVersion = (match) => /@\d+(?:\.\d+)+$/.test(match);

/** @returns {{ line: number, rule: string }[]} */
export function scanText(text, { emails = true } = {}) {
  const findings = [];
  text.split('\n').forEach((content, index) => {
    for (const [rule, pattern] of RULES) {
      if (pattern.test(content)) findings.push({ line: index + 1, rule });
    }
    if (!emails) return;
    for (const match of content.match(EMAIL) ?? []) {
      if (!SAFE_EMAIL.test(match) && !looksLikeVersion(match)) findings.push({ line: index + 1, rule: 'Email address outside the example domains' });
    }
  });
  return findings;
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

function scanWorkingTree() {
  const findings = [];
  for (const file of git('ls-files', '-co', '--exclude-standard', '-z').split('\0').filter(Boolean)) {
    let stat;
    try {
      stat = statSync(file);
    } catch {
      continue; // deleted but not yet staged
    }
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
    const buffer = readFileSync(file);
    if (buffer.subarray(0, 8000).includes(0)) continue; // binary
    // The lock file is full of package@version strings and registry hashes.
    const emails = file !== 'package-lock.json';
    for (const finding of scanText(buffer.toString('utf8'), { emails })) findings.push({ where: `${file}:${finding.line}`, rule: finding.rule });
  }
  return findings;
}

function scanUnpushedCommits() {
  const findings = [];
  const commits = git('rev-list', 'HEAD', '--not', '--remotes').split('\n').filter(Boolean);
  for (const commit of commits) {
    const short = commit.slice(0, 8);
    for (const finding of scanText(git('show', '-s', '--format=%B', commit))) {
      findings.push({ where: `commit ${short} message:${finding.line}`, rule: finding.rule });
    }
    let file = '';
    for (const line of git('show', '--format=', '--unified=0', '--no-color', commit).split('\n')) {
      if (line.startsWith('+++ ')) file = line.slice(6);
      else if (line.startsWith('+')) {
        for (const finding of scanText(line.slice(1), { emails: file !== 'package-lock.json' })) {
          findings.push({ where: `commit ${short} ${file}`, rule: finding.rule });
        }
      }
    }
  }
  return { findings, commits: commits.length };
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  const findings = scanWorkingTree();
  let note = 'working tree';
  if (process.argv.includes('--push')) {
    const unpushed = scanUnpushedCommits();
    findings.push(...unpushed.findings);
    note += ` and ${unpushed.commits} unpushed commit${unpushed.commits === 1 ? '' : 's'}`;
  }
  if (findings.length > 0) {
    console.error(`Secret scan found ${findings.length} problem${findings.length === 1 ? '' : 's'} (${note}):`);
    for (const finding of findings) console.error(`  ${finding.where}  ${finding.rule}`);
    console.error('Remove them (and rewrite the commit if already committed) before pushing.');
    process.exit(1);
  }
  console.log(`Secret scan clean (${note}).`);
}
