// The mapping engine: turns signals (a clap, hand height, a spoken word...) into commands, following the rules in
// web/src/modules/mappings/mappings.yaml. Guide: docs/commands-guide.md
//
// This file is PURE: no DOM, no bus, no timers of its own. The clock is passed in, so tests can drive it with fake time.
// index.ts is the thin part that connects it to the bus.
//
// Two jobs:
//   1. loadMappings(yamlText)  reads and CHECKS the rules. A bad rule is skipped and explained in plain words
//      (an "issue"); the good rules keep working.
//   2. createEngine()          holds the loaded rules and answers each incoming signal with zero or more commands.
import { parseDocument } from 'yaml';
import { controlCatalog, signalCatalog } from '@/contracts/catalogs';
import type { CommandEvent, CommandSource, ControlInfo, ControlValue, Mode, Signal, SignalInfo } from '@/contracts';
import type { EngineIssue } from '@/bus';

export type RuleMode = Mode | 'any';
export type RuleHow = 'follow' | 'trigger' | 'toggle' | 'nudge';

/** A rule after checking: every setting has a usable value. `index` is its position in the file (0 = first rule). */
export interface Rule {
  index: number;
  /** The rule's name, or "rule 3" when it has none. This is what commands carry in `mapping`. */
  label: string;
  enabled: boolean;
  mode: RuleMode;
  when: string;
  do: string;
  how: RuleHow;
  /** follow only: the two ends of the control's movement. May be reversed, like [1.0, 0.5]. */
  range?: [number, number];
  /** follow only: 0 = jumpy, 1 = very smooth. */
  smoothing: number;
  minConfidence: number;
  cooldownMs: number;
  /** A holdable signal that must be active (for example a fist) for this rule to work. */
  onlyWhile?: string;
  /** nudge only: how far to move each time (negative = down). */
  step?: number;
  /** trigger / toggle: a fixed value to set. */
  value?: ControlValue;
}

export interface Catalogs {
  signals: SignalInfo[];
  controls: ControlInfo[];
}
const defaultCatalogs: Catalogs = { signals: signalCatalog.signals, controls: controlCatalog.controls };

