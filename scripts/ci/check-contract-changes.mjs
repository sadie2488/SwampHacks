// CI: contracts may only GROW. Other lanes build against these shapes, so a pull request may add fields,
// signals, controls, tables and columns, but not remove or narrow anything. A schema change that adds
// something must also raise its "x-contract-version". Breaking changes are a separate lead task:
// add  "Override: contracts/<file> | approved by <name>"  to the pull request text.
// Env: BASE_SHA, HEAD_SHA, PR_BODY.
import { changedFiles, fail, matchesAny, notice, parseOverrides, requireEnv, showAt } from './lib.mjs';

requireEnv('BASE_SHA', 'HEAD_SHA');
const { BASE_SHA, HEAD_SHA, PR_BODY = '' } = process.env;
const overrides = parseOverrides(PR_BODY);
const problems = [];

// ---- JSON Schema: collect the facts that other code depends on ----
const typeSet = (t) => new Set(t === undefined ? [] : Array.isArray(t) ? t : [t]);
function facts(schema) {
  const out = new Map();
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    out.set(path, {
      type: typeSet(node.type),
      required: new Set(node.required || []),
      enum: node.enum ? new Set(node.enum.map((v) => JSON.stringify(v))) : null,
      const: node.const === undefined ? undefined : JSON.stringify(node.const),
    });
    for (const [k, v] of Object.entries(node.properties || {})) walk(v, `${path}/properties/${k}`);
    for (const [k, v] of Object.entries(node.$defs || {})) walk(v, `${path}/$defs/${k}`);
    if (node.items && !Array.isArray(node.items)) walk(node.items, `${path}/items`);
    for (const key of ['allOf', 'anyOf', 'oneOf']) (node[key] || []).forEach((v, i) => walk(v, `${path}/${key}/${i}`));
    for (const key of ['if', 'then', 'else']) walk(node[key], `${path}/${key}`);
  };
  walk(schema, '#');
  return out;
}
const widens = (base, head) => [...base].every((t) => head.has(t) || (t === 'integer' && head.has('number')));

function compareSchemas(file, base, head) {
  const b = facts(base);
  const h = facts(head);
  let grew = false;
  for (const [path, bf] of b) {
    const hf = h.get(path);
    if (!hf) {
      problems.push(`${file}: "${path}" was removed.`);
      continue;
    }
    if (!widens(bf.type, hf.type)) problems.push(`${file}: type at "${path}" changed from ${[...bf.type].join('|')} to ${[...hf.type].join('|')}.`);
    for (const r of hf.required) if (!bf.required.has(r)) problems.push(`${file}: "${r}" became required at "${path}". Old data without it would break; make it optional.`);
    if (bf.enum) {
      if (!hf.enum) grew = true;
      else for (const v of bf.enum) if (!hf.enum.has(v)) problems.push(`${file}: allowed value ${v} was removed at "${path}".`);
    }
    if (bf.const !== undefined && bf.const !== hf.const) problems.push(`${file}: fixed value at "${path}" changed from ${bf.const} to ${hf.const}.`);
    if (hf.enum && bf.enum && [...hf.enum].some((v) => !bf.enum.has(v))) grew = true;
  }
  for (const path of h.keys()) if (!b.has(path)) grew = true;
  if (grew && !((head['x-contract-version'] ?? 0) > (base['x-contract-version'] ?? 0))) {
    problems.push(`${file}: you added something, so raise "x-contract-version" (now ${head['x-contract-version']}).`);
  }
  if ((head['x-contract-version'] ?? 0) < (base['x-contract-version'] ?? 0)) problems.push(`${file}: "x-contract-version" went down.`);
}

// ---- data files: catalogs and the database layout ----
function compareById(file, baseList, headList, key, extra = []) {
  const h = new Map((headList || []).map((x) => [x[key], x]));
  for (const bx of baseList || []) {
    const hx = h.get(bx[key]);
    if (!hx) {
      problems.push(`${file}: "${bx[key]}" was removed. Mappings and code may use it.`);
      continue;
    }
    for (const f of extra) if (JSON.stringify(bx[f]) !== JSON.stringify(hx[f])) problems.push(`${file}: "${bx[key]}" changed its ${f}.`);
  }
}
function compareData(file, base, head) {
  if (file.endsWith('signal-catalog.json')) compareById(file, base.signals, head.signals, 'id', ['kind']);
  else if (file.endsWith('control-catalog.json')) compareById(file, base.controls, head.controls, 'id', ['kind', 'value_type']);
  else if (file.endsWith('db-schema.json')) {
    compareById(file, base.tables, head.tables, 'name', ['kind', 'time_column']);
    const ht = new Map((head.tables || []).map((t) => [t.name, t]));
    for (const bt of base.tables || []) if (ht.has(bt.name)) compareById(`${file} (${bt.name})`, bt.columns, ht.get(bt.name).columns, 'name', ['type']);
  }
}

for (const { path, status } of changedFiles(BASE_SHA, HEAD_SHA)) {
  if (!path.startsWith('contracts/') || !path.endsWith('.json')) continue;
  const ov = overrides.find((o) => matchesAny(path, [o.glob]));
  if (ov) {
    notice('Contract override', `${path} changed under an override approved by ${ov.by}. The lead logs it in docs/decisions.md.`);
    continue;
  }
  const baseText = showAt(BASE_SHA, path);
  if (baseText === null) continue; // a brand-new contract: nothing to break
  const headText = showAt(HEAD_SHA, path);
  if (headText === null || status === 'D') {
    problems.push(`${path}: the contract file was deleted.`);
    continue;
  }
  try {
    const [b, h] = [JSON.parse(baseText), JSON.parse(headText)];
    if (path.endsWith('.schema.json')) compareSchemas(path, b, h);
    else compareData(path, b, h);
  } catch (e) {
    problems.push(`${path}: not valid JSON (${e.message}).`);
  }
}

if (problems.length) {
  fail('Contracts may only grow', `${problems.length} problem(s):\n${problems.slice(0, 20).join('\n')}\nBreaking changes are a separate lead task: add "Override: contracts/<file> | approved by <name>" to the pull request text.`);
  process.exit(1);
}
console.log('contract changes ok: additive only');
