import { describe, expect, it } from 'vitest';
import twinkleJson from '@fixtures/song-analysis/twinkle.json';
import type { SongAnalysis } from '@/contracts';
import { renderNotesToSamples } from './render-notes';
import { peak, rms, zeroCrossingFreq } from './test-utils';

const SR = 44100;
const twinkle = twinkleJson as unknown as SongAnalysis;
const onlyPart = (id: string): SongAnalysis => ({ ...twinkle, parts: twinkle.parts.filter((p) => p.id === id) });

describe('renderNotesToSamples (the demo song made from its notes)', () => {
  const song = renderNotesToSamples(twinkle, SR);

  it('is as long as the song (about 28.8 seconds)', () => {
    expect(song.length / SR).toBeGreaterThan(28.7);
    expect(song.length / SR).toBeLessThan(29.1);
  });

  it('is not silent, and does not clip', () => {
    expect(rms(song)).toBeGreaterThan(0.02);
    expect(peak(song)).toBeLessThanOrEqual(1);
  });

  it('plays the first note at middle C (261.6 Hz)', () => {
    // The first note is C4 for 0.57 s. Listen to the melody alone, so the bass underneath does not mix into the count.
    const melody = renderNotesToSamples(onlyPart('melody'), SR);
    const hz = zeroCrossingFreq(melody, SR, Math.round(0.05 * SR), Math.round(0.5 * SR));
    expect(hz).toBeGreaterThan(261.63 * 0.99);
    expect(hz).toBeLessThan(261.63 * 1.01);
  });

  it('puts every note where the analysis says (quiet gap before the second note is short, sound at each onset)', () => {
    const melody = renderNotesToSamples(onlyPart('melody'), SR);
    for (const note of twinkle.parts[0].notes) {
      const at = Math.round((note.onset_sec + 0.1) * SR);
      expect(rms(melody, at, at + Math.round(0.05 * SR))).toBeGreaterThan(0.03);
    }
    expect(rms(melody, 0, 4)).toBeLessThan(0.01); // starts from silence with a soft attack, no click
  });

  it('keeps the bass quieter than the melody', () => {
    const melody = rms(renderNotesToSamples(onlyPart('melody'), SR));
    const bass = rms(renderNotesToSamples(onlyPart('bass'), SR));
    expect(bass).toBeGreaterThan(0);
    expect(bass).toBeLessThan(melody);
  });

  it('gives the same sound every time', () => {
    expect(Array.from(renderNotesToSamples(twinkle, SR).slice(5000, 5100))).toEqual(Array.from(song.slice(5000, 5100)));
  });

  it('copes with odd songs: no notes, a note past the end, drums, broken numbers', () => {
    const base: SongAnalysis = { ...twinkle, duration_sec: 2, parts: [] };
    expect(renderNotesToSamples(base, SR).length).toBe(2 * SR);
    const odd = renderNotesToSamples(
      {
        ...base,
        parts: [
          { id: 'a', name: 'A', notes: [{ pitch: 60, onset_sec: 1.8, duration_sec: 1 }, { pitch: Number.NaN, onset_sec: 0, duration_sec: 1 }] },
          { id: 'd', name: 'Drums', kind: 'drums', notes: [{ pitch: 36, onset_sec: 0.5, duration_sec: 0.1 }] },
        ],
      },
      SR,
    );
    expect(odd.length / SR).toBeGreaterThan(2.8); // grew to hold the late note
    expect(odd.every(Number.isFinite)).toBe(true);
    expect(rms(odd, Math.round(0.5 * SR), Math.round(0.55 * SR))).toBeGreaterThan(0.005);
  });
});
