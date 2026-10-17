import { describe, expect, it } from 'vitest';
import type { Note } from '@/contracts';
import { BEAT_ID, type Layer } from './layers';
import { buildBeatNotes } from './music';
import { cleanNote, cleanTrackName, DEFAULT_TRACK_NAME, layersSignature, layersToPayload, MAX_BEATS, MAX_LAYERS, MAX_NOTES_PER_LAYER, MAX_TOTAL_NOTES, payloadToLayers } from './serialize';

const hum = (beat: number, pitch = 60): Note => ({ pitch, onset_sec: beat * 0.6, duration_sec: 0.6, onset_beat: beat, duration_beat: 1, confidence: 0.9 });
const layer = (n: number, over: Partial<Layer> = {}): Layer => ({
  id: `layer-${n}`,
  name: `Layer ${n}`,
  kind: 'hum',
  instrument: 'piano',
  volume: 0.8,
  effects: 'none',
  muted: false,
  notes: [hum(0), hum(1, 64), hum(2, 67)],
  ...over,
});
const beatLayer = (): Layer => ({ id: BEAT_ID, name: 'Beat', kind: 'beat', instrument: 'drums', volume: 0.8, effects: 'none', muted: false, notes: buildBeatNotes(100, 2) });
const viaJson = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('layersToPayload', () => {
  it('writes the plain shape the server keeps', () => {
    const payload = layersToPayload([layer(1, { instrument: 'bass', effects: 'reverb', volume: 0.5 })], 100, 'Tune');
    expect(payload).toEqual({
      name: 'Tune',
      tempo_bpm: 100,
      layers: [{ name: 'Layer 1', kind: 'hum', instrument: 'bass', volume: 0.5, effect: 'reverb', muted: false, notes: [hum(0), hum(1, 64), hum(2, 67)] }],
    });
  });

  it('gives a blank or odd name a default and strips control characters', () => {
    expect(layersToPayload([layer(1)], 100, '   ').name).toBe(DEFAULT_TRACK_NAME);
    expect(cleanTrackName('  a\u0000b\n c  ')).toBe('a b c');
    expect(cleanTrackName('x'.repeat(500))).toHaveLength(120);
    expect(cleanTrackName(42)).toBe(DEFAULT_TRACK_NAME);
  });

  it('has no NaN or infinity anywhere, so the server can always read it', () => {
    const numbers = (x: unknown): number[] => (typeof x === 'number' ? [x] : Array.isArray(x) ? x.flatMap(numbers) : typeof x === 'object' && x !== null ? Object.values(x).flatMap(numbers) : []);
    const bad: Layer = layer(1, { volume: NaN, notes: [hum(0), { ...hum(1), pitch: NaN }, { ...hum(2), onset_sec: Infinity, onset_beat: Infinity }] });
    const payload = layersToPayload([bad], NaN, 'x');
    expect(numbers(payload).every(Number.isFinite)).toBe(true);
    expect(payload.tempo_bpm).toBe(100);
    expect(payload.layers[0].volume).toBe(0.8);
    expect(payload.layers[0].notes).toHaveLength(1);
  });
});

