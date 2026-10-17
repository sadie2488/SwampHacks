// PreToolUse on Bash and PowerShell. Blocks the commands the team agreed are never OK:
// push to main, force push, skipping checks, changing hook paths, rm -rf, pipe-to-shell,
// reading secrets, pasting keys, and any AI credit line in a commit or PR (Claude is never a contributor).
// Early warning only: CI is the real gate. Fails closed: if unsure, it blocks and says why.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { activeOverride, block, readInput, repoRoot, ruleAllowed } from './lib.mjs';

const AI_CREDIT = [
  /co-authored-by/i,
  /generated (with|by)\b/i,
  /🤖/,
  /claude[- ]session/i,
  /noreply@anthropic\.com/i,
  /@anthropic\.com/i,
  /\bclaude\s*</i,
];
const INLINE_SECRET = /(AKIA[0-9A-Z]{16}|\bsk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const READ_WORDS = new Set(['cat', 'type', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'sed', 'awk', 'cp', 'mv', 'copy', 'xcopy', 'source', '.', 'get-content', 'gc', 'select-string', 'sls', 'base64', 'xxd', 'od', 'strings', 'bat', 'findstr', 'tee', 'nano', 'vim', 'code']);
const GIT_SECRET_SUBS = new Set(['add', 'stage', 'show', 'cat-file', 'diff', 'blame']);
const MESSAGE_SUBS = new Set(['commit', 'tag', 'merge', 'notes']);
const RM_WORDS = new Set(['rm', 'rmdir', 'del', 'erase', 'rd', 'remove-item', 'ri']);

const tokenize = (s) => [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
const wordOf = (t) => String(t || '').replace(/\\/g, '/').split('/').pop().replace(/\.exe$/i, '').toLowerCase();

function isSecretPath(token) {
  const p = String(token).replace(/\\/g, '/').replace(/^[>]+/, '');
  const base = p.split('/').pop() || '';
  if (/^\.env(\..+)?$/i.test(base) && !/^\.env\.(example|sample|template)$/i.test(base)) return true;
  if (/(^|\/)\.(ssh|aws|gnupg)(\/|$)/.test(p)) return true;
  return /^id_(rsa|ed25519|ecdsa|dsa)$/i.test(base) || /\.(pem|key|p12|pfx)$/i.test(base) || /^relay\.private\.json$/i.test(base);
}

function parseGit(tokens, i) {
  let j = i + 1;
  let dir = null;
  while (j < tokens.length && tokens[j].startsWith('-')) {
    if (tokens[j] === '-C') {
      dir = tokens[j + 1];
      j += 2;
    } else if (['-c', '--git-dir', '--work-tree'].includes(tokens[j])) j += 2;
    else j += 1;
  }
  return { sub: tokens[j], args: tokens.slice(j + 1), dir };
}

function currentBranch(cwd) {
  try {
    return execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

try {
  const input = readInput();
  const command = String(input.tool_input?.command ?? '');
  if (!command.trim()) process.exit(0);
  const cwd = resolve(input.cwd || process.cwd());
  const ov = activeOverride(repoRoot(input));
  const deny = (id, msg) => {
    if (!ruleAllowed(ov, id)) block(`${msg} (rule: ${id}). If a person really wants this, they can say "override".`);
  };

  // ---- whole-command checks ----
  if (
    /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\n;&]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/i.test(command) ||
    /\|\s*(?:iex|invoke-expression)\b/i.test(command) ||
    /\b(?:ba|z)?sh\b[^\n]*(?:\$\(|<\()\s*(?:curl|wget)\b/i.test(command)
  ) {
    deny('pipe-to-shell', 'Running a downloaded script straight in a shell is blocked. Download it, read it, then run it');
  }
  if (INLINE_SECRET.test(command)) {
    deny('inline-secret', 'That command contains what looks like a key or private key. Never put keys in commands; type them yourself into the private file');
  }
  if (/GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL)=\S*(claude|anthropic)/i.test(command)) {
    deny('ai-identity', 'Commits must use a person\'s own git identity, never an AI name');
  }

  // ---- per-segment checks ----
  const segments = command.split(/\|\||&&|[;|\n]/);
  let isMessageCommand = /\bgh\s+(pr|issue|release)\s+(create|edit|comment|review|merge)\b/i.test(command);
  for (const seg of segments) {
    const tokens = tokenize(seg);
    // rm -rf and friends (scan every word, so `if (...) { rm -rf x }` is caught too)
    for (let i = 0; i < tokens.length; i++) {
      const w = wordOf(tokens[i]);
      if (!RM_WORDS.has(w)) continue;
      const rest = tokens.slice(i + 1);
      const low = rest.map((t) => t.toLowerCase());
      let r = false;
      let f = false;
      if (w === 'rm') {
        for (const t of rest) {
          if (t === '--recursive') r = true;
          else if (t === '--force') f = true;
          else if (/^-[a-zA-Z]+$/.test(t)) {
            if (/[rR]/.test(t)) r = true;
            if (/f/.test(t)) f = true;
          }
        }
      } else {
        r = low.some((t) => t === '-recurse' || t === '-r' || t === '/s');
        f = low.some((t) => t === '-force' || t === '-fo' || t === '-f' || t === '/q');
      }
      if (r && f) deny('rm-rf', 'Deleting folders recursively and by force is blocked. Delete specific files, or ask the lead');
    }

    // find `git` (possibly after sudo/env/VAR=x)
    const gi = tokens.findIndex((t) => wordOf(t) === 'git');
    if (gi !== -1 && gi <= 3) {
      const { sub, args, dir } = parseGit(tokens, gi);
      const gitCwd = dir ? resolve(cwd, dir) : cwd;
      const text = seg;
      if (/core\.hookspath/i.test(text)) deny('hooks-path', 'Changing the git hooks path would switch off the project checks');
      if (/user\.(name|email)[ =]\S*(claude|anthropic)/i.test(text) || /--author[= ]\S*(claude|anthropic)/i.test(text)) {
        deny('ai-identity', 'Commits must use a person\'s own git identity, never an AI name');
      }
      if (['commit', 'push', 'merge', 'rebase', 'pull', 'cherry-pick', 'am'].includes(sub)) {
        if (args.includes('--no-verify') || (sub === 'commit' && args.some((a) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(a)))) {
          deny('no-verify', 'Skipping the checks (--no-verify) is blocked. Fix what the check reports instead');
        }
      }
      if (MESSAGE_SUBS.has(sub)) isMessageCommand = true;

      if (sub === 'push') {
        const flags = args.filter((a) => a.startsWith('-'));
        const pos = args.filter((a) => !a.startsWith('-'));
        if (flags.some((f) => f === '--force' || (/^-[a-zA-Z]+$/.test(f) && f.includes('f'))) || pos.some((p) => p.startsWith('+'))) {
          deny('force-push', 'Force-pushing can erase other people\'s work, so it is blocked');
        }
        if (flags.includes('--delete') || flags.includes('-d') || pos.some((p) => p.startsWith(':'))) {
          deny('delete-branch', 'Deleting remote branches is blocked. Ask the lead');
        }
        if (flags.includes('--all') || flags.includes('--mirror')) deny('push-main', 'That push would include main. Push only your own branch');
        const specs = pos.slice(1);
        const isMain = (b) => /^(main|master)$/.test(b);
        if (specs.length === 0) {
          if (isMain(currentBranch(gitCwd))) deny('push-main', 'You are on main. Pushing to main is not allowed: switch to your task branch and open a pull request');
        }
        for (const spec of specs) {
          const dest = (spec.includes(':') ? spec.split(':').pop() : spec).replace(/^\+/, '').replace(/^refs\/heads\//, '');
          if (isMain(dest)) deny('push-main', 'Pushing to main is not allowed. Push your task branch and open a pull request; the lead merges');
          if (dest === 'HEAD' && !spec.includes(':') && isMain(currentBranch(gitCwd))) {
            deny('push-main', 'You are on main. Pushing to main is not allowed: switch to your task branch and open a pull request');
          }
        }
      }
      if (GIT_SECRET_SUBS.has(sub) && args.some(isSecretPath)) {
        deny('read-secrets', 'That would put a secrets file into git or the chat. Keys stay in the private file');
      }
    }

    // reading or writing secret files from the shell
    const first = tokens.findIndex((t) => READ_WORDS.has(wordOf(t)));
    if (first !== -1 && tokens.slice(first + 1).some((t) => !t.startsWith('-') && isSecretPath(t))) {
      deny('read-secrets', 'That reads a file that holds secrets. Keys stay in the private file and never go into chat');
    }
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const target = /^>>?$/.test(t) ? tokens[i + 1] : /^>>?\S/.test(t) ? t.replace(/^>>?/, '') : null;
      if (target && isSecretPath(target)) deny('read-secrets', 'Writing into a secrets file from the chat is blocked. Type keys yourself into the private file');
    }
  }

  // ---- AI credit in commit / PR text (Claude is never a contributor) ----
  if (isMessageCommand) {
    let text = command;
    const tokens = tokenize(command);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      let path = null;
      if (t === '-F' || t === '--file' || t === '--body-file') path = tokens[i + 1];
      else if (/^--(file|body-file)=/.test(t)) path = t.split('=').slice(1).join('=');
      if (path && path !== '-') {
        const full = resolve(cwd, path);
        try {
          if (existsSync(full) && statSync(full).size < 200_000) text += `\n${readFileSync(full, 'utf8')}`;
        } catch {
          /* unreadable file: CI still checks the final commit */
        }
      }
    }
    if (AI_CREDIT.some((re) => re.test(text))) {
      deny('ai-credit', 'Commits and pull requests must not credit an AI: no Co-Authored-By, no "Generated with", no Claude name or link. Remove that line and run it again');
    }
  }
  process.exit(0);
} catch (e) {
  block(`The command guard hit an error (${e.message}), so I stopped to be safe. Nothing was run. Tell the lead.`);
}
