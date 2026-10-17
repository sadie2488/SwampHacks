// The email relay's logic, tested with fake mail (no network, no password needed).
// Run: node --test "tests/**/*.test.mjs"
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRelay } from '../scripts/relay/core.mjs';
import { classifyInbound, isAllowedSender, isAuthentic, loadConfig, makeCode, normalizeAddress, parseSubject, stripReply } from '../scripts/relay/lib.mjs';
import { MemoryStore } from '../scripts/relay/store.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SADIE = 'sadie@gmail.com';
const VEDA = 'veda@gmail.com';
const SHAYAAN = 'shayaan@gmail.com';
const STRANGER = 'stranger@evil.example';
const config = { gmailAddress: SADIE, appPassword: 'x'.repeat(16), allowed: [SADIE, VEDA, SHAYAAN], sendTo: [SADIE, VEDA, SHAYAAN], maxPerHour: 10, waitMinutes: 3 };
const auth = (domain = 'gmail.com') => `mx.google.com; dkim=pass header.i=@${domain} header.s=20230601 header.b=abc; spf=pass (google.com: domain of x@${domain} designates 1.2.3.4 as permitted sender) smtp.mailfrom=x@${domain}; dmarc=pass (p=NONE sp=QUARANTINE dis=NONE) header.from=${domain}`;

function setup(over = {}) {
  let t = 1_000_000_000;
  const sent = [];
  const queue = [];
  const seen = [];
  const logs = [];
  const relay = createRelay({
    config: { ...config, ...over },
    store: new MemoryStore(),
    transport: { send: async (m) => void sent.push(m) },
    mailbox: { fetchNew: async () => queue.splice(0), markSeen: async (uid) => void seen.push(uid) },
    now: () => t,
    log: (m) => logs.push(m),
  });
  return { relay, sent, queue, seen, logs, advance: (ms) => (t += ms), at: () => t };
}
let uid = 0;
const mail = (over) => ({ uid: ++uid, from: VEDA, subject: '[MUSIC] checkin', text: '', authResults: auth(), ...over });

