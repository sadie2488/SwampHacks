// Tests for the mapping engine. It is pure, so we drive it directly with fixture signals and a fake clock (no bus, no DOM).
import { describe, expect, it } from 'vitest';
import clapFixture from '@fixtures/signal/clap.json';
import fistHeld from '@fixtures/signal/fist-held.json';
import handSweep from '@fixtures/signal/hand-sweep.json';
import starterYaml from '@fixtures/mapping/starter.yaml?raw';
import badHow from '@fixtures/_invalid/mapping/bad-how.yaml?raw';
import missingDo from '@fixtures/_invalid/mapping/missing-do.yaml?raw';
import realYaml from '../mappings/mappings.yaml?raw';
import type { Mode, Signal } from '@/contracts';
import { createEngine, editDistance, loadMappings, suggest, type Emission } from './engine';

const sweep = handSweep as unknown as Signal[];
const fist = fistHeld as unknown as Signal[];
const clap = clapFixture as unknown as Signal;

/** An engine with a fake clock: the clock always reads the t_ms of the signal being fed in. */
function setup(yaml: string, mode: Mode = 'play') {
  let now = 0;
  const engine = createEngine({ now: () => now });
  engine.load(yaml);
  engine.setMode(mode);
  const feed = (s: Signal): Emission[] => {
    now = s.t_ms;
    return engine.handleSignal(s);
  };
  const at = (t_ms: number) => (now = t_ms);
  return { engine, feed, at };
}
const moment = (id: string, t_ms: number, state: 'start' | 'end' = 'start', confidence?: number): Signal => ({
  version: 1,
  id,
  kind: 'moment',
  state,
  t_ms,
  ...(confidence === undefined ? {} : { confidence }),
});
const slider = (id: string, value: number, t_ms: number, confidence?: number): Signal => ({
  version: 1,
  id,
  kind: 'slider',
  value,
  t_ms,
  ...(confidence === undefined ? {} : { confidence }),
});
const messages = (yaml: string) => loadMappings(yaml).issues.map((i) => `${i.level}: ${i.where}: ${i.message}`);
const errorsOf = (yaml: string) => loadMappings(yaml).issues.filter((i) => i.level === 'error');

describe('loading the rule files', () => {
  it('the starter mappings load with zero errors and zero warnings', () => {
    const result = loadMappings(starterYaml);
    expect(result.issues).toEqual([]);
    expect(result.fatal).toBe(false);
    expect(result.rules).toHaveLength(10);
  });

  it('the real mappings.yaml loads with zero errors and zero warnings', () => {
    const result = loadMappings(realYaml);
    expect(result.issues).toEqual([]);
    expect(result.rules.length).toBeGreaterThan(0);
  });

  it('the invalid fixtures are reported in plain words, never thrown', () => {
    expect(messages(badHow).join('\n')).toMatch(/"wiggle" \(in "how:"\) is not a way I know/);
    expect(messages(missingDo).join('\n')).toMatch(/no "do:" line/);
    expect(loadMappings(badHow).rules).toEqual([]);
  });

  it('an empty file is fine: no rules, no problems', () => {
    expect(loadMappings('')).toEqual({ rules: [], issues: [], fatal: false });
    expect(loadMappings('# only comments\n')).toEqual({ rules: [], issues: [], fatal: false });
  });

  it('fills in sensible defaults', () => {
    const [rule] = loadMappings('- when: audio.clap\n  do: playback.toggle\n  how: trigger\n').rules;
    expect(rule).toMatchObject({ mode: 'any', enabled: true, smoothing: 0, minConfidence: 0, cooldownMs: 0, label: 'rule 1' });
  });
});

