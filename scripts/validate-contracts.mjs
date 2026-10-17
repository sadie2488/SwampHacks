#!/usr/bin/env node
// Checks that the contracts are well formed and that all fake data matches them.
//  1. every contracts/*.schema.json compiles and carries x-contract-version (and a "version" field for messages)
//  2. the catalogs and the database layout are valid and consistent (unique ids, real table references)
//  3. every fixtures/<contract>/* file passes its schema; every fixtures/_invalid/<contract>/* file FAILS it
//  4. every mappings file (fixtures/mapping/*.yaml and web/src/modules/mappings/mappings.yaml) only uses real
//     signals and controls, the right way (follow = slider, trigger/toggle/nudge = moment, mode fits the control)
// Run: node scripts/validate-contracts.mjs      Exit 1 on any problem, with a plain explanation.
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACTS = join(ROOT, 'contracts');
const FIXTURES = join(ROOT, 'fixtures');
const REAL_MAPPING = join(ROOT, 'web', 'src', 'modules', 'mappings', 'mappings.yaml');
const errors = [];
const warnings = [];
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const readAny = (file) => (extname(file) === '.yaml' || extname(file) === '.yml' ? parseYaml(readFileSync(file, 'utf8')) : JSON.parse(readFileSync(file, 'utf8')));
const listFiles = (dir) => (existsSync(dir) ? readdirSync(dir).map((n) => join(dir, n)).filter((p) => statSync(p).isFile()) : []);
const fmt = (errs) => (errs || []).slice(0, 4).map((e) => `${e.instancePath || '(top)'} ${e.message}`).join('; ');

// ---------- 1. schemas ----------
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const schemaFiles = listFiles(CONTRACTS).filter((f) => f.endsWith('.schema.json'));
const names = [];
for (const file of schemaFiles) {
  const name = basename(file).replace('.schema.json', '');
  let schema;
  try {
    schema = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    err(rel(file), `not valid JSON (${e.message})`);
    continue;
  }
  names.push(name);
  if (!Number.isInteger(schema['x-contract-version']) || schema['x-contract-version'] < 1) err(rel(file), 'needs "x-contract-version": <whole number, 1 or more>');
  if (!schema.$id) err(rel(file), 'needs an "$id"');
  if (schema.type !== 'array') {
    const carriesVersion = (s) => s?.properties?.version || (s?.allOf || []).some(carriesVersion);
    if (!carriesVersion(schema)) err(rel(file), 'messages need a "version" field in their properties');
  }
  try {
    ajv.addSchema(schema);
  } catch (e) {
    err(rel(file), `could not be loaded (${e.message})`);
  }
}
const validators = {};
for (const name of names) {
  try {
    validators[name] = ajv.getSchema(`https://contracts.swamphacks.invalid/${name}.schema.json`) ?? ajv.compile(JSON.parse(readFileSync(join(CONTRACTS, `${name}.schema.json`), 'utf8')));
  } catch (e) {
    err(`contracts/${name}.schema.json`, `does not compile (${e.message})`);
  }
}

