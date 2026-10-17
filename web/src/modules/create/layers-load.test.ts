import { describe, expect, it } from 'vitest';
import type { Note } from '@/contracts';
import { BEAT_ID, initialState, reduce, type Layer } from './layers';
import { buildBeatNotes } from './music';

const note = (beat: number): Note => ({ pitch: 60, onset_beat: beat, duration_beat: 1, onset_sec: beat * 0.5, duration_sec: 0.5 });
const hum = (n: number): Layer => ({ id: `layer-${n}`, name: `Layer ${n}`, kind: 'hum', instrument: 'synth', volume: 0.5, effects: 'none', muted: false, notes: [note(0)] });
const beat = (): Layer => ({ id: BEAT_ID, name: 'Beat', kind: 'beat', instrument: 'drums', volume: 0.8, effects: 'none', muted: false, notes: buildBeatNotes(120, 3) });

describe('layers: loading a saved track', () => {
  it('replaces the layers, the tempo and the loop length, and makes the last hum layer current', () => {
    let s = reduce(initialState(), { type: 'addLayer' });
    s = reduce(s, { type: 'loadTrack', bpm: 120, bars: 3, layers: [hum(1), hum(2), beat()] });
    expect(s.layers.map((l) => l.id)).toEqual(['layer-1', 'layer-2', BEAT_ID]);
    expect(s).toMatchObject({ bpm: 120, bars: 3, currentId: 'layer-2', phase: 'idle', recordingId: null, message: '' });
  });

  it('lets the next new layer follow on from the loaded ones, and keeps the beat last', () => {
    let s = reduce(initialState(), { type: 'loadTrack', bpm: 100, bars: 2, layers: [hum(1), hum(2), beat()] });
    s = reduce(s, { type: 'addLayer' });
    expect(s.layers.map((l) => l.id)).toEqual(['layer-1', 'layer-2', 'layer-3', BEAT_ID]);
  });

  it('stops a loop that was playing', () => {
    let s = reduce(initialState(), { type: 'loadTrack', bpm: 100, bars: 2, layers: [hum(1)] });
    s = reduce(s, { type: 'play' });
    expect(s.phase).toBe('playing');
    expect(reduce(s, { type: 'loadTrack', bpm: 100, bars: 2, layers: [hum(1), hum(2)] }).phase).toBe('idle');
  });

  it('is ignored during a take', () => {
    let s = reduce(initialState(), { type: 'addLayer' });
    s = reduce(s, { type: 'recordStart' });
    expect(reduce(s, { type: 'loadTrack', bpm: 90, bars: 2, layers: [hum(1)] })).toBe(s);
  });

  it('an empty list clears everything', () => {
    let s = reduce(initialState(), { type: 'loadTrack', bpm: 100, bars: 2, layers: [hum(1)] });
    s = reduce(s, { type: 'loadTrack', bpm: 100, bars: 2, layers: [] });
    expect(s.layers).toEqual([]);
    expect(s.currentId).toBeNull();
  });
});
