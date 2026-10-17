import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeHum, twinkleMelody } from './fake';
import { recordingSink } from './test-sink';

afterEach(() => vi.useRealTimers());

describe('fake microphone: the Twinkle melody', () => {
  const melody = twinkleMelody();

  it('uses the melody part of the demo song, in order', () => {
    expect(melody.length).toBe(42);
    expect(melody.slice(0, 7).map((n) => n.pitch)).toEqual([60, 60, 67, 67, 69, 69, 67]);
    for (let i = 1; i < melody.length; i++) expect(melody[i].onset_sec).toBeGreaterThan(melody[i - 1].onset_sec);
  });

  it('plays the first notes as performance notes with the right pitch and timing', () => {
    const { sink, log } = recordingSink();
    fakeHum(melody, { instant: true, sink, originMs: 5000 });
    const notes = log.performance.filter((e) => e.type === 'note');
    expect(notes.length).toBe(42);
    notes.slice(0, 7).forEach((n, i) => {
      expect(n.pitch).toBe(melody[i].pitch);
      expect(n.time_sec).toBeCloseTo(melody[i].onset_sec, 1);
      expect(Math.abs(n.duration_sec! - melody[i].duration_sec)).toBeLessThan(0.07); // some notes are two beats long
      expect(Math.abs(n.cents_off!)).toBeLessThanOrEqual(12);
      expect(n.version).toBe(1);
    });
  });

  it('makes pitch frames about 50 times a second that follow the tune, with silence between notes', () => {
    const { sink, log } = recordingSink();
    fakeHum(melody.slice(0, 4), { instant: true, sink, originMs: 5000 });
    const f = log.pitch;
    expect(f[0].t_ms).toBe(5000);
    expect(f[1].t_ms - f[0].t_ms).toBeCloseTo(20, 5);
    const at = (sec: number) => f[Math.round(sec * 50)];
    expect(Math.abs(at(0.3).midi! - 60)).toBeLessThan(0.3);
    expect(Math.abs(at(1.5).midi! - 67)).toBeLessThan(0.3);
    expect(at(0.3).confidence).toBeGreaterThan(0.9);
    expect(at(0.3).rms).toBeGreaterThan(0.01);
    expect(f.some((x) => x.midi === null)).toBe(true); // the tiny rest between notes
  });

  it('sends one onset for every note, a gentle loudness, and the hum-pitch slider', () => {
    const { sink, log } = recordingSink();
    fakeHum(melody, { instant: true, sink, originMs: 0 });
    expect(log.onset.length).toBe(42);
    expect(log.performance.filter((e) => e.type === 'onset').length).toBe(42);
    expect(log.onset[1].tMs).toBeCloseTo(600, -1);
    for (const l of log.loudness) {
      expect(l.value).toBeGreaterThanOrEqual(0);
      expect(l.value).toBeLessThan(0.8);
    }
    expect(Math.max(...log.loudness.map((l) => l.value))).toBeGreaterThan(0.3);
    expect(log.hum[0].value).toBeCloseTo((60 - 36) / 60, 1);
    expect(log.hum[0].midi).toBeCloseTo(60, 0);
    expect(log.hand).toEqual([]);
  });

  it('only makes valid performance events', () => {
    const { sink, log } = recordingSink();
    fakeHum(melody, { instant: true, sink, originMs: 0 });
    for (const e of log.performance) {
      expect(['note', 'onset']).toContain(e.type);
      expect(e.time_sec).toBeGreaterThanOrEqual(0);
      if (e.type === 'note') {
        expect(e.pitch).toBeGreaterThanOrEqual(0);
        expect(e.pitch).toBeLessThanOrEqual(127);
        expect(Math.abs(e.cents_off!)).toBeLessThanOrEqual(50);
      }
      if (e.loudness !== undefined) {
        expect(e.loudness).toBeGreaterThanOrEqual(0);
        expect(e.loudness).toBeLessThanOrEqual(1);
      }
    }
  });

  it('plays in real time and can loop', () => {
    vi.useFakeTimers();
    const { sink, log } = recordingSink();
    const loopSec = melody[melody.length - 1].onset_sec + melody[melody.length - 1].duration_sec + 0.5;
    const stop = fakeHum(melody, { loop: true, sink });
    vi.advanceTimersByTime(1100);
    expect(log.pitch.length).toBeGreaterThan(50);
    expect(log.pitch.length).toBeLessThan(60);
    const before = log.performance.filter((e) => e.type === 'note').length;
    vi.advanceTimersByTime(loopSec * 1000 + 1500);
    const notes = log.performance.filter((e) => e.type === 'note');
    expect(notes.length).toBeGreaterThan(before + 42);
    expect(notes.some((n) => n.time_sec! > loopSec)).toBe(true);
    stop();
    const frames = log.pitch.length;
    vi.advanceTimersByTime(1000);
    expect(log.pitch.length).toBe(frames);
  });

  it('plays a tune once and stops by itself when not looping', () => {
    vi.useFakeTimers();
    const { sink, log } = recordingSink();
    fakeHum([{ pitch: 62, onset_sec: 0, duration_sec: 0.3 }], { sink });
    vi.advanceTimersByTime(3000);
    const frames = log.pitch.length;
    expect(log.performance.filter((e) => e.type === 'note').length).toBe(1);
    vi.advanceTimersByTime(3000);
    expect(log.pitch.length).toBe(frames);
  });
});
