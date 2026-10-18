// Saving and opening tracks: the server when it answers, this computer's own storage when it does not.
// Nothing here throws: every problem comes back as a short sentence a person can read.
import { cleanText, cleanTrackName, MAX_TRACK_NAME, payloadToLayers, type LoadedTrack, type TrackPayload } from './serialize';

export const TIMEOUT_MS = 10_000;
export const STORAGE_KEY = 'create.savedTracks.v1';
export const LOCAL_PREFIX = 'local-';
export const MAX_LOCAL_TRACKS = 20;
const MAX_SERVER_TRACKS = 50;

export interface TrackSummary {
  id: string;
  name: string;
  tempo_bpm?: number;
  /** ISO date text, or '' when unknown. */
  created_at: string;
  layer_count?: number;
  /** True when the track lives only in this browser's storage. */
  local: boolean;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiDeps {
  /** Default: the page's own fetch. The app passes its own fetch that adds the login token while someone is signed in. */
  fetchFn?: FetchFn;
  /** Default: window.localStorage (which may be missing or throw). */
  storage?: () => Storage | null | undefined;
  timeoutMs?: number;
  now?: () => Date;
}

export type SaveResult = { ok: true; id: string; name: string; local: boolean; reason?: string } | { ok: false; message: string };
export type ListResult = { tracks: TrackSummary[]; notice?: string };
export type OpenResult = { ok: true; track: LoadedTrack } | { ok: false; message: string };

// ---- talking to the server ----

type Reply =
  | { kind: 'ok'; body: unknown }
  /** Could not get a usable answer from the server (not running, busy, database down, timed out, not the right kind of answer). */
  | { kind: 'down'; message: string }
  /** The server answered and said no to this particular request. */
  | { kind: 'refused'; message: string };

const DOWN_STATUS = new Set([401, 403, 404, 405, 408, 429]);

function downMessage(status: number): string {
  if (status === 503) return 'The saving service is not ready right now.';
  if (status === 429) return 'The server is busy right now.';
  if (status === 401 || status === 403) return 'The server did not allow this.';
  if (status === 404 || status === 405) return 'The saving service was not found.';
  return 'The server ran into a problem.';
}

/** The server's own explanation when it is a short plain sentence; otherwise a generic one. */
function refusalMessage(body: unknown): string {
  const detail = typeof body === 'object' && body !== null ? (body as { detail?: unknown }).detail : undefined;
  const text = typeof detail === 'string' ? cleanText(detail, 200, '') : '';
  return text || 'The server did not accept that.';
}

async function request(method: 'GET' | 'POST', path: string, body: unknown, deps: ApiDeps): Promise<Reply> {
  const doFetch = deps.fetchFn ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const work = async (): Promise<Reply> => {
    try {
      const init: RequestInit = { method, signal: controller.signal };
      if (body !== undefined) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(body);
      }
      const res = await doFetch(path, init);
      let parsed: unknown;
      let readable = true;
      try {
        parsed = await res.json();
      } catch {
        readable = false;
      }
      if (res.ok) {
        return readable ? { kind: 'ok', body: parsed } : { kind: 'down', message: 'The server gave an answer that could not be understood.' };
      }
      if (res.status >= 500 || DOWN_STATUS.has(res.status)) return { kind: 'down', message: downMessage(res.status) };
      return { kind: 'refused', message: refusalMessage(parsed) };
    } catch {
      return { kind: 'down', message: 'The server could not be reached.' };
    }
  };
  // the clock runs even if the browser never settles the request
  const timeout = new Promise<Reply>((resolve) => {
    timer = setTimeout(() => {
      resolve({ kind: 'down', message: 'The server took too long to answer.' });
      controller.abort();
    }, deps.timeoutMs ?? TIMEOUT_MS);
  });
  try {
    return await Promise.race([work(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ---- this computer's storage ----

type StoredTrack = TrackPayload & { id: string; created_at: string };

function getStorage(deps: ApiDeps): Storage | null {
  try {
    return (deps.storage ? deps.storage() : globalThis.localStorage) ?? null;
  } catch {
    return null;
  }
}

function isStoredTrack(x: unknown): x is StoredTrack {
  const t = x as Partial<StoredTrack> | null;
  return !!t && typeof t === 'object' && typeof t.id === 'string' && t.id.startsWith(LOCAL_PREFIX) && typeof t.name === 'string' && typeof t.created_at === 'string' && Array.isArray(t.layers);
}

function readLocal(deps: ApiDeps): StoredTrack[] {
  try {
    const text = getStorage(deps)?.getItem(STORAGE_KEY);
    if (!text) return [];
    const data: unknown = JSON.parse(text);
    return Array.isArray(data) ? data.filter(isStoredTrack).slice(0, MAX_LOCAL_TRACKS) : [];
  } catch {
    return [];
  }
}

function writeLocal(deps: ApiDeps, tracks: StoredTrack[]): boolean {
  try {
    const storage = getStorage(deps);
    if (!storage) return false;
    storage.setItem(STORAGE_KEY, JSON.stringify(tracks));
    return true;
  } catch {
    return false;
  }
}

function newLocalId(now: Date): string {
  return `${LOCAL_PREFIX}${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function saveLocal(payload: TrackPayload, reason: string, deps: ApiDeps): SaveResult {
  const now = (deps.now ?? (() => new Date()))();
  const entry: StoredTrack = { ...payload, id: newLocalId(now), created_at: now.toISOString() };
  let keep = [entry, ...readLocal(deps)].slice(0, MAX_LOCAL_TRACKS);
  // when the storage is full, let the oldest saved tracks go until the new one fits
  for (;;) {
    if (writeLocal(deps, keep)) return { ok: true, id: entry.id, name: entry.name, local: true, reason };
    if (keep.length <= 1) break;
    keep = keep.slice(0, -1);
  }
  return { ok: false, message: `${reason} This browser would not keep the track on this computer either, so it was not saved.` };
}

const localSummary = (t: StoredTrack): TrackSummary => ({
  id: t.id,
  name: cleanText(t.name, MAX_TRACK_NAME, 'Untitled'),
  tempo_bpm: typeof t.tempo_bpm === 'number' && Number.isFinite(t.tempo_bpm) ? t.tempo_bpm : undefined,
  created_at: t.created_at,
  layer_count: t.layers.length,
  local: true,
});

function serverSummary(x: unknown): TrackSummary | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : typeof o.id === 'number' && Number.isFinite(o.id) ? String(o.id) : '';
  if (!id || id.length > 200) return null;
  const tempo = typeof o.tempo_bpm === 'number' && Number.isFinite(o.tempo_bpm) && o.tempo_bpm > 0 ? o.tempo_bpm : undefined;
  const count = typeof o.layer_count === 'number' && Number.isInteger(o.layer_count) && o.layer_count >= 0 ? o.layer_count : undefined;
  return { id, name: cleanText(o.name, MAX_TRACK_NAME, 'Untitled'), tempo_bpm: tempo, created_at: typeof o.created_at === 'string' ? o.created_at : '', layer_count: count, local: false };
}

const time = (t: TrackSummary): number => {
  const ms = Date.parse(t.created_at);
  return Number.isNaN(ms) ? 0 : ms;
};

// ---- the three things the screen needs ----

/** Save to the server; when the server cannot be used, keep the track on this computer instead. */
export async function saveTrack(payload: TrackPayload, deps: ApiDeps = {}): Promise<SaveResult> {
  const clean: TrackPayload = { ...payload, name: cleanTrackName(payload.name) };
  const reply = await request('POST', '/api/creations', clean, deps);
  if (reply.kind === 'refused') return { ok: false, message: `The server did not save this track. ${reply.message}` };
  if (reply.kind === 'ok') {
    const created = serverSummary(reply.body);
    if (created) return { ok: true, id: created.id, name: created.name, local: false };
    return saveLocal(clean, 'The server gave an answer that could not be understood.', deps);
  }
  return saveLocal(clean, reply.message, deps);
}

/** Tracks from the server and from this computer, newest first. Never fails: the notice says what is missing. */
export async function listTracks(deps: ApiDeps = {}): Promise<ListResult> {
  const reply = await request('GET', '/api/creations', undefined, deps);
  const local = readLocal(deps).map(localSummary);
  let server: TrackSummary[] = [];
  let notice: string | undefined;
  if (reply.kind === 'ok' && Array.isArray(reply.body)) {
    server = reply.body.slice(0, MAX_SERVER_TRACKS).map(serverSummary).filter((t): t is TrackSummary => t !== null);
  } else {
    const why = reply.kind === 'ok' ? 'The server gave an answer that could not be understood.' : reply.message;
    notice = `${why} Only tracks saved on this computer are shown.`;
  }
  const tracks = [...server, ...local].sort((a, b) => time(b) - time(a));
  return { tracks, notice };
}

/** Open one saved track and make it safe to use. */
export async function loadTrack(track: string | { id: string; local?: boolean }, deps: ApiDeps = {}): Promise<OpenResult> {
  const id = typeof track === 'string' ? track : track.id;
  const local = typeof track === 'string' ? track.startsWith(LOCAL_PREFIX) : (track.local ?? id.startsWith(LOCAL_PREFIX));
  let payload: unknown;
  if (local) {
    payload = readLocal(deps).find((t) => t.id === id);
    if (!payload) return { ok: false, message: 'That track is no longer saved on this computer.' };
  } else {
    const reply = await request('GET', `/api/creations/${encodeURIComponent(id)}`, undefined, deps);
    if (reply.kind !== 'ok') return { ok: false, message: `Could not open that track. ${reply.message}` };
    payload = reply.body;
  }
  const loaded = payloadToLayers(payload);
  if (!loaded) return { ok: false, message: 'That saved track has nothing in it that can be played, so it was not loaded.' };
  return { ok: true, track: loaded };
}
