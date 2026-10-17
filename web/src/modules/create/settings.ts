// Small settings Create mode keeps next to the layers: whether hummed notes snap to the key, the key of the loaded song,
// and a line about the last take. A tiny store like store.ts, so it lives outside React and can be tested without a screen.
import type { SongAnalysis } from '@/contracts';
import { isKey, keyName, type Key } from './key';

export interface TakeSummary {
  notes: number;
  key?: Key;
  /** How many notes were moved into the key. */
  moved: number;
}

export interface CreateSettings {
  /** Snap hummed notes to the key. On by default when a song with a key is loaded, off otherwise. */
  snap: boolean;
  /** The key of the loaded song analysis, if it has one. */
  songKey?: Key;
  songId?: string;
  /** The last finished take; cleared when a new take starts. */
  take?: TakeSummary;
}

export interface SettingsStore {
  getState(): CreateSettings;
  set(patch: Partial<CreateSettings>): void;
  subscribe(listener: (s: CreateSettings) => void): () => void;
}

export function createSettings(initial: Partial<CreateSettings> = {}): SettingsStore {
  let state: CreateSettings = { snap: false, ...initial };
  const listeners = new Set<(s: CreateSettings) => void>();
  return {
    getState: () => state,
    set(patch) {
      const next = { ...state, ...patch };
      if ((Object.keys(next) as Array<keyof CreateSettings>).every((k) => next[k] === state[k])) return;
      state = next;
      for (const l of [...listeners]) l(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/**
 * A song analysis arrived. Remember its key. When it is a different song from before, snapping goes back to its default:
 * on if the song has a key, off if not. Hearing the same song again keeps whatever the person chose.
 */
export function applyAnalysis(settings: SettingsStore, analysis: SongAnalysis | undefined): void {
  if (!analysis) return;
  const songKey = isKey(analysis.key) ? { tonic: analysis.key.tonic, mode: analysis.key.mode } : undefined;
  const before = settings.getState();
  const sameSong = before.songId !== undefined && before.songId === analysis.song_id;
  settings.set({ songKey, songId: analysis.song_id, ...(sameSong ? {} : { snap: songKey !== undefined }) });
}

/** The one line shown after a take: "3 notes, key of C major". Notes that were moved into the key are counted at the end. */
export function takeSummaryText(take: TakeSummary): string {
  const count = take.notes === 1 ? '1 note' : `${take.notes} notes`;
  const key = take.key ? `, key of ${keyName(take.key)}` : '';
  const moved = take.moved > 0 ? `, ${take.moved} moved into the key` : '';
  return `${count}${key}${moved}`;
}
