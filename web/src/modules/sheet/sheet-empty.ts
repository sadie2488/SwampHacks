// What to say in place of an empty sheet: the server's own explanation when it gave one, else a plain default.
import type { SongAnalysis } from '@/contracts';

export const NO_SHEET_MESSAGE = 'There is no sheet music for this song yet.';

/** True when no part of the song has even one note. */
export function songHasNoNotes(analysis: SongAnalysis): boolean {
  const parts = Array.isArray(analysis.parts) ? analysis.parts : [];
  return !parts.some((p) => Array.isArray(p.notes) && p.notes.length > 0);
}

/** The first warning with some text in it, exactly as the server wrote it. */
export function firstWarning(analysis: SongAnalysis): string | undefined {
  const warnings = Array.isArray(analysis.warnings) ? analysis.warnings : [];
  return warnings.find((w): w is string => typeof w === 'string' && w.trim() !== '');
}

/** The one-line message for a song with no notes at all, or undefined when some part has notes. */
export function emptySheetMessage(analysis: SongAnalysis): string | undefined {
  return songHasNoNotes(analysis) ? (firstWarning(analysis) ?? NO_SHEET_MESSAGE) : undefined;
}
