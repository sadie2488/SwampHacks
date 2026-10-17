// Shared helpers for the Claude Code hooks. Node only, so it works on Windows, Mac and Linux.
// Hook hygiene: read stdin first, keep stdout quiet, send messages to stderr, exit 2 to block.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

export function readInput() {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    /* no stdin */
  }
  return raw.trim() ? JSON.parse(raw) : {};
}

export function block(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

export function repoRoot(input) {
  const start = resolve(input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  try {
    return resolve(
      execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: start, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
    );
  } catch {
    return resolve(process.env.CLAUDE_PROJECT_DIR || start);
  }
}

// Path relative to the repo with forward slashes. null = outside the repo. '' = the repo root itself.
export function toRepoRelative(p, root, cwd) {
  let s = String(p);
  if (process.platform === 'win32') s = s.replace(/^\/([a-zA-Z])\//, '$1:/'); // Git Bash style /c/Users/...
  const abs = isAbsolute(s) ? resolve(s) : resolve(cwd || root, s);
  const rel = relative(root, abs).replace(/\\/g, '/');
  if (rel === '') return '';
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return null;
  return rel;
}

export function globToRegExp(glob) {
  let g = String(glob).replace(/\\/g, '/');
  if (g.startsWith('/')) g = g.slice(1); // '/*' = files directly in the repo root
  let re = '';
  for (let i = 0; i < g.length; ) {
    if (g.startsWith('**/', i)) {
      re += '(?:.*/)?';
      i += 3;
    } else if (g.startsWith('/**', i) && i + 3 === g.length) {
      re += '(?:/.*)?';
      i += 3;
    } else if (g.startsWith('**', i)) {
      re += '.*';
      i += 2;
    } else if (g[i] === '*') {
      re += '[^/]*';
      i += 1;
    } else if (g[i] === '?') {
      re += '[^/]';
      i += 1;
    } else {
      re += g[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${re}$`, 'i');
}

export const matchesAny = (rel, globs) => (globs || []).some((g) => globToRegExp(g).test(rel));

// Files that hold secrets: .env files (not the .example template), key folders, key files, the email relay secrets file.
export function isSecretPath(token) {
  const p = String(token).replace(/\\/g, '/').replace(/^[>]+/, '');
  const base = p.split('/').pop() || '';
  if (/^\.env(\..+)?$/i.test(base) && !/^\.env\.(example|sample|template)$/i.test(base)) return true;
  if (/(^|\/)\.(ssh|aws|gnupg)(\/|$)/.test(p)) return true;
  return /^id_(rsa|ed25519|ecdsa|dsa)$/i.test(base) || /\.(pem|key|p12|pfx)$/i.test(base) || /^relay\.private\.json$/i.test(base);
}

// A glob or pattern such as "**/.env*" that could match a secrets file.
export function globTargetsSecret(glob) {
  const base = String(glob).replace(/\\/g, '/').split('/').pop() || '';
  if (/^\.env/i.test(base) && !/^\.env\.(example|sample|template)$/i.test(base)) return true;
  return isSecretPath(glob) || /relay\.private|\.(pem|key)$|id_rsa|id_ed25519/i.test(base);
}

// Code passed inline to an interpreter (node -e, python -c, powershell -Command) that names a secrets file.
export function codeMentionsSecret(code) {
  const re = /(?:^|[\s'"`/\\=(,])(\.env(?:\.[A-Za-z0-9_-]+)?)(?=$|[\s'"`)\],;])/g;
  for (const m of String(code).matchAll(re)) if (isSecretPath(m[1])) return true;
  return /relay\.private\.json|[/\\]\.(ssh|aws|gnupg)[/\\]|id_(rsa|ed25519)\b/i.test(code);
}

// Wording that credits an AI in a commit or PR. Claude is never a contributor on GitHub.
export const AI_CREDIT = [
  /co-authored-by/i,
  /generated (with|by)\b/i,
  /🤖/,
  /claude[- ]session/i,
  /noreply@anthropic\.com/i,
  /@anthropic\.com/i,
  /\bclaude\s*</i,
];
// AI-specific only (used where a human co-author trailer is legitimate, e.g. a squash-merge on main).
export const AI_CREDIT_STRICT = AI_CREDIT.filter((re) => !/co-authored-by/i.test(re.source));
export const AI_IDENTITY = /claude|anthropic/i;

// Throws on invalid JSON so callers can fail closed. Missing file -> fallback.
export function loadJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

// A human-approved, time-boxed override (written by Claude only after the person said yes; logged by the lead).
// Shape: { allow_paths: [globs], allow_rules: ["push-main", ...], expires: ISO time, reason, approved_by }
export function activeOverride(root) {
  try {
    const ov = loadJson(join(root, '.claude', 'override.local.json'), null);
    if (ov && ov.expires && Date.parse(ov.expires) > Date.now()) return ov;
  } catch {
    /* broken override file = no override */
  }
  return null;
}

export const ruleAllowed = (ov, id) => Boolean(ov && Array.isArray(ov.allow_rules) && ov.allow_rules.includes(id));