describe('friendly problems', () => {
  const good = (extra: string) => `- name: test\n  when: audio.clap\n  do: playback.toggle\n  how: trigger\n${extra}`;

  it('a typo in a signal name suggests the right one, and the other rules still work', () => {
    const yaml = `
- name: oops
  when: audio.clapp
  do: playback.toggle
  how: trigger
- name: fine
  when: audio.snap
  do: playback.toggle
  how: trigger
`;
    const result = loadMappings(yaml);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].level).toBe('error');
    expect(result.issues[0].where).toBe('rule 1 (oops)');
    expect(result.issues[0].message).toContain('"audio.clapp" (in "when:") is not a signal the app knows.');
    expect(result.issues[0].message).toContain('Did you mean "audio.clap"?');
    expect(result.issues[0].message).toContain('skipped');
    expect(result.rules.map((r) => r.label)).toEqual(['fine']);

    const { feed } = setup(yaml);
    expect(feed(moment('audio.clap', 100))).toEqual([]); // the broken rule does nothing
    expect(feed(moment('audio.snap', 200))).toHaveLength(1); // the good one works
  });

  it('a typo in a control name suggests the right one', () => {
    const [issue] = errorsOf(good('').replace('playback.toggle', 'playback.temp'));
    expect(issue.message).toContain('"playback.temp" (in "do:") is not a control the app knows.');
    expect(issue.message).toContain('Did you mean "playback.tempo"?');
  });

  it('a typo in how or mode suggests the right word', () => {
    expect(errorsOf(good('').replace('trigger', 'triger'))[0].message).toContain('Did you mean "trigger"?');
    expect(errorsOf(good('  mode: plya\n'))[0].message).toContain('Did you mean "play"?');
  });

  it('a name with no close match still gets a helpful pointer', () => {
    const [issue] = errorsOf(good('').replace('audio.clap', 'banana'));
    expect(issue.message).not.toContain('Did you mean');
    expect(issue.message).toContain('Command Lab');
  });

  it('missing when / do / how are each explained', () => {
    const text = messages('- name: empty\n  mode: play\n').join('\n');
    expect(text).toContain('no "when:" line');
    expect(text).toContain('no "do:" line');
    expect(text).toContain('no "how:" line');
  });

  it('a setting that looks like a typo of a real one gets a warning, but the rule still loads', () => {
    const result = loadMappings(good('  smothing: 0.5\n'));
    expect(result.rules).toHaveLength(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ level: 'warning' });
    expect(result.issues[0].message).toContain('Did you mean "smoothing"?');
  });

  it('wrong combinations: follow needs a slider signal and a number control', () => {
    const followMoment = errorsOf('- when: audio.clap\n  do: playback.tempo\n  how: follow\n');
    expect(followMoment[0].message).toContain('"follow" needs a slider signal');
    const followButton = errorsOf('- when: vision.hand.right.height\n  do: playback.pause\n  how: follow\n');
    expect(followButton[0].message).toContain('"follow" needs a control that holds a number');
  });

  it('wrong combinations: trigger, toggle and nudge need a moment signal', () => {
    for (const how of ['trigger', 'toggle', 'nudge']) {
      const control = how === 'toggle' ? 'playback.loop' : how === 'nudge' ? 'playback.tempo' : 'playback.pause';
      const [issue] = errorsOf(`- when: vision.hand.right.height\n  do: ${control}\n  how: ${how}\n  step: 0.1\n`);
      expect(issue.message).toContain(`"${how}" needs a moment signal`);
    }
  });

  it('wrong combinations: toggle needs an on/off control, nudge needs a number control', () => {
    expect(errorsOf('- when: audio.clap\n  do: playback.tempo\n  how: toggle\n')[0].message).toContain('"toggle" flips something on and off');
    expect(errorsOf('- when: audio.clap\n  do: playback.play\n  how: nudge\n  step: 1\n')[0].message).toContain('"nudge" moves a number');
    expect(errorsOf('- when: audio.clap\n  do: create.instrument\n  how: nudge\n  step: 1\n')[0].message).toContain('"nudge" moves a number');
  });

  it('a nudge with no step anywhere is explained', () => {
    // playback.loop_section is not a number control, so use a number control that has no catalog step
    const catalogs = {
      signals: [{ id: 'audio.clap', kind: 'moment' as const, source: 'audio' as const, description: '' }],
      controls: [{ id: 'playback.tempo', kind: 'value' as const, modes: ['play' as const], description: '' }],
    };
    const result = loadMappings('- when: audio.clap\n  do: playback.tempo\n  how: nudge\n', catalogs);
    expect(result.issues[0].message).toContain('needs a "step:"');
  });

  it('only_while must be something you can hold', () => {
    const notHoldable = errorsOf(good('  only_while: audio.snap\n'));
    expect(notHoldable[0].message).toContain('cannot be used in "only_while:"');
    const slider = errorsOf(good('  only_while: vision.hand.right.height\n'));
    expect(slider[0].message).toContain('cannot be used in "only_while:"');
    const typo = errorsOf(good('  only_while: vision.hand.left.fst\n'));
    expect(typo[0].message).toContain('Did you mean "vision.hand.left.fist"?');
    expect(loadMappings(good('  only_while: vision.hand.left.fist\n')).issues).toEqual([]);
  });

  it('a mode the control does not support is explained', () => {
    const [issue] = errorsOf('- mode: create\n  when: audio.clap\n  do: playback.tempo\n  how: trigger\n');
    expect(issue.message).toContain('"playback.tempo" does not work in create mode');
    expect(loadMappings('- mode: any\n  when: audio.clap\n  do: playback.pause\n  how: trigger\n').issues).toEqual([]);
  });

  it('bad numbers are explained', () => {
    expect(errorsOf(good('  smoothing: 1.5\n'))[0].message).toContain('"smoothing:" must be a number from 0');
    expect(errorsOf(good('  smoothing: -0.1\n'))[0].message).toContain('"smoothing:"');
    expect(errorsOf(good('  min_confidence: 2\n'))[0].message).toContain('"min_confidence:" must be a number from 0 to 1');
    expect(errorsOf(good('  cooldown_ms: -5\n'))[0].message).toContain('"cooldown_ms:" must be a number of milliseconds, 0 or more');
    expect(errorsOf(good('  cooldown_ms: soon\n'))[0].message).toContain('but it is "soon"');
    expect(errorsOf(good('  range: [1]\n'))[0].message).toContain('"range:" must be two numbers');
    expect(errorsOf(good('  range: [a, b]\n'))[0].message).toContain('"range:" must be two numbers');
    expect(errorsOf(good('  step: lots\n'))[0].message).toContain('"step:" must be a number');
    expect(errorsOf(good('  enabled: maybe\n'))[0].message).toContain('"enabled:" must be true or false');
    // the edges are fine
    expect(loadMappings(good('  smoothing: 0\n  min_confidence: 1\n  cooldown_ms: 0\n')).issues).toEqual([]);
  });

  it('a fixed value must fit the control', () => {
    expect(errorsOf('- when: audio.clap\n  do: create.instrument\n  how: trigger\n  value: banjo\n')[0].message).toContain('one of piano, synth');
    expect(errorsOf('- when: audio.clap\n  do: create.beat\n  how: toggle\n  value: loud\n')[0].message).toContain('true or false');
    expect(loadMappings('- when: audio.clap\n  do: create.instrument\n  how: trigger\n  value: synth\n').issues).toEqual([]);
  });

  it('a trigger on a number control without a value warns that it does nothing', () => {
    const result = loadMappings('- when: audio.clap\n  do: playback.tempo\n  how: trigger\n');
    expect(result.rules).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ level: 'warning' });
    expect(result.issues[0].message).toContain('"value:"');
  });

  it('a follow range that goes past the control warns', () => {
    const result = loadMappings('- when: vision.hand.right.height\n  do: playback.tempo\n  how: follow\n  range: [0.5, 3]\n');
    expect(result.rules).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ level: 'warning' });
  });

  it('two enabled rules on the same signal and control in the same mode get a conflict warning', () => {
    const yaml = `
- name: first
  mode: play
  when: audio.clap
  do: playback.toggle
  how: trigger
- name: second
  mode: play
  when: audio.clap
  do: playback.toggle
  how: trigger
`;
    const result = loadMappings(yaml);
    expect(result.rules).toHaveLength(2); // both still load
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ level: 'warning', where: 'rules 1 and 2' });
    expect(result.issues[0].message).toContain('fight each other');
    expect(result.issues[0].message).toContain('"first" and "second"');
  });

  it('no conflict when a rule is switched off or the modes differ', () => {
    const base = (mode: string, enabled: boolean) => `- mode: ${mode}\n  enabled: ${enabled}\n  when: audio.clap\n  do: playback.toggle\n  how: trigger\n`;
    expect(loadMappings(base('play', true) + base('play', false)).issues).toEqual([]);
    expect(loadMappings(base('play', true) + base('learn', true)).issues).toEqual([]);
    expect(loadMappings(base('play', true) + base('any', true)).issues).toHaveLength(1); // "any" overlaps play
  });

  it('YAML that cannot be read gives one friendly error and never throws', () => {
    const result = loadMappings('- name: x\n  when: [audio.clap\n  do: ???');
    expect(result.fatal).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].level).toBe('error');
    expect(result.issues[0].message).toContain('could not be read');
    expect(loadMappings('name: just a mapping, not a list').issues[0].message).toContain('list of rules');
  });

  it('a rule that is not a mapping is reported', () => {
    expect(errorsOf('- just words\n')[0].message).toContain('not a rule');
  });
});