export interface LoadResult {
  rules: Rule[];
  issues: EngineIssue[];
  /** True when the file could not be read at all (bad YAML). Keep using the previous rules then. */
  fatal: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Settings you may want to tune
// ---------------------------------------------------------------------------------------------------------------
const MAX_SMOOTHING = 0.98; // smoothing: 1 would freeze the value forever, so it is capped just below
// Sat-night fix: was 1%. A resting hand jitters by about that much, which spammed tempo commands (2% = 0.02x of tempo).
const MIN_CHANGE = 0.02; // a follow rule only sends a new value when it moved by 2% of its range
const FIRED_EVERY_MS = 200; // follow rules light up the Command Lab at most about 5 times a second
// Sat-night fix: a practice run ends whenever tempo or pitch change, so follow rules leave these alone during a run.
const STEADY_DURING_PRACTICE = new Set(['playback.tempo', 'playback.pitch']);

const RULE_KEYS = ['name', 'mode', 'when', 'do', 'how', 'range', 'smoothing', 'min_confidence', 'cooldown_ms', 'only_while', 'step', 'value', 'enabled'];
const HOWS: RuleHow[] = ['follow', 'trigger', 'toggle', 'nudge'];
const MODES: RuleMode[] = ['play', 'create', 'learn', 'any'];

// ---------------------------------------------------------------------------------------------------------------
// Friendly "did you mean" suggestions
// ---------------------------------------------------------------------------------------------------------------
/** Number of single-letter edits (insert, delete, change, or swap two neighbours) to turn a into b. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Up to three options that look like what was typed (a small typo, or a part of the name), best first. */
export function suggest(typed: string, options: string[]): string[] {
  const w = typed.trim().toLowerCase();
  if (!w) return [];
  const limit = Math.min(3, Math.max(1, Math.floor(w.length / 4)));
  const scored = options
    .map((option) => {
      const o = option.toLowerCase();
      const partOfName = o.startsWith(w) || o.endsWith('.' + w) || w.startsWith(o) || w.endsWith('.' + o);
      return { option, score: partOfName ? 0.5 : editDistance(w, o) };
    })
    .filter((x) => x.score <= limit)
    .sort((a, b) => a.score - b.score);
  // only keep the ones nearly as good as the best, so one clear answer is not buried among weak guesses
  return scored.filter((x) => x.score <= scored[0].score + 1).slice(0, 3).map((x) => x.option);
}

function didYouMean(typed: string, options: string[]): string {
  const s = suggest(typed, options);
  return s.length ? ` Did you mean ${s.map((x) => `"${x}"`).join(' or ')}?` : '';
}

/** A value as the user wrote it, shortened for messages. */
function show(v: unknown): string {
  const text = typeof v === 'string' ? `"${v}"` : JSON.stringify(v) ?? String(v);
  return text.length > 40 ? text.slice(0, 37) + '...' : text;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumberControl = (c: ControlInfo) => c.kind === 'value' && (c.value_type ?? 'number') === 'number';
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** What a control is, in everyday words (for error messages). */
function controlKindWords(c: ControlInfo): string {
  if (c.kind === 'trigger') return 'a button (it does something once)';
  if (c.kind === 'toggle') return 'an on/off switch';
  const type = c.value_type ?? 'number';
  return type === 'string' ? 'a choice from a list' : type === 'range' ? 'a start-and-end pair' : 'a number';
}

// ---------------------------------------------------------------------------------------------------------------
// Loading and checking rules
// ---------------------------------------------------------------------------------------------------------------
/** Read the YAML text, check every rule, and say what is wrong in plain English. Never throws. */
export function loadMappings(yamlText: string, catalogs: Catalogs = defaultCatalogs): LoadResult {
  const doc = parseDocument(yamlText);
  if (doc.errors.length) {
    const e = doc.errors[0];
    const line = e.linePos?.[0]?.line;
    const what = e.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '');
    return fatal(
      line ? `mappings.yaml, line ${line}` : 'mappings.yaml',
      `The file could not be read, so your last change was not applied (the last working rules stay active). The problem: ${what}. ` +
        'Tips: indent with spaces (not tabs), start every rule with "- ", and put a space after every colon.',
    );
  }
  const data: unknown = doc.toJS();
  if (data === null || data === undefined) return { rules: [], issues: [], fatal: false }; // an empty file is fine: no rules yet
  if (!Array.isArray(data)) {
    return fatal('mappings.yaml', 'The file should be a list of rules, and every rule should start with "- " (a dash and a space). Your last change was not applied.');
  }

  const lookup = {
    signals: new Map(catalogs.signals.map((s) => [s.id, s])),
    controls: new Map(catalogs.controls.map((c) => [c.id, c])),
    signalIds: catalogs.signals.map((s) => s.id),
    controlIds: catalogs.controls.map((c) => c.id),
    holdableIds: catalogs.signals.filter((s) => s.kind === 'moment' && s.holdable).map((s) => s.id),
  };

  const rules: Rule[] = [];
  const issues: EngineIssue[] = [];
  data.forEach((raw, index) => {
    const checked = checkRule(raw, index, lookup);
    issues.push(...checked.issues);
    if (checked.rule) rules.push(checked.rule);
  });
  issues.push(...findConflicts(rules));
  return { rules, issues, fatal: false };
}

function fatal(where: string, message: string): LoadResult {
  return { rules: [], issues: [{ level: 'error', where, message }], fatal: true };
}

interface Lookup {
  signals: Map<string, SignalInfo>;
  controls: Map<string, ControlInfo>;
  signalIds: string[];
  controlIds: string[];
  holdableIds: string[];
}

function checkRule(raw: unknown, index: number, cat: Lookup): { rule?: Rule; issues: EngineIssue[] } {
  const where = (name: unknown) => `rule ${index + 1}${typeof name === 'string' && name.trim() ? ` (${name.trim()})` : ''}`;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      issues: [{ level: 'error', where: where(undefined), message: 'This entry is not a rule. A rule needs "when:", "do:" and "how:" lines, each indented under a "- name: ..." line. It is skipped.' }],
    };
  }
  const r = raw as Record<string, unknown>;
  const label = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : `rule ${index + 1}`;
  const errors: string[] = [];
  const warnings: string[] = [];

  // Settings that look like a typo of a real one (other made-up settings are allowed and ignored)
  for (const key of Object.keys(r)) {
    if (RULE_KEYS.includes(key)) continue;
    const s = suggest(key, RULE_KEYS);
    if (s.length) warnings.push(`"${key}" is not a setting I know, so it does nothing. Did you mean "${s[0]}"?`);
  }

  // --- the three required lines ---
  let sig: SignalInfo | undefined;
  if (r.when === undefined || r.when === null || r.when === '') {
    errors.push('It has no "when:" line. Say what starts it, for example "when: audio.clap".');
  } else if (typeof r.when !== 'string') {
    errors.push(`"when:" must be a signal name like audio.clap, but it is ${show(r.when)}.`);
  } else {
    sig = cat.signals.get(r.when);
    if (!sig) errors.push(`"${r.when}" (in "when:") is not a signal the app knows.${didYouMean(r.when, cat.signalIds)} The Command Lab lists every signal.`);
  }

  let ctl: ControlInfo | undefined;
  if (r.do === undefined || r.do === null || r.do === '') {
    errors.push('It has no "do:" line. Say what it should change, for example "do: playback.tempo".');
  } else if (typeof r.do !== 'string') {
    errors.push(`"do:" must be a control name like playback.tempo, but it is ${show(r.do)}.`);
  } else {
    ctl = cat.controls.get(r.do);
    if (!ctl) errors.push(`"${r.do}" (in "do:") is not a control the app knows.${didYouMean(r.do, cat.controlIds)} The Command Lab lists every control.`);
  }

  let how: RuleHow | undefined;
  if (r.how === undefined || r.how === null || r.how === '') {
    errors.push('It has no "how:" line. Say how: follow, trigger, toggle or nudge.');
  } else if (typeof r.how !== 'string' || !HOWS.includes(r.how as RuleHow)) {
    errors.push(`${show(r.how)} (in "how:") is not a way I know. Use follow, trigger, toggle or nudge.${typeof r.how === 'string' ? didYouMean(r.how, HOWS) : ''}`);
  } else {
    how = r.how as RuleHow;
  }

  // --- mode ---
  let mode: RuleMode = 'any';
  if (r.mode !== undefined && r.mode !== null) {
    if (typeof r.mode === 'string' && MODES.includes(r.mode as RuleMode)) mode = r.mode as RuleMode;
    else errors.push(`${show(r.mode)} (in "mode:") is not a mode. Use play, create, learn or any.${typeof r.mode === 'string' ? didYouMean(r.mode, MODES) : ''}`);
  }

  // --- numbers ---
  const smoothing = readNumber(r.smoothing, 'smoothing', 'a number from 0 (jumpy) to 1 (very smooth)', 0, 1, errors);
  const minConfidence = readNumber(r.min_confidence, 'min_confidence', 'a number from 0 to 1 (how sure the app must be)', 0, 1, errors);
  const cooldownMs = readNumber(r.cooldown_ms, 'cooldown_ms', 'a number of milliseconds, 0 or more', 0, Infinity, errors);
  const step = readNumber(r.step, 'step', 'a number (how far to move each time, negative = down)', -Infinity, Infinity, errors);
  let range: [number, number] | undefined;
  if (r.range !== undefined && r.range !== null) {
    if (Array.isArray(r.range) && r.range.length === 2 && r.range.every(isNumber)) range = [r.range[0], r.range[1]];
    else errors.push(`"range:" must be two numbers in square brackets, like "range: [0.5, 1.5]", but it is ${show(r.range)}.`);
  }
  let enabled = true;
  if (r.enabled !== undefined && r.enabled !== null) {
    if (typeof r.enabled === 'boolean') enabled = r.enabled;
    else errors.push(`"enabled:" must be true or false, but it is ${show(r.enabled)}.`);
  }

  // --- only_while: must be something you can hold, like a fist ---
  let onlyWhile: string | undefined;
  if (r.only_while !== undefined && r.only_while !== null) {
    if (typeof r.only_while !== 'string') {
      errors.push(`"only_while:" must be a signal name like vision.hand.left.fist, but it is ${show(r.only_while)}.`);
    } else if (!cat.signals.has(r.only_while)) {
      errors.push(`"${r.only_while}" (in "only_while:") is not a signal the app knows.${didYouMean(r.only_while, cat.holdableIds)}`);
    } else if (!cat.holdableIds.includes(r.only_while)) {
      errors.push(`"${r.only_while}" cannot be used in "only_while:" because you cannot hold it (it happens in an instant, or it is a slider). Pick something you can hold, like vision.hand.left.fist or vision.hand.right.open_palm.`);
    } else {
      onlyWhile = r.only_while;
    }
  }

  // --- combinations that do not make sense ---
  if (how && sig) {
    if (how === 'follow' && sig.kind !== 'slider') {
      errors.push(`"follow" needs a slider signal (a number that moves from 0 to 1, like vision.hand.right.height), but "${sig.id}" is a moment: it happens once. Use "how: trigger" for moments, or pick a slider signal.`);
    }
    if (how !== 'follow' && sig.kind !== 'moment') {
      errors.push(`"${how}" needs a moment signal (something that happens, like a clap or a fist), but "${sig.id}" is a slider. Use "how: follow" for sliders, or pick a moment signal.`);
    }
  }
  if (how && ctl) {
    if (how === 'follow' && !isNumberControl(ctl)) {
      errors.push(`"follow" needs a control that holds a number (like playback.tempo), but "${ctl.id}" is ${controlKindWords(ctl)}. Use "how: trigger" or "how: toggle" for it.`);
    }
    if (how === 'toggle' && ctl.kind !== 'toggle') {
      errors.push(`"toggle" flips something on and off, but "${ctl.id}" is ${controlKindWords(ctl)}. Pick an on/off control such as playback.loop or create.beat.`);
    }
    if (how === 'nudge' && !isNumberControl(ctl)) {
      errors.push(`"nudge" moves a number up or down a little, but "${ctl.id}" is ${controlKindWords(ctl)}. Pick a number control such as playback.tempo or playback.pitch.`);
    }
    if (how === 'nudge' && isNumberControl(ctl) && step === undefined && ctl.step === undefined) {
      errors.push('"nudge" needs a "step:" line, the amount to move each time (negative = down), for example "step: 0.1".');
    }
    if (mode !== 'any' && !ctl.modes.includes(mode)) {
      errors.push(`"${ctl.id}" does not work in ${mode} mode (it works in ${ctl.modes.join(' and ')} mode). Change "mode:" or pick another control.`);
    }
    if (range && how === 'follow' && ctl.range && (Math.min(...range) < ctl.range[0] || Math.max(...range) > ctl.range[1])) {
      warnings.push(`"range: [${range.join(', ')}]" goes past what ${ctl.id} can do (${ctl.range[0]} to ${ctl.range[1]}), so extreme values will be cut off.`);
    }
    if ((how === 'trigger' || how === 'toggle') && r.value !== undefined) {
      const problem = checkFixedValue(r.value, ctl);
      if (problem) errors.push(problem);
    }
    if (how === 'trigger' && r.value === undefined && ctl.kind === 'value') {
      warnings.push(`This rule will not change anything yet: "${ctl.id}" holds ${controlKindWords(ctl)}, so a trigger needs a "value:" line to say what to set it to.`);
    }
  }

  const issues: EngineIssue[] = [];
  if (errors.length) errors[errors.length - 1] += ' This rule is skipped until it is fixed.';
  for (const message of errors) issues.push({ level: 'error', where: where(r.name), message });
  for (const message of warnings) issues.push({ level: 'warning', where: where(r.name), message });
  if (errors.length || !how || !sig || !ctl) return { issues };

  const rule: Rule = {
    index,
    label,
    enabled,
    mode,
    when: sig.id,
    do: ctl.id,
    how,
    smoothing: smoothing ?? 0,
    minConfidence: minConfidence ?? 0,
    cooldownMs: cooldownMs ?? 0,
  };
  if (how === 'follow') rule.range = range ?? ctl.range ?? [0, 1];
  if (onlyWhile) rule.onlyWhile = onlyWhile;
  if (how === 'nudge') rule.step = step ?? ctl.step;
  if ((how === 'trigger' || how === 'toggle') && r.value !== undefined) rule.value = r.value as ControlValue;
  return { rule, issues };
}

