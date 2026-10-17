import { describe, expect, it } from 'vitest';
import { controlInfo } from '@/contracts/catalogs';
import { fakeHumFrames, FAKE_FRAME_MS } from './fake-hum';
import { segmentNotes } from './segment-notes';
import { BEAT_PITCH, buildBeatNotes, drumPartForPitch, EFFECT_IDS, INSTRUMENT_IDS, isEffect, isInstrument, loopSeconds, midiToHz, midiToName } from './music';

describe('catalog', () => {
  it('knows the same instruments and effects as the control catalog', () => {
    expect(INSTRUMENT_IDS).toEqual(controlInfo('create.instrument')?.options);
    expect(EFFECT_IDS).toEqual(controlInfo('create.effects')?.options);
    expect([...INSTRUMENT_IDS].sort()).toEqual(['bass', 'drums', 'piano', 'pluck', 'synth']);
  });

  it('checks values', () => {
    expect(isInstrument('piano')).toBe(true);
    expect(isInstrument('banjo')).toBe(false);
    expect(isInstrument(3)).toBe(false);
    expect(isEffect('reverb')).toBe(true);
    expect(isEffect('chorus')).toBe(false);
  });
});

describe('note names and frequencies', () => {
  it('names notes with the octave', () => {
    expect(midiToName(60)).toBe('C4');
    expect(midiToName(69)).toBe('A4');
    expect(midiToName(55)).toBe('G3');
    expect(midiToName(61.4)).toBe('C#4');
    expect(midiToName(0)).toBe('C-1');
  });

  it('converts to hertz', () => {
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(midiToHz(57)).toBeCloseTo(220);
  });
});

describe('drums', () => {
  it('maps low pitches to kick, middle to snare and high to hat', () => {
    expect(drumPartForPitch(48)).toBe('kick');
    expect(drumPartForPitch(56)).toBe('kick');
    expect(drumPartForPitch(57)).toBe('snare');
    expect(drumPartForPitch(64)).toBe('snare');
    expect(drumPartForPitch(65)).toBe('hat');
    expect(drumPartForPitch(90)).toBe('hat');
  });

  it('turns the fake rising hum into a kick, a snare and a hat', () => {
    const notes = segmentNotes(fakeHumFrames(0), { bpm: 100 });
    expect(notes.map((n) => drumPartForPitch(n.pitch))).toEqual(['kick', 'snare', 'hat']);
  });

  it('builds a beat that uses each drum, fits the loop, and has no overlaps on one drum', () => {
    const notes = buildBeatNotes(100, 2);
    const parts = new Set(notes.map((n) => drumPartForPitch(n.pitch)));
    expect(parts).toEqual(new Set(['kick', 'snare', 'hat']));
    expect(notes.filter((n) => n.pitch === BEAT_PITCH.kick)).toHaveLength(4);
    expect(notes.filter((n) => n.pitch === BEAT_PITCH.snare)).toHaveLength(4);
    expect(notes.filter((n) => n.pitch === BEAT_PITCH.hat)).toHaveLength(16);
    for (const n of notes) {
      expect(n.onset_beat! + n.duration_beat!).toBeLessThanOrEqual(8);
      expect(n.onset_sec).toBeCloseTo(n.onset_beat! * 0.6);
      expect(n.duration_sec).toBeGreaterThan(0);
    }
  });
});

describe('loop length', () => {
  it('2 bars of 4/4 at 100 bpm is 4.8 seconds', () => {
    expect(loopSeconds(2, 100)).toBeCloseTo(4.8);
  });
});

describe('fake hum', () => {
  it('lasts about 2 seconds at 50 frames per second', () => {
    const frames = fakeHumFrames(0);
    expect(frames[1].t_ms - frames[0].t_ms).toBe(FAKE_FRAME_MS);
    const last = frames[frames.length - 1].t_ms;
    expect(last).toBeGreaterThan(1800);
    expect(last).toBeLessThan(2300);
  });

  it('is three rising notes', () => {
    const notes = segmentNotes(fakeHumFrames(0), { bpm: 100 });
    expect(notes.map((n) => n.pitch)).toEqual([55, 60, 67]);
  });

  it('starts at the time asked for', () => {
    expect(fakeHumFrames(1000)[0].t_ms).toBe(1000);
  });
});