describe('suggestions', () => {
  it('counts letter edits', () => {
    expect(editDistance('clap', 'clap')).toBe(0);
    expect(editDistance('clapp', 'clap')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('plya', 'play')).toBe(1); // two neighbouring letters swapped
  });
  it('suggests close names, including a name with its first part left off', () => {
    expect(suggest('audio.clapp', ['audio.clap', 'audio.snap'])).toEqual(['audio.clap']);
    expect(suggest('hand.right.height', ['vision.hand.right.height', 'audio.clap'])).toEqual(['vision.hand.right.height']);
    expect(suggest('zzzzzz', ['audio.clap', 'audio.snap'])).toEqual([]);
  });
});

describe('follow rules', () => {
  const FOLLOW = (extra: string) => `- when: vision.hand.right.height\n  do: playback.tempo\n  how: follow\n${extra}`;
  const run = (yaml: string) => {
    const { feed } = setup(yaml);
    return sweep.flatMap((s) => feed(s));
  };

  it('maps the hand sweep onto the range, smoothed, and sends fewer commands than readings', () => {
    const { feed } = setup(starterYaml);
    const all = sweep.flatMap((s) => feed(s));
    const values = all.map((e) => e.command.value as number);
    expect(all[0].command).toMatchObject({ command: 'playback.tempo', how: 'follow', source: 'gesture', mode: 'play', mapping: 'hand height controls tempo', signal: 'vision.hand.right.height', value: 0.55 });
    expect(values.every((v) => v >= 0.5 && v <= 1.5)).toBe(true);
    const peak = Math.max(...values);
    expect(peak).toBeGreaterThan(1.3);
    expect(peak).toBeLessThan(0.5 + 0.949); // smoothing makes the peak lag a little behind the raw 0.949
    expect(values.length).toBeGreaterThan(5);
    expect(values.length).toBeLessThan(sweep.length);
    // it rises, then falls back
    expect(values.indexOf(peak)).toBeGreaterThan(5);
    expect(values[values.length - 1]).toBeLessThan(0.7);
  });

  it('smoothing 0 is jumpy (follows exactly), higher smoothing lags behind', () => {
    const jumpy = run(FOLLOW('  smoothing: 0\n  range: [0, 1]\n'));
    const smooth = run(FOLLOW('  smoothing: 0.9\n  range: [0, 1]\n'));
    expect(Math.max(...jumpy.map((e) => e.command.value as number))).toBeCloseTo(0.949, 2);
    expect(Math.max(...smooth.map((e) => e.command.value as number))).toBeLessThan(0.85);
  });

  it('a reversed range runs backwards', () => {
    const { feed } = setup(FOLLOW('  range: [1.0, 0.5]\n'));
    expect(feed(slider('vision.hand.right.height', 0, 0))[0].command.value).toBe(1);
    expect(feed(slider('vision.hand.right.height', 1, 100))[0].command.value).toBe(0.5);
    expect(feed(slider('vision.hand.right.height', 0.5, 200))[0].command.value).toBe(0.75);
  });

  it('uses the control\'s own range when the rule has none', () => {
    const { feed } = setup(FOLLOW(''));
    expect(feed(slider('vision.hand.right.height', 1, 0))[0].command.value).toBe(1.5);
  });

  it('does not flood: tiny wobbles send nothing, a real move sends a command', () => {
    const { feed } = setup(FOLLOW('  range: [0, 1]\n'));
    expect(feed(slider('vision.hand.right.height', 0.5, 0))).toHaveLength(1);
    expect(feed(slider('vision.hand.right.height', 0.503, 20))).toHaveLength(0);
    expect(feed(slider('vision.hand.right.height', 0.497, 40))).toHaveLength(0);
    expect(feed(slider('vision.hand.right.height', 0.52, 60))).toHaveLength(1);
  });

  it('tells the Command Lab about follow rules at most about 5 times a second', () => {
    const { feed } = setup(FOLLOW('  range: [0, 1]\n'));
    const all = sweep.flatMap((s) => feed(s)); // the sweep lasts about 4 seconds
    const fired = all.filter((e) => e.fire);
    expect(all.length).toBeGreaterThan(fired.length);
    expect(fired.length).toBeGreaterThanOrEqual(1);
    expect(fired.length).toBeLessThanOrEqual(Math.ceil(3.9 * 5) + 1);
  });

  it('ignores readings the app is not sure about (min_confidence), and a missing confidence counts as sure', () => {
    const { feed } = setup(FOLLOW('  min_confidence: 0.6\n'));
    expect(feed(slider('vision.hand.right.height', 0.9, 0, 0.3))).toEqual([]);
    expect(feed(slider('vision.hand.right.height', 0.9, 100, 0.6))).toHaveLength(1);
    expect(feed(slider('vision.hand.right.height', 0.1, 200))).toHaveLength(1);
  });

  it('only runs in its mode, and "any" runs everywhere', () => {
    const play = setup(FOLLOW('  mode: play\n'), 'create');
    expect(play.feed(slider('vision.hand.right.height', 0.9, 0))).toEqual([]);
    play.engine.setMode('play');
    expect(play.feed(slider('vision.hand.right.height', 0.9, 100))).toHaveLength(1);
    const any = setup(FOLLOW('  mode: any\n'), 'create');
    expect(any.feed(slider('vision.hand.right.height', 0.9, 0))[0].command.mode).toBe('create'); // carries the current mode
  });
});

