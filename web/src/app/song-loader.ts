// Getting a song into the app: from the server, or from the built-in demo when the server is not there.
// Every failure turns into a friendly sentence (LoadError); raw errors never reach the screen.
import twinkleJson from '@fixtures/song-analysis/twinkle.json';
import { getAudioContext } from '@/bus';
import type { SongAnalysis } from '@/contracts';

export const DEMO_SONG_ID = 'demo-twinkle';
export const OFFLINE_NOTICE = 'Server not reachable: using the built-in demo';
export const builtInDemo = twinkleJson as unknown as SongAnalysis;

/** An error whose message is already fit to show to a person. */
export class LoadError extends Error {}

export interface LoadedSong {
  analysis: SongAnalysis;
  /** Decoded audio of an uploaded file (not set for the demo). */
  buffer?: AudioBuffer;
  /** True when the server could not be reached and the built-in demo was used instead. */
  offline: boolean;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export function isSongAnalysis(x: unknown): x is SongAnalysis {
  const a = x as Partial<SongAnalysis> | null;
  return !!a && typeof a === 'object' && a.version === 1 && typeof a.song_id === 'string' && typeof a.tempo_bpm === 'number' && typeof a.duration_sec === 'number' && Array.isArray(a.parts);
}

/** The demo song from the server, or the built-in copy when the server does not answer properly. */
export async function loadDemo(fetchFn: FetchFn = (u, i) => fetch(u, i)): Promise<LoadedSong> {
  try {
    const res = await fetchFn(`/api/songs/${DEMO_SONG_ID}/analysis`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data: unknown = await res.json();
    if (!isSongAnalysis(data)) throw new Error('not a song');
    return { analysis: data, offline: false };
  } catch {
    return { analysis: builtInDemo, offline: true };
  }
}

const decodeWithBrowser = async (file: File): Promise<AudioBuffer> => getAudioContext().decodeAudioData(await file.arrayBuffer());

/**
 * Send a file to the server for analysis and decode it for playback.
 * If the server is not reachable the built-in demo is used instead (offline = true).
 * Throws LoadError (with a friendly message) for anything else that goes wrong.
 */
export async function loadUpload(file: File, deps: { fetchFn?: FetchFn; decode?: (f: File) => Promise<AudioBuffer> } = {}): Promise<LoadedSong> {
  const fetchFn = deps.fetchFn ?? ((u, i) => fetch(u, i));
  const decode = deps.decode ?? decodeWithBrowser;

  const decoding = decode(file);
  decoding.catch(() => {}); // handled below; stops a stray "unhandled" warning if we return early

  const body = new FormData();
  body.append('file', file);
  let res: Response;
  try {
    res = await fetchFn('/api/songs', { method: 'POST', body });
  } catch {
    return { analysis: builtInDemo, offline: true };
  }
  // 5xx = the server (or the dev proxy in front of it) is down; 404/405 = there is no API here at all.
  if (res.status >= 500 || res.status === 404 || res.status === 405) return { analysis: builtInDemo, offline: true };
  if (!res.ok) {
    if (res.status === 413) throw new LoadError('That file is too big. Try a shorter song.');
    throw new LoadError('We could not read that file as a song. Try an MP3 or WAV file.');
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { analysis: builtInDemo, offline: true };
  }
  if (!isSongAnalysis(data)) throw new LoadError('The server sent back something we could not understand. Please try again.');

  let buffer: AudioBuffer;
  try {
    buffer = await decoding;
  } catch {
    throw new LoadError('We could not play that file. Try an MP3 or WAV file.');
  }
  return { analysis: data, buffer, offline: false };
}
