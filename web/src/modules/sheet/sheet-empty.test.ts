import { describe, expect, it } from 'vitest';
import twinkle from '@fixtures/song-analysis/twinkle.json';
import type { SongAnalysis } from '@/contracts';
import { emptySheetMessage, firstWarning, NO_SHEET_MESSAGE, songHasNoNotes } from './sheet-empty';

const song = twinkle as unknown as SongAnalysis;
const noMelody = "I couldn't find a single melody line in this song, so there is no sheet music, but the tempo and key are real.";

describe('songHasNoNotes', () => {
  it('is false for a song with notes', () => {
    expect(songHasNoNotes(song)).toBe(false);
  });
  it('is true when there are no parts, or every part is empty', () => {
    expect(songHasNoNotes({ ...song, parts: [] })).toBe(true);
    expect(songHasNoNotes({ ...song, parts: [{ id: 'melody', name: 'Melody', notes: [] }] })).toBe(true);
  });
  it('is false when only one of several parts has notes', () => {
    expect(songHasNoNotes({ ...song, parts: [{ id: 'a', name: 'A', notes: [] }, song.parts[0]] })).toBe(false);
  });
});

describe('firstWarning', () => {
  it('returns the first real warning, skipping blanks and non-text', () => {
    expect(firstWarning({ ...song, warnings: [] })).toBeUndefined();
    expect(firstWarning({ ...song, warnings: ['  ', 7 as unknown as string, 'One', 'Two'] })).toBe('One');
    expect(firstWarning(song)).toBeUndefined();
  });
});

describe('emptySheetMessage', () => {
  it('uses the first warning when the song has no notes', () => {
    expect(emptySheetMessage({ ...song, parts: [], warnings: [noMelody, 'Another'] })).toBe(noMelody);
  });
  it('falls back to the default when there is no warning', () => {
    expect(emptySheetMessage({ ...song, parts: [] })).toBe(NO_SHEET_MESSAGE);
    expect(emptySheetMessage({ ...song, parts: [], warnings: [] })).toBe('There is no sheet music for this song yet.');
  });
  it('says nothing for a song that has notes, even with warnings', () => {
    expect(emptySheetMessage({ ...song, warnings: [noMelody] })).toBeUndefined();
  });
});
