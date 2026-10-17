// Which notes of the song the player is expected to play.
import type { SongAnalysis } from '@/contracts';
import type { ExpectedNote } from './compare';

/** The melody part (or the vocals, or the first part that is not drums), as expected notes in song seconds at 1.0x. */
export function melodyOf(analysis: SongAnalysis): ExpectedNote[] {
  const part = analysis.parts.find((p) => p.kind === 'melody') ?? analysis.parts.find((p) => p.kind === 'vocals') ?? analysis.parts.find((p) => p.kind !== 'drums') ?? analysis.parts[0];
  if (!part) return [];
  return part.notes.map((n) => ({ id: n.id, pitch: n.pitch, onsetSec: n.onset_sec, durationSec: n.duration_sec })).sort((a, b) => a.onsetSec - b.onsetSec);
}
