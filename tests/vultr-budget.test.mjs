// The Vultr budget watcher's decisions, tested with fake API answers (no network, no key needed).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MemoryStore } from '../scripts/relay/store.mjs';
import { createRelay } from '../scripts/relay/core.mjs';
import { alertText, checkOnce, describeResources, levelFor, makeFetchJson, readEnvValue, spentUsd } from '../scripts/vultr-budget.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'SECRETKEY-abcdefghijklmnop';

test('spent = credit + balance + pending charges (a negative balance is credit left)', () => {
  assert.equal(spentUsd({ balance: -100, pending_charges: 0 }), 0);
  assert.equal(spentUsd({ balance: -100, pending_charges: 12.5 }), 12.5);
  assert.equal(spentUsd({ balance: -60, pending_charges: 20 }), 60);
  assert.equal(spentUsd({ balance: 5, pending_charges: 1 }), 106, 'owing money means over the credit');
  assert.equal(spentUsd({}), 100, 'unknown fields never look like "nothing spent" by accident: handled by the shape check');
});

test('alert levels are $50, $75 and $90', () => {
  assert.deepEqual([0, 49.99, 50, 74.9, 75, 89.99, 90, 130].map(levelFor), [0, 0, 50, 50, 75, 75, 90, 90]);
});

test('alert wording: heads-up, then stop new usage, then danger with the list', () => {
  assert.match(alertText(50, 51), /heads-up/i);
  assert.match(alertText(75, 76), /STOP all new Vultr usage/);
  const danger = alertText(90, 92, 100, 'Servers (instances): 1\n   - web, vc2-1c-1gb');
  assert.match(danger, /DANGER/);
  assert.match(danger, /vc2-1c-1gb/);
});

function run(balances) {
  const store = new MemoryStore();
  const alerts = [];
  const logs = [];
  let i = 0;
  const fetchJson = async (path) => {
    if (path === '/v2/account') return { account: balances[Math.min(i++, balances.length - 1)] };
    if (path === '/v2/instances') return { instances: [{ label: 'demo-box', plan: 'vcg-a100-1c-6g-4vram', region: 'ewr', status: 'active' }], meta: {} };
    throw new Error('HTTP 404');
  };
  return { store, alerts, logs, check: () => checkOnce({ fetchJson, store, notify: async (t, l) => alerts.push([l, t]), log: (m) => logs.push(m) }) };
}

test('each level alerts once, even when checked again and again', async () => {
  const t = run([{ balance: -100, pending_charges: 10 }, { balance: -100, pending_charges: 51 }, { balance: -100, pending_charges: 52 }, { balance: -100, pending_charges: 76 }, { balance: -100, pending_charges: 92 }, { balance: -100, pending_charges: 95 }]);
  for (let n = 0; n < 6; n++) await t.check();
  assert.deepEqual(t.alerts.map((a) => a[0]), [50, 75, 90]);
});

test('the $90 alert lists what is running and flags a GPU', async () => {
  const t = run([{ balance: -100, pending_charges: 91 }]);
  await t.check();
  const text = t.alerts[0][1];
  assert.match(text, /demo-box/);
  assert.match(text, /GPU \(banned\)/);
  assert.match(text, /Object storage: could not check/, 'a failing list does not stop the alert');
});

test('a surprising answer from Vultr is an error with a plain explanation, not a silent "nothing spent"', async () => {
  const t = run([{ something: 'else' }]);
  await assert.rejects(() => t.check(), /shape I don't recognise/);
});

test('the API key never appears in errors or output', async () => {
  const f = makeFetchJson(KEY, async () => ({ status: 401, ok: false, json: async () => ({}) }));
  try {
    await f('/v2/account');
    assert.fail('should throw');
  } catch (e) {
    assert.doesNotMatch(e.message, new RegExp(KEY));
    assert.match(e.message, /refused the key/);
  }
  let sentAuth;
  const g = makeFetchJson(KEY, async (url, init) => ((sentAuth = init.headers.Authorization), { status: 200, ok: true, json: async () => ({ account: { balance: -100, pending_charges: 0 } }) }));
  await g('/v2/account');
  assert.equal(sentAuth, `Bearer ${KEY}`);
  const store = new MemoryStore();
  const out = [];
  await checkOnce({ fetchJson: g, store, notify: async (t) => out.push(t), log: (m) => out.push(m) });
  assert.doesNotMatch(out.join('\n'), new RegExp(KEY));
  assert.doesNotMatch(JSON.stringify(store.read('vultr-budget')), new RegExp(KEY));
});

test('only reads: the watcher never sends anything but GET requests', async () => {
  const methods = [];
  const f = makeFetchJson(KEY, async (url, init) => (methods.push(init.method ?? 'GET'), { status: 200, ok: true, json: async () => ({ instances: [] }) }));
  await describeResources(f);
  assert.ok(methods.length > 3);
  assert.ok(methods.every((m) => m === 'GET'));
});

test('.env lines are read without printing anything else', () => {
  const text = '# comment\nGEMINI_API_KEY=abc\nVULTR_API_KEY="quoted-value"\nexport OTHER=1\nEMPTY=\n';
  assert.equal(readEnvValue(text, 'VULTR_API_KEY'), 'quoted-value');
  assert.equal(readEnvValue(text, 'OTHER'), '1');
  assert.equal(readEnvValue(text, 'EMPTY'), undefined);
  assert.equal(readEnvValue(text, 'MISSING'), undefined);
});

test('with no key set, the command says what to do and exits', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vultr-nokey-')); // an empty folder: the real server/.env is never opened
  try {
    const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'vultr-budget.mjs'), '--once'], { encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, VULTR_BUDGET_ROOT: dir, RELAY_STATE_DIR: dir } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /VULTR_API_KEY is not in server\/\.env yet/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the relay sends an alert at once, not after the 3-minute wait, and only once', async () => {
  let t = 1_000_000_000;
  const sent = [];
  const relay = createRelay({
    config: { allowed: ['a@x.com'], sendTo: ['a@x.com'], maxPerHour: 10, waitMinutes: 3 },
    store: new MemoryStore(),
    transport: { send: async (m) => void sent.push(m) },
    mailbox: { fetchNew: async () => [], markSeen: async () => {} },
    now: () => t,
  });
  relay.alert('Vultr WARNING: $76.00 of $100 used.');
  await relay.tick();
  await relay.tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /ALERT/);
  assert.match(sent[0].text, /\$76\.00/);
});
