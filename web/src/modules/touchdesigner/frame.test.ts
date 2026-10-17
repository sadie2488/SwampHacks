import { describe, expect, it } from 'vitest';
import type { Signal } from '@/contracts';
import { AUDIO_FRESH_MS, HAND_TIMEOUT_MS, buildFrame, createTracker, emptyState } from './frame';
import { shapeProblems } from './frame.test-util';

let clock = 1000;
const make = () => createTracker(() => clock);
const slider = (id: string, value: number): Signal => ({ version: 1, id, kind: 'slider', value, t_ms: clock });
const moment = (id: string, state?: 'start' | 'end'): Signal => ({ version: 1, id, kind: 'moment', state, t_ms: clock });

describe('buildFrame: nothing has arrived yet', () => {
  it('gives a valid, quiet frame', () => {
    const frame = buildFrame(emptyState(), 2500);
    expect(shapeProblems(frame)).toEqual([]);
    expect(frame).toEqual({
      version: 1,
      t_ms: 2500,
      audio: { rms: 0, onset: false, pitch_midi: null, bands: [0, 0, 0, 0, 0, 0, 0, 0] },
      hands: { left: null, right: null },
    });
  });

  it('survives a trip through JSON unchanged (no NaN or undefined sneaks in)', () => {
    const frame = buildFrame(emptyState(), 10);
    expect(JSON.parse(JSON.stringify(frame))).toEqual(frame);
  });
});

