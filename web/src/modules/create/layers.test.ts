import { describe, expect, it } from 'vitest';
import type { Note } from '@/contracts';
import { audibleLayers, BEAT_ID, currentLayer, describeState, hasBeat, initialState, reduce, type Action, type CreateState } from './layers';
import { buildBeatNotes } from './music';

const run = (actions: Action[], from: CreateState = initialState()) => actions.reduce(reduce, from);
const note = (pitch: number, beat: number): Note => ({ pitch, onset_beat: beat, duration_beat: 1, onset_sec: beat * 0.6, duration_sec: 0.6 });
const take = [note(60, 0), note(64, 1), note(67, 2)];

describe('layers: adding and choosing', () => {
  it('starts empty and idle', () => {
    const s = initialState();
    expect(s.layers).toEqual([]);
    expect(s.currentId).toBeNull();
    expect(s.phase).toBe('idle');
    expect(s.bpm).toBe(100);
    expect(s.bars).toBe(2);
  });

  it('adds an empty layer and makes it current', () => {
    const s = run([{ type: 'addLayer' }]);
    expect(s.layers).toHaveLength(1);
    expect(s.layers[0]).toMatchObject({ name: 'Layer 1', instrument: 'piano', volume: 0.8, effects: 'none', muted: false, notes: [] });
    expect(currentLayer(s)?.id).toBe(s.layers[0].id);
  });

  it('each new layer becomes the current one and gets its own name', () => {
    const s = run([{ type: 'addLayer' }, { type: 'addLayer' }, { type: 'addLayer' }]);
    expect(s.layers.map((l) => l.name)).toEqual(['Layer 1', 'Layer 2', 'Layer 3']);
    expect(currentLayer(s)?.name).toBe('Layer 3');
  });

  it('selects another layer, and ignores an id that does not exist', () => {
    let s = run([{ type: 'addLayer' }, { type: 'addLayer' }]);
    s = reduce(s, { type: 'selectLayer', id: s.layers[0].id });
    expect(currentLayer(s)?.name).toBe('Layer 1');
    expect(reduce(s, { type: 'selectLayer', id: 'nope' })).toBe(s);
  });
});

describe('layers: instrument, volume, effects, mute', () => {
  it('changes only the current layer', () => {
    let s = run([{ type: 'addLayer' }, { type: 'addLayer' }]);
    s = run([{ type: 'setInstrument', value: 'bass' }, { type: 'setVolume', value: 0.3 }, { type: 'setEffects', value: 'reverb' }], s);
    expect(s.layers[0]).toMatchObject({ instrument: 'piano', volume: 0.8, effects: 'none' });
    expect(s.layers[1]).toMatchObject({ instrument: 'bass', volume: 0.3, effects: 'reverb' });
  });

  it('a changed instrument keeps the notes', () => {
    let s = run([{ type: 'addLayer' }, { type: 'recordStart' }, { type: 'recordGo' }, { type: 'recordEnd', notes: take }]);
    s = reduce(s, { type: 'setInstrument', value: 'pluck' });
    expect(currentLayer(s)?.instrument).toBe('pluck');
    expect(currentLayer(s)?.notes).toEqual(take);
  });

  it('keeps volume between 0 and 1', () => {
    let s = run([{ type: 'addLayer' }, { type: 'setVolume', value: 4 }]);
    expect(currentLayer(s)?.volume).toBe(1);
    s = reduce(s, { type: 'setVolume', value: -2 });
    expect(currentLayer(s)?.volume).toBe(0);
  });

  it('the next new layer starts with the last instrument that was chosen', () => {
    const s = run([{ type: 'addLayer' }, { type: 'setInstrument', value: 'synth' }, { type: 'addLayer' }]);
    expect(s.layers[1].instrument).toBe('synth');
  });

  it('does nothing to a layer when there is none', () => {
    const s = initialState();
    expect(reduce(s, { type: 'setVolume', value: 0.2 }).layers).toEqual([]);
    expect(reduce(s, { type: 'setEffects', value: 'delay' }).layers).toEqual([]);
  });

  it('mutes and unmutes a layer, which takes it out of the audible ones', () => {
    let s = run([{ type: 'addLayer' }, { type: 'recordStart' }, { type: 'recordGo' }, { type: 'recordEnd', notes: take }]);
    const id = s.layers[0].id;
    expect(audibleLayers(s)).toHaveLength(1);
    s = reduce(s, { type: 'setMuted', id, muted: true });
    expect(audibleLayers(s)).toHaveLength(0);
    s = reduce(s, { type: 'setMuted', id, muted: false });
    expect(audibleLayers(s)).toHaveLength(1);
  });
});

