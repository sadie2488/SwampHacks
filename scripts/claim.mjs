#!/usr/bin/env node
// Lead only. Record a task claim or release in tasks.json, ownership.json and docs/team.md.
// Usage:
//   node scripts/claim.mjs claim   <person> <taskId> [--slug words-for-branch] [--force]
//   node scripts/claim.mjs release <person> <taskId> [--done]
// Prints the branch name on a claim. Does not run git: the lead commits the three files itself.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = {
  tasks: join(root, 'tasks.json'),
  own: join(root, 'ownership.json'),
  team: join(root, 'docs', 'team.md'),
};
const fail = (msg, fix) => {
  console.error(`claim: ${msg}`);
  if (fix) console.error(`  fix: ${fix}`);
  process.exit(1);
};
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, o) => writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`);

const argv = process.argv.slice(2);
const flag = (n) => {
  const i = argv.indexOf(n);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
};
const slugIdx = argv.indexOf('--slug');
const slugArg = slugIdx >= 0 ? argv.splice(slugIdx, 2)[1] : null;
const force = flag('--force');
const done = flag('--done');
const [action, personRaw, taskId] = argv;
if (!['claim', 'release'].includes(action) || !personRaw || !taskId) {
  fail('missing arguments', 'node scripts/claim.mjs claim|release <person> <taskId> [--slug words] [--force] [--done]');
}
const person = personRaw.toLowerCase().replace(/[^a-z0-9_-]/g, '');

const tasksDoc = readJson(P.tasks);
const own = readJson(P.own);
const task = tasksDoc.tasks.find((t) => t.id === taskId);
if (!task) fail(`no task "${taskId}"`, `ids: ${tasksDoc.tasks.map((t) => t.id).join(' ')}`);
const lane = task.lane;
if (lane === 'lead' || !own.lanes[lane]) fail(`task ${taskId} is a lead task (lane "${lane}"), not claimable`);

let team = readFileSync(P.team, 'utf8');
const HEADER = '| Task | Who | Branch | Since |\n|---|---|---|---|\n';
const rowRe = (id) => new RegExp(`^\\| ${id.replace(/\./g, '\\.')}(?: [^|]*)? \\|.*\\n`, 'm');

if (action === 'claim') {
  if (task.claimed_by && task.claimed_by !== person) fail(`${taskId} is already claimed by ${task.claimed_by}`, 'pick another task or ask them to /handback');
  if (task.status === 'done') fail(`${taskId} is already done`);
  const existing = own.claims[lane];
  if (existing && existing.person !== person) fail(`lane "${lane}" is held by ${existing.person} (branch ${existing.branch})`, 'wait for their /handback or pick a task in another lane');
  if (existing && existing.person === person && !existing.branch.includes(`/${taskId}`)) {
    fail(`${person} still holds lane "${lane}" on ${existing.branch}`, 'run /handback for that task first');
  }
  const byId = new Map(tasksDoc.tasks.map((t) => [t.id, t]));
  const unmet = task.deps.filter((d) => !(byId.get(d)?.status === 'done' || byId.get(d)?.passes));
  if (unmet.length && !force) fail(`dependencies not finished yet: ${unmet.join(', ')}`, 'pick another task, or pass --force if the lead decides to override');

  const slug = (slugArg || task.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  const branch = `${lane}/${person}/${taskId}-${slug}`;
  const since = new Date().toISOString().slice(0, 16).replace('T', ' ');
  task.status = 'claimed';
  task.claimed_by = person;
  own.claims[lane] = { person, branch, since };
  team = team.replace(/^\| \(none yet\) \|.*\n/m, '');
  if (!rowRe(taskId).test(team)) team = team.replace(HEADER, `${HEADER}| ${taskId} ${task.title} | ${personRaw} | ${branch} | ${since} UTC |\n`);
  console.log(branch);
} else {
  if (task.claimed_by !== person) fail(`${taskId} is not claimed by ${person}`, task.claimed_by ? `it is held by ${task.claimed_by}` : 'nobody holds it');
  task.status = done ? 'done' : 'open';
  task.claimed_by = null;
  if (own.claims[lane]?.person === person) delete own.claims[lane];
  team = team.replace(rowRe(taskId), '');
  if (!/^\| \S/m.test(team.split('## Claimed tasks')[1]?.split('## Who to ask')[0].split('|---|---|---|---|')[1] ?? '')) {
    team = team.replace(HEADER, `${HEADER}| (none yet) | | | |\n`);
  }
  console.log(`released ${taskId}${done ? ' (done)' : ' (back to open)'}`);
}

writeJson(P.tasks, tasksDoc);
writeJson(P.own, own);
writeFileSync(P.team, team);