/** A number setting that is allowed to be missing. Pushes a friendly error when it is there but wrong. */
function readNumber(v: unknown, key: string, expected: string, min: number, max: number, errors: string[]): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (isNumber(v) && v >= min && v <= max) return v;
  errors.push(`"${key}:" must be ${expected}, but it is ${show(v)}.`);
  return undefined;
}

/** For trigger/toggle rules with a fixed `value:`: does it fit the control? Returns a message when it does not. */
function checkFixedValue(value: unknown, ctl: ControlInfo): string | undefined {
  const bad = (expected: string) => `"value:" must be ${expected} for ${ctl.id}, but it is ${show(value)}.`;
  if (ctl.kind === 'toggle') return typeof value === 'boolean' ? undefined : bad('true or false');
  if (ctl.kind !== 'value') return undefined; // buttons ignore the value
  const type = ctl.value_type ?? 'number';
  if (type === 'number') return isNumber(value) ? undefined : bad('a number');
  if (type === 'string') {
    if (typeof value !== 'string') return bad('a word');
    return ctl.options && !ctl.options.includes(value) ? bad(`one of ${ctl.options.join(', ')}`) : undefined;
  }
  return Array.isArray(value) && value.length === 2 && value.every(isNumber) ? undefined : bad('two numbers like [10, 20]');
}