describe('layers: recording', () => {
  it('goes idle -> count-in -> recording -> playing and keeps the notes in the layer', () => {
    let s = run([{ type: 'addLayer' }]);
    s = reduce(s, { type: 'recordStart' });
    expect(s.phase).toBe('countIn');
    s = reduce(s, { type: 'recordGo' });
    expect(s.phase).toBe('recording');
    s = reduce(s, { type: 'recordEnd', notes: take, message: 'Recorded 3 notes' });
    expect(s.phase).toBe('playing');
    expect(s.layers).toHaveLength(1);
    expect(s.layers[0].notes).toEqual(take);
    expect(s.message).toBe('Recorded 3 notes');
    expect(s.recordingId).toBeNull();
  });

  it('makes a layer by itself when you record with none', () => {
    const s = reduce(initialState(), { type: 'recordStart' });
    expect(s.layers).toHaveLength(1);
    expect(s.recordingId).toBe(s.layers[0].id);
  });

  it('records into the current layer, replacing its notes', () => {
    const newer = [note(72, 0)];
    let s = run([{ type: 'addLayer' }, { type: 'recordStart' }, { type: 'recordGo' }, { type: 'recordEnd', notes: take }]);
    s = run([{ type: 'stop' }, { type: 'recordStart' }, { type: 'recordGo' }, { type: 'recordEnd', notes: newer }], s);
    expect(s.layers).toHaveLength(1);
    expect(s.layers[0].notes).toEqual(newer);
  });

  it('adds up layers: a second take goes into the new layer and leaves the first alone', () => {
    let s = run([{ type: 'addLayer' }, { type: 'recordStart' }, { type: 'recordGo' }, { type: 'recordEnd', notes: take }]);
    s = run([{ type: 'addLayer' }, { type: 'recordStart' }, { type: 'recordGo' }, { type: 'recordEnd', notes: [note(50, 0)] }], s);
    expect(s.layers.map((l) => l.notes.length)).toEqual([3, 1]);
  });

  it('an empty take leaves the layer as it was', () => {
    let s = run([{ type: 'addLayer' }, { type: 'recordStart' }, { type: 'recordGo' }, { type: 'recordEnd', notes: take }]);
    s = run([{ type: 'recordStart' }, { type: 'recordGo' }, { type: 'recordEnd', notes: [], message: 'No hum heard' }], s);
    expect(s.layers[0].notes).toEqual(take);
    expect(s.message).toBe('No hum heard');
  });

  it('an empty first take leaves nothing to play, so the loop goes idle', () => {
    const s = run([{ type: 'addLayer' }, { type: 'recordStart' }, { type: 'recordGo' }, { type: 'recordEnd', notes: [] }]);
    expect(s.phase).toBe('idle');
  });

  it('cancelling the count-in changes no notes', () => {
    let s = run([{ type: 'addLayer' }, { type: 'recordStart' }]);
    s = reduce(s, { type: 'recordCancel' });
    expect(s.phase).toBe('idle');
    expect(s.recordingId).toBeNull();
    expect(s.layers[0].notes).toEqual([]);
  });

  it('ignores a second record while one is going', () => {
    const a = run([{ type: 'addLayer' }, { type: 'recordStart' }]);
    expect(reduce(a, { type: 'recordStart' })).toBe(a);
  });
});

describe('layers: play and stop', () => {
  it('only plays when there is something to hear', () => {
    expect(reduce(run([{ type: 'addLayer' }]), { type: 'play' }).phase).toBe('idle');
    const s = run([{ type: 'addLayer' }, { type: 'recordStart' }, { type: 'recordGo' }, { type: 'recordEnd', notes: take }, { type: 'stop' }]);
    expect(s.phase).toBe('idle');
    expect(reduce(s, { type: 'play' }).phase).toBe('playing');
  });

  it('stop ends the loop and any recording but keeps every layer', () => {
    let s = run([{ type: 'addLayer' }, { type: 'recordStart' }, { type: 'recordGo' }, { type: 'recordEnd', notes: take }, { type: 'recordStart' }]);
    expect(s.phase).toBe('countIn');
    s = reduce(s, { type: 'stop' });
    expect(s.phase).toBe('idle');
    expect(s.recordingId).toBeNull();
    expect(s.layers[0].notes).toEqual(take);
  });
});