describe('trigger, toggle, nudge', () => {
  it('trigger fires on the start of a moment, not on its end', () => {
    const { feed } = setup(starterYaml);
    const out = feed(clap);
    expect(out).toHaveLength(1);
    expect(out[0].command).toMatchObject({ command: 'playback.toggle', how: 'trigger', source: 'gesture', mode: 'play', mapping: 'clap toggles play/pause', signal: 'audio.clap' });
    expect(out[0].command.value).toBeUndefined();
    expect(out[0].fire).toBe(true);
    expect(feed({ ...clap, state: 'end', t_ms: 5000 })).toEqual([]);
  });

  it('a moment with no state counts as a start', () => {
    const { feed } = setup(starterYaml);
    const { state, ...noState } = clap;
    expect(feed(noState)).toHaveLength(1);
  });

  it('trigger passes along its fixed value', () => {
    const { feed } = setup('- when: audio.clap\n  do: create.instrument\n  how: trigger\n  value: bass\n', 'create');
    expect(feed(clap)[0].command).toMatchObject({ command: 'create.instrument', how: 'trigger', value: 'bass' });
  });

  it('toggle sends a toggle command', () => {
    const { feed } = setup(starterYaml, 'create');
    const out = feed(moment('vision.hand.right.drum_hit', 100));
    expect(out[0].command).toMatchObject({ command: 'create.beat', how: 'toggle', source: 'gesture', mode: 'create' });
  });

  it('nudge sends its step as the value; voice keywords have source "voice"', () => {
    const { feed } = setup(starterYaml);
    feed(fist[0]); // left fist closes
    const slower = feed(moment('audio.keyword.slower', 2100, 'start', 0.9));
    expect(slower[0].command).toMatchObject({ command: 'playback.tempo', how: 'nudge', value: -0.1, source: 'voice', mapping: 'say "slower" only while left fist is held' });
    expect(feed(moment('audio.keyword.faster', 2200))[0].command.value).toBe(0.1);
    expect(feed(moment('audio.keyword.higher', 2300))[0].command).toMatchObject({ command: 'playback.pitch', how: 'nudge', value: 1 });
  });

  it('a nudge with no step uses the control\'s own step', () => {
    const { feed } = setup('- when: audio.clap\n  do: playback.tempo\n  how: nudge\n');
    expect(feed(clap)[0].command.value).toBe(0.1);
  });

  it('a moment-only rule ignores slider readings', () => {
    const { feed } = setup(starterYaml);
    expect(feed(slider('audio.clap', 0.9, 0))).toEqual([]);
  });
});