// ---------- 2. catalogs and database layout ----------
const dataFiles = { 'signal-catalog': 'signal-catalog.json', 'control-catalog': 'control-catalog.json', 'db-schema': 'db-schema.json' };
const data = {};
for (const [contract, fileName] of Object.entries(dataFiles)) {
  const file = join(CONTRACTS, fileName);
  if (!existsSync(file)) {
    err(rel(file), 'missing');
    continue;
  }
  data[contract] = JSON.parse(readFileSync(file, 'utf8'));
  const v = validators[contract];
  if (v && !v(data[contract])) err(rel(file), `does not match its schema: ${fmt(v.errors)}`);
}
const dupes = (items, key) => items.map((i) => i[key]).filter((id, i, all) => all.indexOf(id) !== i);
const signals = new Map((data['signal-catalog']?.signals || []).map((s) => [s.id, s]));
const controls = new Map((data['control-catalog']?.controls || []).map((c) => [c.id, c]));
for (const id of dupes(data['signal-catalog']?.signals || [], 'id')) err('contracts/signal-catalog.json', `duplicate signal id "${id}"`);
for (const id of dupes(data['control-catalog']?.controls || [], 'id')) err('contracts/control-catalog.json', `duplicate control id "${id}"`);
for (const s of signals.values()) {
  if (!s.id.startsWith(`${s.source}.`)) err('contracts/signal-catalog.json', `"${s.id}" should start with its source "${s.source}."`);
  if (s.holdable && s.kind !== 'moment') err('contracts/signal-catalog.json', `"${s.id}" is holdable but not a moment`);
}
for (const c of controls.values()) {
  if (c.options && !c.options.includes(c.default) && c.default !== undefined) err('contracts/control-catalog.json', `"${c.id}" default "${c.default}" is not one of its options`);
  if (c.range && c.default !== undefined && typeof c.default === 'number' && (c.default < c.range[0] || c.default > c.range[1])) err('contracts/control-catalog.json', `"${c.id}" default is outside its range`);
}
const tables = new Map((data['db-schema']?.tables || []).map((t) => [t.name, t]));
for (const name of dupes(data['db-schema']?.tables || [], 'name')) err('contracts/db-schema.json', `duplicate table "${name}"`);
for (const t of tables.values()) {
  const cols = new Set(t.columns.map((c) => c.name));
  if (cols.size !== t.columns.length) err('contracts/db-schema.json', `table "${t.name}" has a repeated column name`);
  if (t.kind === 'hypertable' && !cols.has(t.time_column)) err('contracts/db-schema.json', `hypertable "${t.name}" has no column "${t.time_column}"`);
  for (const c of t.columns) {
    if (!c.references) continue;
    const [rt, rc] = c.references.split('.');
    if (!tables.get(rt)?.columns.some((x) => x.name === rc)) err('contracts/db-schema.json', `${t.name}.${c.name} references ${c.references}, which does not exist`);
  }
  for (const ix of t.indexes || []) for (const col of ix) if (!cols.has(col)) err('contracts/db-schema.json', `index on ${t.name} uses unknown column "${col}"`);
}

// ---------- 3. fixtures ----------
const itemsOf = (value, schema) => (Array.isArray(value) && schema?.type !== 'array' ? value : [value]);
const schemaOf = (name) => JSON.parse(readFileSync(join(CONTRACTS, `${name}.schema.json`), 'utf8'));
let good = 0;
let bad = 0;
for (const dir of existsSync(FIXTURES) ? readdirSync(FIXTURES).map((n) => join(FIXTURES, n)).filter((p) => statSync(p).isDirectory()) : []) {
  const name = basename(dir);
  if (name === '_invalid') {
    for (const sub of readdirSync(dir).map((n) => join(dir, n)).filter((p) => statSync(p).isDirectory())) {
      const contract = basename(sub);
      const v = validators[contract];
      if (!v) {
        err(rel(sub), `no contract named "${contract}"`);
        continue;
      }
      for (const file of listFiles(sub)) {
        const value = readAny(file);
        const accepted = itemsOf(value, schemaOf(contract)).every((item) => v(item));
        if (accepted) err(rel(file), `should have been rejected by ${contract}, but it passed`);
        else bad++;
      }
    }
    continue;
  }
  const v = validators[name];
  if (!v) {
    err(rel(dir), `no contract named "${name}"`);
    continue;
  }
  const schema = schemaOf(name);
  for (const file of listFiles(dir)) {
    const value = readAny(file);
    itemsOf(value, schema).forEach((item, i) => {
      if (!v(item)) err(rel(file), `${Array.isArray(value) && schema.type !== 'array' ? `item ${i}: ` : ''}${fmt(v.errors)}`);
    });
    good++;
    if (name === 'song-analysis') checkSong(file, value);
  }
}
function checkSong(file, s) {
  const where = rel(file);
  for (let i = 1; i < (s.beats || []).length; i++) if (s.beats[i] <= s.beats[i - 1]) return err(where, 'beats must be increasing');
  for (const sec of s.sections || []) if (sec.end_sec <= sec.start_sec || sec.end_sec > s.duration_sec + 0.01) err(where, `section "${sec.label}" has bad times`);
  const ids = new Set();
  for (const p of s.parts) {
    if (ids.has(p.id)) err(where, `duplicate part id "${p.id}"`);
    ids.add(p.id);
    for (const n of p.notes) if (n.onset_sec + n.duration_sec > s.duration_sec + 0.01) err(where, `part "${p.id}" has a note past the end of the song`);
  }
}

