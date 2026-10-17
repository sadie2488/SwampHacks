// CI: the branch name decides the lane, and the pull request may only change that lane's folders.
// Rules are read from ownership.json on the BASE branch, so a pull request can't change its own rules.
// Env: BASE_SHA, HEAD_SHA, BRANCH (head branch name), PR_BODY (for "Override:" lines).
import { changedFiles, fail, matchesAny, notice, parseOverrides, requireEnv, showAt } from './lib.mjs';

requireEnv('BASE_SHA', 'HEAD_SHA', 'BRANCH');
const { BASE_SHA, HEAD_SHA, BRANCH, PR_BODY = '' } = process.env;

const raw = showAt(BASE_SHA, 'ownership.json');
if (!raw) {
  notice('Ownership', 'No ownership.json on the base branch yet, so there is nothing to enforce.');
  process.exit(0);
}
const own = JSON.parse(raw);
const lanes = Object.keys(own.lanes);
const prefix = BRANCH.split('/')[0];
const errors = [];

if (prefix === 'comms') {
  fail('Wrong branch', 'The comms branch is for messages and is never merged. Close this pull request.');
  process.exit(1);
}
const isLead = prefix === 'lead';
if (!isLead && !own.lanes[prefix]) {
  fail('Unknown branch name', `Branch "${BRANCH}" must start with a lane name or "lead/". Rename it to <lane>/<person>/<task-id> (lanes: ${lanes.join(', ')}) or lead/<task-id>.`);
  process.exit(1);
}

const overrides = parseOverrides(PR_BODY);
for (const { path } of changedFiles(BASE_SHA, HEAD_SHA)) {
  const ov = overrides.find((o) => matchesAny(path, [o.glob]));
  if (ov) {
    notice('Override used', `${path} allowed by an override approved by ${ov.by}. The lead logs it in docs/decisions.md.`);
    continue;
  }
  if (matchesAny(path, own.anyone)) continue;
  if (isLead) {
    for (const [name, claim] of Object.entries(own.claims || {})) {
      if (matchesAny(path, own.lanes[name]?.paths)) {
        errors.push(`${path} belongs to ${claim.person} (lane ${name}, branch ${claim.branch}). Lead branches can't touch a claimed lane until they hand it back.`);
      }
    }
    continue;
  }
  if (matchesAny(path, own.lanes[prefix].paths)) continue;
  errors.push(
    matchesAny(path, own.lead_only)
      ? `${path} is a lead-only file. Remove it from this pull request and ask the lead (/ask).`
      : `${path} is outside lane "${prefix}". Move that change to the right lane's branch, or ask the lead (/ask).`,
  );
}

if (errors.length) {
  fail('Folder ownership', `${errors.length} file(s) outside your folders:\n${errors.slice(0, 20).join('\n')}\nIf a person really approves this, add a line to the pull request text:  Override: <path or glob> | approved by <name>`);
  process.exit(1);
}
console.log(`ownership ok: branch "${BRANCH}" (${isLead ? 'lead' : `lane ${prefix}`})`);