describe('cooldown', () => {
  it('blocks a second clap within 600 ms, then allows one after', () => {
    const { feed } = setup(starterYaml);
    expect(feed(moment('audio.clap', 1000))).toHaveLength(1);
    expect(feed(moment('audio.clap', 1400))).toHaveLength(0); // 400 ms later: blocked
    expect(feed(moment('audio.clap', 1599))).toHaveLength(0); // still inside the 600 ms
    expect(feed(moment('audio.clap', 1600))).toHaveLength(1); // 600 ms after the first one
    expect(feed(moment('audio.clap', 2000))).toHaveLength(0); // the cooldown restarted from 1600
  });

  it('is kept per rule', () => {
    const { feed } = setup(`
- when: audio.clap
  do: playback.toggle
  how: trigger
  cooldown_ms: 600
- when: audio.clap
  do: playback.play
  how: trigger
`);
    expect(feed(moment('audio.clap', 0))).toHaveLength(2);
    const second = feed(moment('audio.clap', 100));
    expect(second.map((e) => e.command.command)).toEqual(['playback.play']);
  });
});

describe('only_while (arming)', () => {
  it('blocks a keyword until the left fist starts, and again after it ends', () => {
    const { feed } = setup(starterYaml);
    expect(feed(moment('audio.keyword.pause', 1000))).toEqual([]); // fist not closed yet
    expect(feed(fist[0])).toEqual([]); // fist starts at 2000
    const armed = feed(moment('audio.keyword.pause', 2500));
    expect(armed).toHaveLength(1);
    expect(armed[0].command).toMatchObject({ command: 'playback.pause', source: 'voice' });
    expect(feed(fist[1])).toEqual([]); // fist opens at 3500
    expect(feed(moment('audio.keyword.pause', 3600))).toEqual([]); // blocked again
  });

  it('a different hand does not arm it', () => {
    const { feed } = setup(starterYaml);
    feed(moment('vision.hand.right.fist', 100));
    expect(feed(moment('audio.keyword.pause', 200))).toEqual([]);
  });
});