// ---------- 4. mappings use real signals and controls ----------
function checkMapping(file, report) {
  const rules = readAny(file);
  if (!Array.isArray(rules)) return report(rel(file), 'a mappings file must be a list of rules');
  rules.forEach((r, i) => {
    const label = `${rel(file)} rule ${i + 1}${r?.name ? ` ("${r.name}")` : ''}`;
    const sig = signals.get(r.when);
    const ctl = controls.get(r.do);
    if (!sig) return report(label, `"when: ${r.when}" is not a signal in contracts/signal-catalog.json`);
    if (!ctl) return report(label, `"do: ${r.do}" is not a control in contracts/control-catalog.json`);
    if (r.only_while) {
      const arm = signals.get(r.only_while);
      if (!arm) report(label, `"only_while: ${r.only_while}" is not a signal`);
      else if (!arm.holdable) report(label, `"only_while: ${r.only_while}" can't be held, so it can't arm a rule`);
    }
    if (r.how === 'follow' && sig.kind !== 'slider') report(label, `"follow" needs a slider signal, but ${sig.id} is a moment`);
    if (['trigger', 'toggle', 'nudge'].includes(r.how) && sig.kind !== 'moment') report(label, `"${r.how}" needs a moment signal, but ${sig.id} is a slider`);
    if (['follow', 'nudge'].includes(r.how) && ctl.kind !== 'value') report(label, `"${r.how}" needs a control with a value, but ${ctl.id} is a ${ctl.kind}`);
    if (r.how === 'nudge' && ctl.value_type && ctl.value_type !== 'number') report(label, `"nudge" needs a number control, but ${ctl.id} holds ${ctl.value_type}`);
    if (r.how === 'toggle' && ctl.kind !== 'toggle') report(label, `"toggle" needs an on/off control, but ${ctl.id} is a ${ctl.kind}`);
    if (r.mode && r.mode !== 'any' && !ctl.modes.includes(r.mode)) report(label, `${ctl.id} doesn't exist in ${r.mode} mode (it works in: ${ctl.modes.join(', ')})`);
  });
  // two enabled rules on the same signal and control in the same mode fight each other
  const seen = new Map();
  rules.filter((r) => r.enabled !== false).forEach((r) => {
    const key = `${r.mode || 'any'}|${r.when}|${r.do}`;
    if (seen.has(key)) report(rel(file), `rules "${seen.get(key)}" and "${r.name}" both use ${r.when} for ${r.do} in ${r.mode || 'any'} mode`);
    else seen.set(key, r.name);
  });
}
const goodMappingFiles = listFiles(join(FIXTURES, 'mapping')).filter((f) => /\.ya?ml$/.test(f));
for (const file of goodMappingFiles) checkMapping(file, err);
if (existsSync(REAL_MAPPING)) {
  const v = validators.mapping;
  const value = readAny(REAL_MAPPING);
  if (v && !v(value)) warnings.push(`${rel(REAL_MAPPING)}: ${fmt(v.errors)}`);
  checkMapping(REAL_MAPPING, (where, msg) => warnings.push(`${where}: ${msg}`)); // the app skips bad lines, so these are warnings
}

// ---------- report ----------
for (const w of warnings) console.log(`::warning title=mappings.yaml::${w}`);
if (errors.length) {
  console.log(`contracts: ${errors.length} problem(s)`);
  for (const e of errors) console.log(`  x ${e}`);
  console.log(`::error title=Contracts::${errors.length} problem(s); run "node scripts/validate-contracts.mjs" to see them`);
  process.exit(1);
}
console.log(`contracts ok: ${names.length} schemas, ${signals.size} signals, ${controls.size} controls, ${tables.size} tables, ${good} fixtures pass, ${bad} bad examples rejected, ${goodMappingFiles.length} mapping file(s)${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
