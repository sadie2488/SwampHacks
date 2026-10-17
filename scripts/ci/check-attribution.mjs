// CI: Claude (or any AI) is never credited or listed as a contributor.
// Checks every commit on the branch (message, author, committer), the pull request title and body,
// and the lines this change adds to non-lead files.
// Env: BASE_SHA, HEAD_SHA, PR_TITLE, PR_BODY, EVENT_NAME ("push" on main: human co-author lines from squash merges are allowed).
import { AI_CREDIT, AI_CREDIT_STRICT, AI_IDENTITY, changedFiles, fail, git, matchesAny, parseOverrides, requireEnv, showAt } from './lib.mjs';

requireEnv('HEAD_SHA');
const { BASE_SHA = '', HEAD_SHA, PR_TITLE = '', PR_BODY = '', EVENT_NAME = 'pull_request' } = process.env;
const patterns = EVENT_NAME === 'push' ? AI_CREDIT_STRICT : AI_CREDIT;
const CONTENT = [/generated (?:with|by) \[?claude/i, /co-authored-by:.*(?:claude|anthropic)/i, /noreply@anthropic\.com/i, /claude\.ai\/code\/session/i, /🤖 generated/i];
const problems = [];

// ---- commits ----
const noBase = !BASE_SHA || /^0+$/.test(BASE_SHA);
const shas = (noBase ? git('rev-list', '--no-merges', '-n', '20', HEAD_SHA) : git('rev-list', '--no-merges', `${BASE_SHA}..${HEAD_SHA}`)).split('\n').filter(Boolean);
for (const sha of shas) {
  const [an, ae, cn, ce, msg] = git('show', '-s', '--format=%an%x1f%ae%x1f%cn%x1f%ce%x1f%B', sha).split('\x1f');
  const short = sha.slice(0, 7);
  if ([an, ae, cn, ce].some((x) => AI_IDENTITY.test(x))) {
    problems.push(`commit ${short}: author/committer is "${an} <${ae}>" / "${cn} <${ce}>". Use the person's own git identity (git config user.name / user.email), then rewrite the commit.`);
  }
  const hit = patterns.find((re) => re.test(msg));
  if (hit) problems.push(`commit ${short}: the message credits an AI (matches ${hit}). Remove that line from the message.`);
}

// ---- PR text ----
for (const [label, text] of [['title', PR_TITLE], ['description', PR_BODY]]) {
  const hit = patterns.find((re) => re.test(text));
  if (hit) problems.push(`The pull request ${label} credits an AI (matches ${hit}). Edit it and remove that line.`);
}

// ---- added lines in non-lead files (docs and code comments written by workers) ----
const ownRaw = showAt(noBase ? HEAD_SHA : BASE_SHA, 'ownership.json');
if (ownRaw && !noBase) {
  const leadOnly = JSON.parse(ownRaw).lead_only || [];
  for (const { path } of changedFiles(BASE_SHA, HEAD_SHA, 'AM')) {
    if (matchesAny(path, leadOnly)) continue;
    const added = git('diff', '-U0', `${BASE_SHA}...${HEAD_SHA}`, '--', path).split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    const bad = added.find((l) => CONTENT.some((re) => re.test(l)));
    if (bad) problems.push(`${path}: contains an AI credit line (${bad.slice(1, 80).trim()}). Remove it.`);
  }
}

const ov = parseOverrides(PR_BODY);
if (problems.length && ov.some((o) => o.glob === 'attribution')) {
  console.log(`attribution: ${problems.length} problem(s) allowed by an override approved by ${ov.find((o) => o.glob === 'attribution').by}`);
  process.exit(0);
}
if (problems.length) {
  fail('AI credit found', `${problems.length} problem(s):\n${problems.slice(0, 20).join('\n')}\nThe rule: Claude is never credited as an author, co-author or contributor. No Co-Authored-By, no "Generated with", no Claude link.`);
  process.exit(1);
}
console.log(`attribution ok: ${shas.length} commit(s) checked, plus PR title and description`);