/** Two enabled rules with the same signal and control in the same mode fight each other: warn. */
function findConflicts(rules: Rule[]): EngineIssue[] {
  const issues: EngineIssue[] = [];
  const active = rules.filter((r) => r.enabled);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const overlap = a.mode === b.mode || a.mode === 'any' || b.mode === 'any';
      if (a.when !== b.when || a.do !== b.do || !overlap) continue;
      const mode = a.mode !== 'any' ? a.mode : b.mode;
      issues.push({
        level: 'warning',
        where: `rules ${a.index + 1} and ${b.index + 1}`,
        message: `"${a.label}" and "${b.label}" both react to ${a.when} and change ${a.do}${mode === 'any' ? ' in every mode' : ` in ${mode} mode`}, so they will fight each other. Switch one off with "enabled: false" or give them different modes.`,
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------------------------------------------
// Running rules
// ---------------------------------------------------------------------------------------------------------------
/** One command a rule produced. `fire` says whether the Command Lab should light the rule up (follow rules are throttled). */
export interface Emission {
  command: CommandEvent;
  fire: boolean;
}

interface RuleState {
  smoothed?: number; // follow: the smoothed slider value (0..1)
  lastValue?: number; // follow: the last value we sent
  lastCommandAt?: number; // for the cooldown
  lastFiredAt?: number; // follow: when the Lab was last told
}

export interface EngineOptions {
  /** Milliseconds. Default: performance.now(). Tests pass a fake clock. */
  now?: () => number;
  catalogs?: Catalogs;
  /** The current value of a control (index.ts reads the bus). Follow rules start from it and compare against it. */
  current?: (control: string) => ControlValue | undefined;
}

export function createEngine(options: EngineOptions = {}) {
  const now = options.now ?? (() => performance.now());
  const catalogs = options.catalogs ?? defaultCatalogs;
  const holdable = new Set(catalogs.signals.filter((s) => s.kind === 'moment' && s.holdable).map((s) => s.id));

  let rules: Rule[] = [];
  let issues: EngineIssue[] = [];
  let states = new Map<number, RuleState>();
  let mode: Mode = 'play';
  let practiceRun = false;
  const held = new Set<string>(); // holdable signals that are active right now (a fist that is closed...)

  const stateOf = (rule: Rule): RuleState => {
    let s = states.get(rule.index);
    if (!s) states.set(rule.index, (s = {}));
    return s;
  };

  return {
    /** Load (or reload) the rules. If the text cannot be read, the previous rules stay. Returns the issues. */
    load(yamlText: string): EngineIssue[] {
      const result = loadMappings(yamlText, catalogs);
      issues = result.issues;
      if (!result.fatal) {
        rules = result.rules;
        states = new Map();
      }
      return issues;
    },
    get rules(): readonly Rule[] {
      return rules;
    },
    get issues(): readonly EngineIssue[] {
      return issues;
    },
    setMode(next: Mode): void {
      mode = next;
    },
    /** True while a practice run is listening: follow rules then leave tempo and pitch alone (it would end the run). */
    setPracticeRun(active: boolean): void {
      practiceRun = active;
    },

    /** Feed one signal reading in; get the commands it causes (usually none). */
    handleSignal(sig: Signal): Emission[] {
      // Keep track of held gestures first, so a rule sees the newest state.
      if (sig.kind === 'moment' && holdable.has(sig.id)) {
        if (sig.state === 'end') held.delete(sig.id);
        else held.add(sig.id);
      }

      const out: Emission[] = [];
      const t = now();
      for (const rule of rules) {
        if (!rule.enabled || rule.when !== sig.id) continue;
        if (rule.mode !== 'any' && rule.mode !== mode) continue;
        if ((sig.confidence ?? 1) < rule.minConfidence) continue;
        if (rule.onlyWhile && !held.has(rule.onlyWhile)) continue;

        const state = stateOf(rule);
        const coolingDown = state.lastCommandAt !== undefined && t - state.lastCommandAt < rule.cooldownMs;
        let value: ControlValue | undefined;
        let fire = true;

        if (rule.how === 'follow') {
          if (sig.kind !== 'slider' || !isNumber(sig.value)) continue;
          if (practiceRun && STEADY_DURING_PRACTICE.has(rule.do)) {
            state.smoothed = undefined; // start again from the current value once the run is over
            continue;
          }
          const [a, b] = rule.range ?? [0, 1];
          const cur = options.current?.(rule.do);
          const currentValue = isNumber(cur) ? cur : undefined;
          // smoothing: each new reading only moves the value part of the way
          const keep = Math.min(rule.smoothing, MAX_SMOOTHING);
          const x = clamp01(sig.value);
          // Sat-night fix: the first reading used to jump straight to the hand; now it smooths from the current value.
          if (state.smoothed === undefined && currentValue !== undefined && b !== a) state.smoothed = clamp01((currentValue - a) / (b - a));
          state.smoothed = state.smoothed === undefined ? x : state.smoothed * keep + x * (1 - keep);
          if (coolingDown) continue;
          const mapped = Math.round((a + state.smoothed * (b - a)) * 1000) / 1000;
          const last = currentValue ?? state.lastValue;
          // only send when it moved by a meaningful amount, so the bus is not flooded
          if (last !== undefined && (mapped === last || Math.abs(mapped - last) < Math.abs(b - a) * MIN_CHANGE)) continue;
          state.lastValue = mapped;
          value = mapped;
          fire = state.lastFiredAt === undefined || t - state.lastFiredAt >= FIRED_EVERY_MS;
          if (fire) state.lastFiredAt = t;
        } else {
          if (sig.kind !== 'moment' || sig.state === 'end') continue; // these only react when the moment starts
          if (coolingDown) continue;
          value = rule.how === 'nudge' ? rule.step : rule.value;
        }

        state.lastCommandAt = t;
        const source: CommandSource = sig.id.startsWith('audio.keyword.') ? 'voice' : 'gesture';
        const command: CommandEvent = { version: 1, command: rule.do, source, how: rule.how, mode, mapping: rule.label, signal: rule.when, t_ms: t };
        if (value !== undefined) command.value = value;
        out.push({ command, fire });
      }
      return out;
    },
  };
}

export type Engine = ReturnType<typeof createEngine>;
