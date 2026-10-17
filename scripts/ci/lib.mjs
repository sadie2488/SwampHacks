// Shared helpers for the CI check scripts. Messages say what is wrong and how to fix it.
import { execFileSync } from 'node:child_process';

export { AI_CREDIT, AI_CREDIT_STRICT, AI_IDENTITY, globToRegExp, isSecretPath, matchesAny } from '../../.claude/hooks/lib.mjs';

export const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();

// File content at a commit, or null if it does not exist there.
export function showAt(ref, path) {
  try {
    return git('show', `${ref}:${path}`);
  } catch {
    return null;
  }
}

// [{ status: 'A'|'M'|'D'|'T', path }] between two commits (renames count as a delete plus an add).
export function changedFiles(base, head, filter = '') {
  const args = ['diff', '--name-status', '--no-renames'];
  if (filter) args.push(`--diff-filter=${filter}`);
  args.push(`${base}...${head}`);
  return git(...args)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split('\t');
      return { status, path: rest.join('\t') };
    });
}

// Lines in the pull request text like:  Override: web/src/app/** | approved by Lalitha
export function parseOverrides(body = '') {
  return [...String(body).matchAll(/^\s*Override:\s*(\S+)\s*\|\s*approved by\s+(.+?)\s*$/gim)].map((m) => ({ glob: m[1], by: m[2] }));
}

const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
export function fail(title, message) {
  console.log(`::error title=${esc(title)}::${esc(message)}`); // shows on the pull request
  console.log(`FAIL ${title}: ${message}`); // shows in the log
}
export const notice = (title, message) => console.log(`::notice title=${esc(title)}::${esc(message)}`);

export function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    console.log(`FAIL missing environment: ${missing.join(', ')} (CI sets these from the pull request)`);
    process.exit(1);
  }
}