// ---------------- pure helpers ----------------
test('codes use an alphabet without look-alike characters', () => {
  for (let i = 0; i < 200; i++) assert.match(makeCode(6), /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  assert.notEqual(makeCode(), makeCode());
});

test('addresses are compared without case or display names', () => {
  assert.equal(normalizeAddress('Sadie <Sadie@Gmail.com>'), 'sadie@gmail.com');
  assert.ok(isAllowedSender('Veda <VEDA@gmail.com>', config.allowed));
  assert.ok(!isAllowedSender(STRANGER, config.allowed));
});

test('only Gmail\'s own verdict is trusted, and the signature must match the sender\'s domain', () => {
  assert.ok(isAuthentic(auth(), 'veda@gmail.com'));
  assert.ok(isAuthentic([auth(), 'forged; dkim=fail'], 'veda@gmail.com'), 'the top header counts');
  assert.ok(!isAuthentic(undefined, 'veda@gmail.com'), 'no header');
  assert.ok(!isAuthentic(auth().replace('dkim=pass', 'dkim=fail'), 'veda@gmail.com'), 'dkim failed');
  assert.ok(!isAuthentic(auth().replace('spf=pass', 'spf=fail').replace('dmarc=pass', 'dmarc=fail'), 'veda@gmail.com'), 'no spf or dmarc');
  assert.ok(!isAuthentic(auth('evil.example'), 'veda@gmail.com'), 'signed by another domain');
  assert.ok(!isAuthentic(auth().replace('mx.google.com', 'mx.attacker.example'), 'veda@gmail.com'), 'not Gmail\'s header');
  assert.ok(!isAuthentic(auth('notgmail.com'), 'veda@gmail.com'), 'a look-alike domain');
});

test('replies are cut off before the quoted history', () => {
  assert.equal(stripReply('Yes, go ahead\n\nOn Sat, Oct 17 at 5:00 AM Sadie <s@gmail.com> wrote:\n> old text'), 'Yes, go ahead');
  assert.equal(stripReply('Answer\n> quoted\nmore'), 'Answer');
});

test('subjects are understood with Re: and Fwd: prefixes', () => {
  assert.deepEqual(parseSubject('[MUSIC] explain 5.3'), { command: 'explain', args: '5.3' });
  assert.deepEqual(parseSubject('Re: Fwd: [MUSIC] ask how do I start'), { command: 'ask', args: 'how do I start' });
  assert.equal(parseSubject('hello there'), null);
});

test('classifying incoming mail', () => {
  const open = [{ id: 'QAAAA', code: 'K7M2PQ' }];
  assert.equal(classifyInbound(mail({ from: STRANGER, authResults: auth() }), config).kind, 'ignore');
  assert.match(classifyInbound(mail({ from: STRANGER }), config).reason, /not on the allowed list/);
  assert.match(classifyInbound(mail({ authResults: undefined }), config).reason, /could not verify/);
  assert.match(classifyInbound(mail({ subject: 'lunch?' }), config).reason, /no \[MUSIC\] tag/);
  assert.deepEqual(classifyInbound(mail({ subject: '[MUSIC] checkin' }), config), { kind: 'command', from: VEDA, command: 'checkin', args: '' });
  assert.equal(classifyInbound(mail({ subject: '[MUSIC] ask how do I run tests?' }), config).args, 'how do I run tests?');
  const free = classifyInbound(mail({ subject: '[MUSIC] please slow the demo down', text: 'thanks' }), config);
  assert.equal(free.command, 'message');
  assert.match(free.args, /please slow the demo down/);
  const ans = classifyInbound(mail({ subject: 'Re: [MUSIC] Question QAAAA [code K7M2PQ]', text: 'Use the blue one\n\nOn Sat Sadie wrote:\n> The main laptop asked' }), config, open);
  assert.deepEqual(ans, { kind: 'answer', from: VEDA, questionId: 'QAAAA', answer: 'Use the blue one' });
  assert.equal(classifyInbound(mail({ subject: 'Re: [MUSIC] Question QAAAA [code K7M2PQ]', text: '' }), config, open).kind, 'ignore', 'empty answer');
  assert.deepEqual(classifyInbound(mail({ subject: 'Re: [MUSIC] Confirm', text: 'CONFIRM K7M2PQ' }), config), { kind: 'confirm', from: VEDA, code: 'K7M2PQ' });
});

// ---------------- config ----------------
test('config: the example file is rejected with a plain explanation, and the password is never repeated', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-cfg-'));
  try {
    assert.throws(() => loadConfig(join(dir, 'missing.json')), /not set up/);
    const f = join(dir, 'c.json');
    writeFileSync(f, readExample());
    assert.throws(() => loadConfig(f), /gmail_address.*app_password.*allowed_addresses/s);
    writeFileSync(f, JSON.stringify({ gmail_address: SADIE, app_password: 'abcd efgh ijkl mnop', allowed_addresses: ['A@x.com', VEDA] }));
    const c = loadConfig(f);
    assert.equal(c.appPassword, 'abcdefghijklmnop');
    assert.deepEqual(c.allowed, ['a@x.com', VEDA]);
    assert.equal(c.maxPerHour, 10);
    writeFileSync(f, JSON.stringify({ gmail_address: SADIE, app_password: 'tooshort-secret', allowed_addresses: [VEDA] }));
    try {
      loadConfig(f);
      assert.fail('should have thrown');
    } catch (e) {
      assert.doesNotMatch(e.message, /tooshort-secret/, 'a secret must never appear in an error message');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
const readExample = () => spawnSync(process.execPath, ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(join(REPO, 'relay.private.example.json'))}, 'utf8'))`], { encoding: 'utf8' }).stdout;

// ---------------- questions: keyboard first, email after the wait, first answer wins ----------------
test('a question answered at the keyboard in time is never emailed', async () => {
  const { relay, sent, advance } = setup();
  const { id } = relay.ask('Which song for the demo?');
  advance(2 * 60_000);
  assert.ok(relay.recordAnswer(id, 'Twinkle', 'Lalitha', 'keyboard').ok);
  advance(5 * 60_000);
  await relay.tick();
  assert.equal(sent.length, 0);
  assert.equal(relay.status(id).answer, 'Twinkle');
});

test('an unanswered question is emailed once after 3 minutes, with its code in the subject', async () => {
  const { relay, sent, advance } = setup();
  const { id, code } = relay.ask('Which song for the demo?');
  advance(2.9 * 60_000);
  await relay.tick();
  assert.equal(sent.length, 0, 'not yet');
  advance(0.2 * 60_000);
  await relay.tick();
  await relay.tick();
  assert.equal(sent.length, 1, 'exactly one email');
  assert.deepEqual(sent[0].to, config.sendTo);
  assert.ok(sent[0].subject.includes(`[code ${code}]`) && sent[0].subject.includes('[MUSIC]'));
  assert.match(sent[0].text, /Which song for the demo\?/);
  assert.doesNotMatch(JSON.stringify(sent[0]), /xxxxxxxxxxxxxxxx/, 'the app password is never in an email');
  assert.equal(relay.status(id).state, 'emailed');
});

test('first answer wins: an email answer beats a later keyboard answer, and a late email gets told', async () => {
  const { relay, sent, queue, seen, advance } = setup();
  const { id, code } = relay.ask('Approve the tests?');
  advance(4 * 60_000);
  await relay.tick();
  queue.push(mail({ from: VEDA, subject: `Re: [MUSIC] Question ${id} [code ${code}]`, text: 'approved' }));
  await relay.tick();
  assert.deepEqual({ a: relay.status(id).answer, by: relay.status(id).answeredBy, via: relay.status(id).answeredVia }, { a: 'approved', by: VEDA, via: 'email' });
  assert.ok(seen.length === 1, 'the reply is marked as read');
  const late = relay.recordAnswer(id, 'no wait', 'Lalitha', 'keyboard');
  assert.equal(late.ok, false);
  assert.equal(late.existing.answer, 'approved');
  // a second person replies later: told once that it was already answered
  queue.push(mail({ from: SHAYAAN, subject: `Re: [MUSIC] Question ${id} [code ${code}]`, text: 'rejected' }));
  await relay.tick();
  queue.push(mail({ from: SHAYAAN, subject: `Re: [MUSIC] Question ${id} [code ${code}]`, text: 'rejected again' }));
  await relay.tick();
  const notices = sent.filter((m) => /already answered/.test(m.subject));
  assert.equal(notices.length, 1);
  assert.deepEqual(notices[0].to, [SHAYAAN]);
  assert.equal(relay.status(id).answer, 'approved', 'the first answer stays');
});

test('a reply from a stranger or with a forged sender does not answer anything', async () => {
  const { relay, queue, advance, logs } = setup();
  const { id, code } = relay.ask('Delete the branch?');
  advance(4 * 60_000);
  await relay.tick();
  queue.push(mail({ from: STRANGER, subject: `Re: [MUSIC] Question ${id} [code ${code}]`, text: 'yes delete it' }));
  queue.push(mail({ from: VEDA, authResults: auth('evil.example'), subject: `Re: [MUSIC] Question ${id} [code ${code}]`, text: 'yes delete it' }));
  await relay.tick();
  assert.equal(relay.status(id).state, 'emailed');
  assert.equal(logs.filter((l) => /ignored an email/.test(l)).length, 2);
});

test('the hourly email limit holds, and held mail is sent later (not lost)', async () => {
  const { relay, sent, advance } = setup({ maxPerHour: 2 });
  const ids = [relay.ask('one').id, relay.ask('two').id, relay.ask('three').id];
  advance(4 * 60_000);
  await relay.tick();
  assert.equal(sent.length, 2, 'only two emails go out');
  assert.equal(relay.status(ids[2]).state, 'waiting');
  advance(61 * 60_000);
  await relay.tick();
  assert.equal(sent.length, 3, 'the held one goes out once the hour has passed');
});

// ---------------- heads-up when Claude is waiting ----------------
test('a heads-up is emailed only if no person typed since it was raised', async () => {
  const a = setup();
  a.relay.notify('Claude needs your input.');
  a.advance(4 * 60_000);
  await a.relay.tick();
  assert.equal(a.sent.length, 1);
  assert.match(a.sent[0].subject, /Heads-up/);

  const b = setup();
  b.relay.notify('Claude needs your input.');
  b.advance(2 * 60_000);
  b.relay.humanActive();
  b.advance(2 * 60_000);
  await b.relay.tick();
  assert.equal(b.sent.length, 0, 'a person was at the keyboard, so no email');
});

// ---------------- commands and confirmations by email ----------------
test('email commands are filed for the lead; others\' mail is untouched', async () => {
  const { relay, queue } = setup();
  queue.push(mail({ from: VEDA, subject: '[MUSIC] checkin' }));
  queue.push(mail({ from: SHAYAAN, subject: '[MUSIC] explain 5.3' }));
  queue.push(mail({ from: STRANGER, subject: '[MUSIC] checkin' }));
  await relay.tick();
  const items = relay.inbox();
  assert.deepEqual(items.map((i) => [i.from, i.command, i.args]), [[VEDA, 'checkin', ''], [SHAYAAN, 'explain', '5.3']]);
  assert.equal(relay.takeInbox().length, 2);
  assert.equal(relay.inbox().length, 0, 'taken items are gone');
});

test('an override by email needs CONFIRM with the one-time code', async () => {
  const { relay, sent, queue } = setup();
  const { code } = await relay.requestConfirmation('Let lane-c edit web/src/app/**');
  assert.match(sent[0].subject, new RegExp(`Confirm ${code}`));
  assert.equal(relay.confirmStatus(code).state, 'pending');
  queue.push(mail({ from: VEDA, subject: 'Re: [MUSIC] Confirm', text: 'CONFIRM WRONG1' }));
  await relay.tick();
  assert.equal(relay.confirmStatus(code).state, 'pending', 'wrong code does nothing');
  queue.push(mail({ from: STRANGER, subject: 'Re: [MUSIC] Confirm', text: `CONFIRM ${code}` }));
  await relay.tick();
  assert.equal(relay.confirmStatus(code).state, 'pending', 'a stranger can not confirm');
  queue.push(mail({ from: VEDA, subject: 'Re: [MUSIC] Confirm', text: `CONFIRM ${code}` }));
  await relay.tick();
  assert.equal(relay.confirmStatus(code).state, 'confirmed');
  assert.equal(relay.confirmStatus(code).confirmedBy, VEDA);
});

// ---------------- the command-line tool ----------------
test('ask-human works end to end on a scratch state folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-cli-'));
  try {
    const run = (...args) => spawnSync(process.execPath, [join(REPO, 'scripts', 'ask-human.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, RELAY_STATE_DIR: dir } });
    const asked = run('ask', 'Which', 'song?');
    assert.equal(asked.status, 0, asked.stderr);
    const { id } = JSON.parse(asked.stdout);
    assert.match(id, /^Q[A-Z0-9]{4}$/);
    assert.equal(JSON.parse(run('status', id).stdout).state, 'waiting');
    assert.equal(run('answer', id, 'Twinkle', '--by', 'Lalitha').status, 0);
    const waited = run('wait', id, '--seconds', '5');
    assert.equal(waited.status, 0);
    assert.deepEqual(JSON.parse(waited.stdout), { answer: 'Twinkle', by: 'Lalitha', via: 'keyboard' });
    const second = run('answer', id, 'Other');
    assert.equal(second.status, 3, 'a second answer is refused');
    assert.match(second.stdout, /already answered/);
    assert.equal(run('wait', 'QNOPE', '--seconds', '1').status, 1);
    assert.equal(run('bogus').status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the hooks write small files, never fail, and stay quiet when the relay is not set up', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-hook-'));
  try {
    const hook = (name, payload) => spawnSync(process.execPath, [join(REPO, '.claude', 'hooks', name)], { input: JSON.stringify({ cwd: dir, ...payload }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir, RELAY_STATE_DIR: join(dir, 'state') } });
    spawnSync('git', ['init', '-q'], { cwd: dir });
    assert.equal(hook('human-active.mjs', { hook_event_name: 'UserPromptSubmit' }).status, 0);
    // relay not set up -> nothing is recorded
    assert.equal(hook('notify.mjs', { hook_event_name: 'Notification', message: 'Claude needs your input' }).status, 0);
    assert.equal(spawnSync(process.execPath, ['-e', `process.stdout.write(String(require('fs').existsSync(${JSON.stringify(join(dir, 'state', 'questions.json'))})))`], { encoding: 'utf8' }).stdout, 'false');
    // relay set up -> a notification is recorded; an ordinary stop is not; a question is; key-like strings are hidden
    writeFileSync(join(dir, 'relay.private.json'), '{}');
    assert.equal(hook('notify.mjs', { hook_event_name: 'Notification', message: 'Needs input AIzaSyA1234567890abcdefghijklmnopqrstuv please' }).status, 0);
    assert.equal(hook('notify.mjs', { hook_event_name: 'Stop', last_assistant_message: 'All done.' }).status, 0);
    assert.equal(hook('notify.mjs', { hook_event_name: 'Stop', last_assistant_message: 'Which song should the demo use?' }).status, 0);
    const out = spawnSync(process.execPath, ['-e', `const q=JSON.parse(require('fs').readFileSync(${JSON.stringify(join(dir, 'state', 'questions.json'))},'utf8'));process.stdout.write(JSON.stringify(Object.values(q).map(x=>x.question)))`], { encoding: 'utf8' }).stdout;
    const texts = JSON.parse(out);
    assert.equal(texts.length, 2);
    assert.ok(texts.some((t) => /\[hidden\]/.test(t) && !/AIza/.test(t)));
    assert.ok(texts.some((t) => /Which song/.test(t)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the private file and its example are handled correctly by git', () => {
  const ignored = spawnSync('git', ['check-ignore', '-q', 'relay.private.json'], { cwd: REPO });
  assert.equal(ignored.status, 0, 'relay.private.json must be git-ignored');
  const example = spawnSync('git', ['check-ignore', '-q', 'relay.private.example.json'], { cwd: REPO });
  assert.equal(example.status, 1, 'the empty example must NOT be ignored');
});