describe('layers: beat', () => {
  it('beat on adds a drum layer with kick, snare and hat; off removes it', () => {
    let s = reduce(initialState(), { type: 'beatOn' });
    expect(hasBeat(s)).toBe(true);
    const beat = s.layers.find((l) => l.id === BEAT_ID)!;
    expect(beat.instrument).toBe('drums');
    expect(beat.notes).toEqual(buildBeatNotes(100, 2));
    expect(new Set(beat.notes.map((n) => n.pitch)).size).toBe(3);
    s = reduce(s, { type: 'beatOff' });
    expect(hasBeat(s)).toBe(false);
    expect(s.layers).toEqual([]);
  });

  it('beat on twice makes one beat layer', () => {
    const s = run([{ type: 'beatOn' }, { type: 'beatOn' }]);
    expect(s.layers).toHaveLength(1);
  });

  it('does not take over the current layer', () => {
    const s = run([{ type: 'addLayer' }, { type: 'beatOn' }]);
    expect(currentLayer(s)?.kind).toBe('hum');
  });

  it('recording while the beat is the current layer goes into a new layer, not into the beat', () => {
    let s = run([{ type: 'beatOn' }]);
    s = reduce(s, { type: 'selectLayer', id: BEAT_ID });
    s = run([{ type: 'recordStart' }, { type: 'recordGo' }, { type: 'recordEnd', notes: take }], s);
    expect(s.layers.find((l) => l.id === BEAT_ID)!.notes).toEqual(buildBeatNotes(100, 2));
    expect(s.layers.find((l) => l.kind === 'hum')!.notes).toEqual(take);
  });

  it('changing the instrument does not turn the beat into something else', () => {
    let s = run([{ type: 'beatOn' }]);
    s = run([{ type: 'selectLayer', id: BEAT_ID }, { type: 'setInstrument', value: 'piano' }], s);
    expect(s.layers[0].instrument).toBe('drums');
  });

  it('beat off while playing with nothing else stops the loop; with other notes it keeps going', () => {
    let s = run([{ type: 'beatOn' }, { type: 'play' }]);
    expect(s.phase).toBe('playing');
    expect(reduce(s, { type: 'beatOff' }).phase).toBe('idle');
    s = run([{ type: 'addLayer' }, { type: 'recordStart' }, { type: 'recordGo' }, { type: 'recordEnd', notes: take }, { type: 'beatOn' }]);
    expect(reduce(s, { type: 'beatOff' }).phase).toBe('playing');
  });

  it('keeps the beat last in the list when more layers are added', () => {
    const s = run([{ type: 'beatOn' }, { type: 'addLayer' }]);
    expect(s.layers.map((l) => l.kind)).toEqual(['hum', 'beat']);
  });
});

describe('layers: words for the screen', () => {
  it('describes each phase in plain words', () => {
    let s = run([{ type: 'addLayer' }]);
    expect(describeState(s)).toBe('Ready: add a layer or press Record');
    s = reduce(s, { type: 'recordStart' });
    expect(describeState(s)).toBe('Get ready: counting in one bar');
    s = reduce(s, { type: 'recordGo' });
    expect(describeState(s)).toBe('Recording: hum now');
    s = reduce(s, { type: 'recordEnd', notes: take });
    expect(describeState(s)).toBe('Loop playing, 1 layer');
    s = run([{ type: 'addLayer' }, { type: 'beatOn' }], s);
    s = run([{ type: 'selectLayer', id: s.layers[1].id }, { type: 'recordStart' }, { type: 'recordGo' }, { type: 'recordEnd', notes: [note(55, 0)] }], s);
    expect(describeState(s)).toBe('Loop playing, 3 layers');
    expect(describeState(reduce(s, { type: 'stop' }))).toBe('Stopped, 3 layers ready');
  });
});