describe('buildFrame: filling in from the bus', () => {
  it('uses the mode, intensity, mic frame, beat info and hands', () => {
    clock = 5000;
    const t = make();
    t.setMode('play');
    t.setControls({ 'visual.intensity': 0.6, 'playback.tempo': 1 });
    t.onPitch({ midi: 62.2, rms: 0.35 });
    t.onTransport({ bpm: 100, beatPhase: 0.25 });
    t.onSignal(slider('vision.hand.right.x', 0.62));
    t.onSignal(slider('vision.hand.right.height', 0.7));
    t.onSignal(moment('vision.hand.right.open_palm', 'start'));
    t.onSignal(slider('vision.hands.distance', 0.4));
    const frame = t.frame();
    expect(shapeProblems(frame)).toEqual([]);
    expect(frame).toEqual({
      version: 1,
      t_ms: 5000,
      mode: 'play',
      intensity: 0.6,
      audio: { rms: 0.35, onset: false, pitch_midi: 62.2, bpm: 100, beat_phase: 0.25, bands: [0, 0, 0, 0, 0, 0, 0, 0] },
      hands: { left: null, right: { x: 0.62, y: 0.3, height: 0.7, fist: false, open_palm: true, pinch: 0 }, distance: 0.4 },
    });
  });

  it('follows left and right hands separately, with fist and pinch as held states', () => {
    clock = 100;
    const t = make();
    t.onSignal(slider('vision.hand.left.x', 0.1));
    t.onSignal(slider('vision.hand.left.height', 0.2));
    t.onSignal(moment('vision.hand.left.fist', 'start'));
    t.onSignal(slider('vision.hand.right.x', 0.9));
    t.onSignal(slider('vision.hand.right.height', 0.8));
    t.onSignal(moment('vision.hand.right.pinch', 'start'));
    let frame = t.frame();
    expect(frame.hands.left).toEqual({ x: 0.1, y: 0.8, height: 0.2, fist: true, open_palm: false, pinch: 0 });
    expect(frame.hands.right).toEqual({ x: 0.9, y: 0.2, height: 0.8, fist: false, open_palm: false, pinch: 1 });

    clock = 200;
    t.onSignal(moment('vision.hand.left.fist', 'end'));
    t.onSignal(moment('vision.hand.right.pinch', 'end'));
    frame = t.frame();
    expect(frame.hands.left?.fist).toBe(false);
    expect(frame.hands.right?.pinch).toBe(0);
  });

  it('falls back to audio.loudness when there is no mic frame, and uses the louder of the two otherwise', () => {
    clock = 0;
    const t = make();
    t.onSignal(slider('audio.loudness', 0.4));
    expect(t.frame().audio.rms).toBe(0.4);
    t.onPitch({ midi: null, rms: 0.7 });
    expect(t.frame().audio.rms).toBe(0.7);
    expect(t.frame().audio.pitch_midi).toBeNull();
  });

  it('drops mic readings that are too old', () => {
    clock = 0;
    const t = make();
    t.onPitch({ midi: 60, rms: 0.5 });
    t.onSignal(slider('audio.loudness', 0.5));
    clock = AUDIO_FRESH_MS;
    expect(t.frame().audio).toMatchObject({ rms: 0.5, pitch_midi: 60 });
    clock = AUDIO_FRESH_MS + 1;
    expect(t.frame().audio).toMatchObject({ rms: 0, pitch_midi: null });
  });

  it('uses eight band values when given, and zeros if the list is the wrong size', () => {
    const state = emptyState();
    state.bands = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3];
    expect(buildFrame(state, 0).audio.bands).toEqual([1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]);
    state.bands = [1, 1, 1];
    expect(buildFrame(state, 0).audio.bands).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('keeps out-of-range readings inside the contract', () => {
    const state = emptyState();
    state.controls = { 'visual.intensity': 7 };
    state.pitch = { midi: Number.NaN, rms: 3, at: 0 };
    state.transport = { bpm: -5, beatPhase: 1.5 };
    state.distance = { value: -2, at: 0 };
    state.hands.left = { x: -1, height: 2, fist: false, openPalm: false, pinch: false, seenAt: 0 };
    const frame = buildFrame(state, 10);
    expect(shapeProblems(frame)).toEqual([]);
    expect(frame.intensity).toBe(1);
    expect(frame.audio).toMatchObject({ rms: 1, pitch_midi: null, bpm: 0, beat_phase: 1 });
    expect(frame.hands.distance).toBe(0);
    expect(frame.hands.left).toMatchObject({ x: 0, y: 0, height: 1 });
  });

  it('rounds numbers so frames stay small', () => {
    clock = 0;
    const t = make();
    t.onPitch({ midi: 62.123456, rms: 0.123456 });
    expect(t.frame().audio).toMatchObject({ rms: 0.123, pitch_midi: 62.123 });
  });
});

describe('hands that disappear', () => {
  it('turn into null once they have not been seen for 500 ms, and not before', () => {
    clock = 1000;
    const t = make();
    t.onSignal(slider('vision.hand.right.x', 0.5));
    t.onSignal(slider('vision.hand.right.height', 0.5));
    clock = 1000 + HAND_TIMEOUT_MS;
    expect(t.frame().hands.right).not.toBeNull();
    clock = 1000 + HAND_TIMEOUT_MS + 1;
    expect(t.frame().hands.right).toBeNull();
    expect(shapeProblems(t.frame())).toEqual([]);
  });

  it('stay visible as long as new readings keep arriving', () => {
    clock = 0;
    const t = make();
    for (let step = 0; step < 20; step++) {
      clock = step * 100;
      t.onSignal(slider('vision.hand.left.x', 0.4));
      expect(t.frame().hands.left).not.toBeNull();
    }
  });

  it('only the missing hand goes null', () => {
    clock = 0;
    const t = make();
    t.onSignal(slider('vision.hand.left.x', 0.3));
    clock = 400;
    t.onSignal(slider('vision.hand.right.x', 0.7));
    clock = 700;
    const frame = t.frame();
    expect(frame.hands.left).toBeNull();
    expect(frame.hands.right).not.toBeNull();
  });

  it('drops the hands distance when it is stale', () => {
    clock = 0;
    const t = make();
    t.onSignal(slider('vision.hands.distance', 0.5));
    expect(t.frame().hands.distance).toBe(0.5);
    clock = HAND_TIMEOUT_MS + 1;
    expect(t.frame().hands.distance).toBeUndefined();
  });

  it('forget a held fist if the hand was gone, so it does not come back already closed', () => {
    clock = 0;
    const t = make();
    t.onSignal(slider('vision.hand.left.x', 0.5));
    t.onSignal(moment('vision.hand.left.fist', 'start'));
    clock = 2000; // the hand left and its "end" was never heard
    expect(t.frame().hands.left).toBeNull();
    t.onSignal(slider('vision.hand.left.x', 0.2));
    expect(t.frame().hands.left).toMatchObject({ x: 0.2, fist: false });
  });

  it('a gesture ending does not bring a gone hand back', () => {
    clock = 0;
    const t = make();
    t.onSignal(slider('vision.hand.left.x', 0.5));
    clock = 2000;
    t.onSignal(moment('vision.hand.left.fist', 'end'));
    expect(t.frame().hands.left).toBeNull();
  });
});

describe('onset', () => {
  it('is true for exactly one frame after it arrives', () => {
    clock = 0;
    const t = make();
    expect(t.frame().audio.onset).toBe(false);
    t.onSignal(moment('audio.onset', 'start'));
    expect(t.frame().audio.onset).toBe(true);
    expect(t.frame().audio.onset).toBe(false);
    expect(t.frame().audio.onset).toBe(false);
  });

  it('several onsets between two frames still make one true frame', () => {
    clock = 0;
    const t = make();
    t.onSignal(moment('audio.onset'));
    t.onSignal(moment('audio.onset'));
    expect(t.frame().audio.onset).toBe(true);
    expect(t.frame().audio.onset).toBe(false);
  });

  it('ignores the "end" of a moment', () => {
    clock = 0;
    const t = make();
    t.onSignal(moment('audio.onset', 'end'));
    expect(t.frame().audio.onset).toBe(false);
  });

  it('building a frame by hand does not use the onset up (only the tracker does)', () => {
    const state = emptyState();
    state.onsetPending = true;
    expect(buildFrame(state, 0).audio.onset).toBe(true);
    expect(buildFrame(state, 0).audio.onset).toBe(true);
  });
});

describe('signals it should ignore', () => {
  it('unknown ids and other hand gestures change nothing except that the hand counts as seen', () => {
    clock = 0;
    const t = make();
    t.onSignal(slider('vision.head.tilt', 0.5));
    t.onSignal(moment('audio.clap', 'start'));
    expect(t.frame().hands).toEqual({ left: null, right: null });
    t.onSignal(moment('vision.hand.right.drum_hit', 'start'));
    expect(t.frame().hands.right).toMatchObject({ x: 0.5, y: 0.5, fist: false });
  });
});
