import { describe, expect, it, vi } from 'vitest';
import type { SongAnalysis } from '@/contracts';
import { applyAnalysis, createSettings, takeSummaryText } from './settings';

const song = (id: string, key?: SongAnalysis['key']): SongAnalysis => ({
  version: 1,
  song_id: id,
  duration_sec: 10,
  tempo_bpm: 100,
  key: key as SongAnalysis['key'],
  time_signature: { numerator: 4, denominator: 4 },
  parts: [],
});
const cMajor = { tonic: 'C', mode: 'major' } as const;

describe('createSettings', () => {
  it('starts with snapping off and tells listeners about changes only', () => {
    const settings = createSettings();
    const seen: boolean[] = [];
    const stop = settings.subscribe((s) => seen.push(s.snap));
    expect(settings.getState().snap).toBe(false);
    settings.set({ snap: true });
    settings.set({ snap: true });
    settings.set({ snap: false });
    stop();
    settings.set({ snap: true });
    expect(seen).toEqual([true, false]);
  });
});

describe('applyAnalysis', () => {
  it('turns snapping on by default when the song has a key, and remembers the key', () => {
    const settings = createSettings();
    applyAnalysis(settings, song('a', cMajor));
    expect(settings.getState()).toMatchObject({ snap: true, songKey: cMajor, songId: 'a' });
  });

  it('keeps snapping off when the song has no key (or a broken one)', () => {
    const settings = createSettings();
    applyAnalysis(settings, song('a'));
    expect(settings.getState()).toMatchObject({ snap: false, songKey: undefined });
    applyAnalysis(settings, song('b', { tonic: 'X', mode: 'major' } as never));
    expect(settings.getState()).toMatchObject({ snap: false, songKey: undefined });
  });

  it('does not undo the person\'s choice when the same song arrives again', () => {
    const settings = createSettings();
    applyAnalysis(settings, song('a', cMajor));
    settings.set({ snap: false });
    applyAnalysis(settings, song('a', cMajor));
    expect(settings.getState().snap).toBe(false);
  });

  it('goes back to the default for a different song', () => {
    const settings = createSettings();
    applyAnalysis(settings, song('a', cMajor));
    settings.set({ snap: false });
    applyAnalysis(settings, song('b', { tonic: 'G', mode: 'major' }));
    expect(settings.getState()).toMatchObject({ snap: true, songKey: { tonic: 'G', mode: 'major' } });
    applyAnalysis(settings, song('c'));
    expect(settings.getState()).toMatchObject({ snap: false, songKey: undefined });
  });

  it('ignores nothing at all', () => {
    const settings = createSettings();
    const listener = vi.fn();
    settings.subscribe(listener);
    applyAnalysis(settings, undefined);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('takeSummaryText', () => {
  it('says how many notes and the key', () => {
    expect(takeSummaryText({ notes: 3, key: cMajor, moved: 0 })).toBe('3 notes, key of C major');
    expect(takeSummaryText({ notes: 1, key: { tonic: 'A', mode: 'minor' }, moved: 0 })).toBe('1 note, key of A minor');
  });

  it('leaves the key out when there is none, and counts moved notes', () => {
    expect(takeSummaryText({ notes: 2, moved: 0 })).toBe('2 notes');
    expect(takeSummaryText({ notes: 0, moved: 0 })).toBe('0 notes');
    expect(takeSummaryText({ notes: 5, key: cMajor, moved: 2 })).toBe('5 notes, key of C major, 2 moved into the key');
  });
});