describe('round trip', () => {
  it('brings back the same layers, with fresh ids', () => {
    const layers = [layer(1), layer(2, { instrument: 'pluck', effects: 'delay', volume: 0.35, name: 'Bass line' }), beatLayer()];
    const loaded = payloadToLayers(viaJson(layersToPayload(layers, 120, 'My song')));
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('My song');
    expect(loaded!.bpm).toBe(120);
    expect(loaded!.bars).toBe(2);
    expect(loaded!.layers).toEqual(layers);
    expect(loaded!.skippedLayers).toBe(0);
    expect(loaded!.skippedNotes).toBe(0);
  });

  it('makes new ids in order, so they do not depend on what was saved', () => {
    const layers = [layer(7), layer(3), layer(9)];
    const loaded = payloadToLayers(viaJson(layersToPayload(layers, 100, 'x')))!;
    expect(loaded.layers.map((l) => l.id)).toEqual(['layer-1', 'layer-2', 'layer-3']);
    expect(loaded.layers.map((l) => l.name)).toEqual(['Layer 7', 'Layer 3', 'Layer 9']);
  });

  it('keeps a muted layer muted and its volume unchanged', () => {
    const loaded = payloadToLayers(viaJson(layersToPayload([layer(1, { muted: true, volume: 0.6 })], 100, 'x')))!;
    expect(loaded.layers[0]).toMatchObject({ muted: true, volume: 0.6 });
  });

  it('keeps the beat last and named, even if it was saved first', () => {
    const payload = viaJson(layersToPayload([beatLayer(), layer(1)], 100, 'x'));
    const loaded = payloadToLayers(payload)!;
    expect(loaded.layers.map((l) => l.id)).toEqual(['layer-1', BEAT_ID]);
    expect(loaded.layers[1].instrument).toBe('drums');
  });

  it('works for an empty layer too', () => {
    const empty = layer(1, { notes: [] });
    expect(payloadToLayers(viaJson(layersToPayload([empty, layer(2)], 100, 'x')))!.layers[0]).toEqual(empty);
  });

  it('a longer loop gets more bars, never fewer than two', () => {
    const long = layer(1, { notes: [hum(0), hum(9.5)] });
    expect(payloadToLayers(viaJson(layersToPayload([long], 100, 'x')))!.bars).toBe(3);
    expect(payloadToLayers(viaJson(layersToPayload([layer(1, { notes: [hum(0)] })], 100, 'x')))!.bars).toBe(2);
  });

  it('the signature changes when something worth saving changes, and only then', () => {
    const base = layersSignature([layer(1)], 100);
    expect(layersSignature([layer(1)], 100)).toBe(base);
    expect(layersSignature([layer(1, { volume: 0.2 })], 100)).not.toBe(base);
    expect(layersSignature([layer(1, { muted: true })], 100)).not.toBe(base);
    expect(layersSignature([layer(1, { notes: [hum(0)] })], 100)).not.toBe(base);
    expect(layersSignature([{ ...layer(1), id: 'other' }], 100)).toBe(base);
  });
});