describe('switching rules off and reloading', () => {
  it('enabled: false skips the rule', () => {
    const { feed } = setup('- enabled: false\n  when: audio.clap\n  do: playback.toggle\n  how: trigger\n');
    expect(feed(clap)).toEqual([]);
    expect(loadMappings('- enabled: false\n  when: audio.clap\n  do: playback.toggle\n  how: trigger\n').rules[0].enabled).toBe(false);
  });

  it('bad YAML keeps the last good rules running and reports one error', () => {
    const { engine, feed } = setup(starterYaml);
    expect(feed(moment('audio.clap', 0))).toHaveLength(1);
    const issues = engine.load('- name: broken\n  when: [audio.clap\n  do: ???');
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe('error');
    expect(engine.rules).toHaveLength(10); // still the starter rules
    expect(feed(moment('audio.clap', 1000))).toHaveLength(1); // and they still work
  });

  it('a good reload replaces the rules at once', () => {
    const { engine, feed } = setup(starterYaml);
    engine.load('- when: audio.snap\n  do: playback.toggle\n  how: trigger\n');
    expect(feed(moment('audio.clap', 0))).toEqual([]);
    expect(feed(moment('audio.snap', 100))).toHaveLength(1);
    expect(engine.issues).toEqual([]);
  });

  it('a reload keeps a fist that is already held', () => {
    const { engine, feed } = setup(starterYaml);
    feed(fist[0]);
    engine.load(starterYaml);
    expect(feed(moment('audio.keyword.pause', 2500))).toHaveLength(1);
  });
});
