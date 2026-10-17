#!/usr/bin/env node
// Ask a person a question: at the keyboard first, then by email after 3 minutes, and the first answer wins.
// The always-on daemon (scripts/relay/daemon.mjs) does the emailing; this tool only reads and writes the shared state.
//
//   node scripts/ask-human.mjs ask "Question text"                 -> prints the question id; ask it in the chat too
//   node scripts/ask-human.mjs answer <id> "answer" [--by Name]    -> someone answered at the keyboard
//   node scripts/ask-human.mjs status <id>                         -> the full record (state: waiting | emailed | answered)
//   node scripts/ask-human.mjs wait <id> [--seconds 600]           -> waits for an answer, prints it (exit 3 if none yet)
//   node scripts/ask-human.mjs inbox [--take]                      -> commands that arrived by email ([MUSIC] checkin ...)
//   node scripts/ask-human.mjs confirm-request "what to approve"   -> emails a code; a person replies "CONFIRM <code>"
//   node scripts/ask-human.mjs confirm-status <code>               -> pending | confirmed
//   node scripts/ask-human.mjs send-test                           -> sends one test email to check the setup works
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelay } from './relay/core.mjs';
import { loadConfig } from './relay/lib.mjs';
import { FileStore } from './relay/store.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(name);
  if (i < 0) return null;
  return rest.splice(i, 2)[1] ?? true;
};
const takeFlag = rest.includes('--take') ? (rest.splice(rest.indexOf('--take'), 1), true) : false;
const by = flag('--by');
const seconds = Number(flag('--seconds')) || 600;
const say = (o) => console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 2));
const die = (msg, code = 1) => (console.error(msg), process.exit(code));

let config = null;
try {
  config = loadConfig(join(root, 'relay.private.json'));
} catch (e) {
  config = null;
  if (['confirm-request', 'send-test'].includes(cmd)) die(e.message);
}
const store = new FileStore(process.env.RELAY_STATE_DIR || join(root, 'scratch', 'relay'));
const cfg = config ?? { allowed: [], sendTo: [], maxPerHour: 10, waitMinutes: 3 };
let relay = createRelay({ config: cfg, store, transport: { send: async () => die('no mail transport') }, mailbox: { fetchNew: async () => [], markSeen: async () => {} } });

const daemonAlive = () => Date.now() - (store.read('daemon', { t: 0 }).t ?? 0) < 60_000;

switch (cmd) {
  case 'ask': {
    const text = rest.join(' ').trim();
    if (!text) die('usage: ask "question text"');
    const { id } = relay.ask(text);
    say({ id, note: !config ? 'email relay not set up: this will only be asked at the keyboard' : daemonAlive() ? `will be emailed if unanswered after ${cfg.waitMinutes} minutes` : 'email relay daemon is NOT running: start it with: node scripts/relay/daemon.mjs' });
    break;
  }
  case 'answer': {
    const [id, ...words] = rest;
    if (!id || !words.length) die('usage: answer <id> "answer" [--by Name]');
    const r = relay.recordAnswer(id, words.join(' '), by || 'keyboard', 'keyboard');
    if (r.ok) say({ ok: true });
    else if (r.reason === 'already answered') {
      say({ ok: false, reason: 'already answered', existing: r.existing });
      process.exit(3); // someone (probably by email) was first: use their answer
    } else die(r.reason);
    break;
  }
  case 'status': {
    const q = relay.status(rest[0]);
    if (!q) die(`no question ${rest[0]}`);
    say(q);
    break;
  }
  case 'wait': {
    const end = Date.now() + seconds * 1000;
    for (;;) {
      const q = relay.status(rest[0]);
      if (!q) die(`no question ${rest[0]}`);
      if (q.state === 'answered') (say({ answer: q.answer, by: q.answeredBy, via: q.answeredVia }), process.exit(0));
      if (Date.now() >= end) (say({ state: q.state, answer: null }), process.exit(3));
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  case 'inbox': {
    say(takeFlag ? relay.takeInbox() : relay.inbox());
    break;
  }
  case 'confirm-request': {
    const { makeGmail } = await import('./relay/transport.mjs');
    const { transport, mailbox } = makeGmail(config);
    relay = createRelay({ config, store, transport, mailbox });
    say(await relay.requestConfirmation(rest.join(' ')));
    break;
  }
  case 'confirm-status': {
    say(relay.confirmStatus(rest[0]) ?? die(`no confirmation ${rest[0]}`));
    break;
  }
  case 'send-test': {
    const { makeGmail, explainMailError } = await import('./relay/transport.mjs');
    const { transport, mailbox } = makeGmail(config);
    relay = createRelay({ config, store, transport, mailbox });
    try {
      const r = await relay.sendMail({ subject: '[MUSIC] Test from the main laptop', text: 'If you can read this, the email relay can send. Reply to it with any text and start the subject with [MUSIC] to try the other direction.\n' });
      say(r.sent ? `sent a test email to: ${config.sendTo.join(', ')}` : `not sent (${r.reason})`);
    } catch (e) {
      die(explainMailError(e));
    }
    break;
  }
  default:
    die('commands: ask | answer | status | wait | inbox [--take] | confirm-request | confirm-status | send-test\nsee the top of scripts/ask-human.mjs', 2);
}