describe('payloadToLayers with bad input', () => {
  it.each([null, undefined, 5, 'text', true, [], {}, { layers: 'nope' }, { layers: {} }, { layers: [] }, { layers: [null, 3, 'x', []] }])('gives nothing for %j', (input) => {
    expect(payloadToLayers(input)).toBeNull();
  });

  it('ignores junk layers but keeps the good one', () => {
    const loaded = payloadToLayers({ name: 'x', tempo_bpm: 100, layers: [null, 'a', 7, { name: 'ok', notes: [hum(0)] }] })!;
    expect(loaded.layers).toHaveLength(1);
    expect(loaded.layers[0].name).toBe('ok');
    expect(loaded.skippedLayers).toBe(3);
  });

  it('repairs a layer that has missing or wrong fields', () => {
    const loaded = payloadToLayers({
      tempo_bpm: 100,
      layers: [{ name: 12, instrument: 'kazoo', effect: 'sparkle', volume: 'loud', muted: 'yes', notes: 'none', extra: { deep: true }, kind: 'wat' }],
    })!;
    expect(loaded.layers[0]).toEqual({ id: 'layer-1', name: 'Layer 1', kind: 'hum', instrument: 'piano', volume: 0.8, effects: 'none', muted: false, notes: [] });
  });

  it('keeps volume between 0 and 1', () => {
    const volumes = [5, -2, 0.4, Infinity, NaN, null].map((volume) => ({ volume, notes: [] }));
    const loaded = payloadToLayers({ tempo_bpm: 100, layers: volumes })!;
    expect(loaded.layers.map((l) => l.volume)).toEqual([1, 0, 0.4, 0.8, 0.8, 0.8]);
  });

  it('drops notes with a bad pitch or bad times and counts them', () => {
    const notes = [
      hum(0),
      { ...hum(1), pitch: NaN },
      { ...hum(1), pitch: 'C4' },
      { ...hum(1), pitch: -1 },
      { ...hum(1), pitch: 128 },
      { ...hum(1), pitch: null },
      { pitch: 60 },
      { ...hum(1), duration_beat: 0, duration_sec: 0 },
      { ...hum(1), duration_beat: -1, duration_sec: -1 },
      { ...hum(1), onset_beat: MAX_BEATS, onset_sec: 1000 },
      null,
      'note',
      [],
      hum(3),
    ];
    const loaded = payloadToLayers({ tempo_bpm: 100, layers: [{ name: 'a', notes }] })!;
    expect(loaded.layers[0].notes).toEqual([hum(0), hum(3)]);
    expect(loaded.skippedNotes).toBe(notes.length - 2);
  });

  it('clamps velocity and confidence and ignores wrong extras', () => {
    const note = cleanNote({ ...hum(0), velocity: 7, confidence: -3, part: 5, id: {} }, 100)!;
    expect(note).toMatchObject({ velocity: 1, confidence: 0 });
    expect(note).not.toHaveProperty('part');
    expect(note).not.toHaveProperty('id');
  });

  it('fills in beats from seconds, and seconds from beats', () => {
    expect(cleanNote({ pitch: 60, onset_sec: 0.6, duration_sec: 0.3 }, 100)).toMatchObject({ onset_beat: 1, duration_beat: 0.5 });
    expect(cleanNote({ pitch: 60, onset_beat: 2, duration_beat: 1 }, 120)).toMatchObject({ onset_sec: 1, duration_sec: 0.5 });
  });

  it('stops a note at the end of the longest loop, and lifts a slightly early one to zero', () => {
    expect(cleanNote({ ...hum(0), onset_beat: 62, onset_sec: 37, duration_beat: 10, duration_sec: 6 }, 100)!.duration_beat).toBe(2);
    expect(cleanNote({ ...hum(0), onset_beat: -0.02, onset_sec: -0.01 }, 100)).toMatchObject({ onset_beat: 0, onset_sec: 0 });
  });

  it('caps the layers, the notes per layer and the notes overall', () => {
    const many = Array.from({ length: MAX_LAYERS + 10 }, (_, i) => ({ name: `L${i}`, notes: [hum(0)] }));
    const capped = payloadToLayers({ tempo_bpm: 100, layers: many })!;
    expect(capped.layers).toHaveLength(MAX_LAYERS);
    expect(capped.skippedLayers).toBe(10);

    const longNotes = Array.from({ length: MAX_NOTES_PER_LAYER + 500 }, (_, i) => hum(i % 60));
    const one = payloadToLayers({ tempo_bpm: 100, layers: [{ notes: longNotes }] })!;
    expect(one.layers[0].notes).toHaveLength(MAX_NOTES_PER_LAYER);
    expect(one.skippedNotes).toBe(500);

    const heavy = Array.from({ length: 10 }, () => ({ notes: longNotes.slice(0, MAX_NOTES_PER_LAYER) }));
    const total = payloadToLayers({ tempo_bpm: 100, layers: heavy })!;
    expect(total.layers.reduce((n, l) => n + l.notes.length, 0)).toBe(MAX_TOTAL_NOTES);
  });

  it('allows only one beat layer and forces it to drums', () => {
    const loaded = payloadToLayers({
      tempo_bpm: 100,
      layers: [
        { kind: 'beat', instrument: 'piano', name: 'B1', notes: buildBeatNotes(100, 2) },
        { kind: 'beat', name: 'B2', notes: buildBeatNotes(100, 2) },
      ],
    })!;
    expect(loaded.layers).toHaveLength(1);
    expect(loaded.layers[0]).toMatchObject({ id: BEAT_ID, kind: 'beat', instrument: 'drums', name: 'B1' });
    expect(loaded.skippedLayers).toBe(1);
  });

  it('uses a sane tempo when the saved one is wrong', () => {
    const at = (tempo_bpm: unknown) => payloadToLayers({ tempo_bpm, layers: [{ notes: [] }] })!.bpm;
    expect([at(NaN), at('fast'), at(null), at(-5), at(0)]).toEqual([100, 100, 100, 100, 100]);
    expect([at(5), at(5000), at(90)]).toEqual([20, 400, 90]);
  });

  it('does not copy odd keys onto the layers', () => {
    const payload = JSON.parse('{"tempo_bpm":100,"layers":[{"__proto__":{"polluted":true},"constructor":"x","notes":[],"name":"a"}]}') as unknown;
    const loaded = payloadToLayers(payload)!;
    expect(Object.keys(loaded.layers[0]).sort()).toEqual(['effects', 'id', 'instrument', 'kind', 'muted', 'name', 'notes', 'volume']);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('never throws on any odd value', () => {
    const odd: unknown[] = [undefined, null, NaN, Infinity, -0, 0, '', 'x'.repeat(10000), true, [], [[]], {}, { a: { b: { c: {} } } }, () => 1, Symbol('s'), 10n];
    for (const a of odd) {
      for (const b of odd) {
        expect(() => payloadToLayers({ name: a, tempo_bpm: a, layers: [{ name: a, kind: a, instrument: a, volume: a, effect: a, muted: a, notes: [{ pitch: a, onset_sec: b, duration_sec: b, onset_beat: a, duration_beat: b, velocity: a, part: a, id: b }, b] }, b] })).not.toThrow();
      }
    }
  });
});
