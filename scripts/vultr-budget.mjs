#!/usr/bin/env node
// Vultr budget watcher (main laptop). We have a $100 Vultr credit on a real card: do not go over it. See docs/vultr.md.
//   node scripts/vultr-budget.mjs            check once
//   node scripts/vultr-budget.mjs --watch    check every 30 minutes (leave it running in the background)
//   node scripts/vultr-budget.mjs --list     show what exists on the account (read-only), for cleanup
// Alerts at $50, $75 and $90 spent: printed here, and emailed through the email relay when it is set up.
// The API key (VULTR_API_KEY) is read from server/.env by this script only. It is never printed, logged, or sent anywhere
// except to api.vultr.com. This script only READS from Vultr; it can't create, change or delete anything.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LEVELS = [50, 75, 90];
const API = 'https://api.vultr.com';

// ---------- pure logic (tested) ----------
/** Dollars used so far. A negative balance means credit left, so credit + balance + pending charges = spent. */
export const spentUsd = (account, credit = 100) => credit + Number(account?.balance ?? 0) + Number(account?.pending_charges ?? 0);
export const levelFor = (spent) => LEVELS.filter((l) => spent >= l).at(-1) ?? 0;

export function alertText(level, spent, credit = 100, resources = '') {
  const used = `$${spent.toFixed(2)} of $${credit} used`;
  if (level >= 90) return `Vultr DANGER: ${used}. Everything running is listed below. A person must shut down what is not needed, now.\n\n${resources}`;
  if (level >= 75) return `Vultr WARNING: ${used}. STOP all new Vultr usage now. Nothing new may be created.`;
  return `Vultr heads-up: ${used}. Halfway through the credit.`;
}

/** Reads the account, decides if a NEW alert level was crossed, and tells `notify` once per level. */
export async function checkOnce({ fetchJson, store, notify, log, credit = 100 }) {
  const body = await fetchJson('/v2/account');
  const account = body?.account;
  if (!account || (account.balance === undefined && account.pending_charges === undefined)) {
    throw new Error(`Vultr answered in a shape I don't recognise (top-level keys: ${Object.keys(body ?? {}).join(', ') || 'none'}). Check the account page by hand.`);
  }
  const spent = spentUsd(account, credit);
  const level = levelFor(spent);
  const state = store.read('vultr-budget', { level: 0 });
  log(`Vultr: $${spent.toFixed(2)} of $${credit} used${level ? ` (alert level $${level})` : ''}`);
  if (level > state.level) {
    const resources = level >= 90 ? await describeResources(fetchJson).catch((e) => `(could not list resources: ${e.message})`) : '';
    await notify(alertText(level, spent, credit, resources), level);
  }
  store.write('vultr-budget', { level: Math.max(level, state.level), spent, checkedAt: Date.now() });
  return { spent, level };
}

const RESOURCES = [
  ['Servers (instances)', '/v2/instances', 'instances'],
  ['Bare metal servers', '/v2/bare-metals', 'bare_metals'],
  ['Block storage volumes', '/v2/blocks', 'blocks'],
  ['Object storage', '/v2/object-storage', 'object_storages'],
  ['Snapshots', '/v2/snapshots', 'snapshots'],
  ['Load balancers', '/v2/load-balancers', 'load_balancers'],
  ['Reserved IPs', '/v2/reserved-ips', 'reserved_ips'],
  ['Kubernetes clusters', '/v2/kubernetes/clusters', 'vke_clusters'],
];
/** A plain list of what exists. Only the few safe fields are shown (never anything secret). */
export async function describeResources(fetchJson) {
  const lines = [];
  for (const [name, path, key] of RESOURCES) {
    try {
      const body = await fetchJson(path);
      const items = Array.isArray(body?.[key]) ? body[key] : Object.values(body ?? {}).find(Array.isArray) ?? [];
      lines.push(`${name}: ${items.length}`);
      for (const it of items.slice(0, 20)) {
        const bits = [it.label || it.id, it.plan, it.region, it.status, it.size_gb ? `${it.size_gb} GB` : '', it.monthly_cost ? `$${it.monthly_cost}/mo` : ''].filter(Boolean);
        const gpu = /vcg|gpu/i.test(String(it.plan ?? '')) ? '   <-- GPU (banned)' : '';
        lines.push(`   - ${bits.join(', ')}${gpu}`);
      }
    } catch (e) {
      lines.push(`${name}: could not check (${e.message})`);
    }
  }
  return lines.join('\n');
}

/** Minimal .env reader: returns the value for one name, or undefined. */
export function readEnvValue(text, name) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && m[1] === name) return m[2].replace(/^(['"])(.*)\1$/, '$2') || undefined;
  }
  return undefined;
}

/** Wraps fetch so errors are plain words and the key can't leak into a message. */
export function makeFetchJson(key, fetchImpl = fetch) {
  return async (path) => {
    const res = await fetchImpl(`${API}${path}`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    if (res.status === 401 || res.status === 403) throw new Error('Vultr refused the key. Check VULTR_API_KEY in server/.env, and that this laptop\'s IP address is allowed for the key.');
    if (res.status === 429) throw new Error('Vultr says slow down (too many requests). Will retry.');
    if (!res.ok) throw new Error(`Vultr answered with HTTP ${res.status}.`);
    return res.json();
  };
}

// ---------- command line ----------
async function main() {
  // VULTR_BUDGET_ROOT lets tests point at an empty folder so they never touch the real server/.env
  const root = process.env.VULTR_BUDGET_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  const say = (m) => console.log(`[${new Date().toLocaleTimeString()}] ${m}`);

  let key = process.env.VULTR_API_KEY;
  if (!key) {
    for (const f of [join(root, 'server', '.env'), join(root, '.env')]) {
      if (existsSync(f)) key ??= readEnvValue(readFileSync(f, 'utf8'), 'VULTR_API_KEY');
    }
  }
  if (!key) {
    console.error('VULTR_API_KEY is not in server/.env yet. Ask Sadie to type it in herself (never paste it into chat). Until then, check the balance by hand in the Vultr dashboard.');
    process.exit(1);
  }
  const fetchJson = makeFetchJson(key);

  if (args.includes('--list')) {
    console.log(await describeResources(fetchJson));
    return;
  }

  const { FileStore } = await import('./relay/store.mjs');
  const { createRelay } = await import('./relay/core.mjs');
  const store = new FileStore(process.env.RELAY_STATE_DIR || join(root, 'scratch', 'relay'));
  const relayReady = existsSync(join(root, 'relay.private.json'));
  const relay = createRelay({ config: { waitMinutes: 3 }, store, transport: null, mailbox: null });
  const credit = Number(process.env.VULTR_CREDIT_USD) || 100;
  const notify = async (text, level) => {
    console.log(`\n!!! ${text}\n`);
    if (relayReady) relay.alert(text);
    else say('(email relay is not set up, so this alert is on screen only)');
    if (level >= 75) say(`Rule: no new Vultr resources from now on. See docs/vultr.md.`);
  };

  const watch = args.includes('--watch');
  const everyMs = (Number(process.env.VULTR_BUDGET_INTERVAL_MIN) || 30) * 60_000;
  for (;;) {
    let wait = everyMs;
    try {
      await checkOnce({ fetchJson, store, notify, log: say, credit });
    } catch (e) {
      say(`could not check the Vultr balance: ${e.message}`);
      if (!watch) process.exit(1);
      wait = 5 * 60_000;
    }
    if (!watch) break;
    await new Promise((r) => setTimeout(r, wait));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
