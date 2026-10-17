// Saving practice runs. Every new `feedback` from a practice run is stored as one session on the server (best effort)
// and also kept in this browser (the last 20 runs), so progress still shows when the server is away.
import { bus, type Stop } from '@/bus';
import type { Feedback } from '@/contracts';
import { runFromServer, runFromStored, type Run } from './history-logic';

export const SAVE_NOTE = "Couldn't save this run: your progress isn't being stored right now";
export const LOCAL_KEY = 'swamphacks.practice-runs.v1';
export const LOCAL_LIMIT = 20;
export const REQUEST_TIMEOUT_MS = 8000;
const MAX_SAMPLES = 500;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ---- what to send ----

export interface SaveContext {
  songId: string;
  /** The playback speed while practising (the tempo control). */
  tempoRatio: number;
  latencyOffsetMs?: number;
}

export interface Sample {
  metric: string;
  value: number;
  song_time_sec?: number;
}

export interface SaveBodies {
  session: { song_id: string; tempo_ratio: number; latency_offset_ms?: number };
  samples: { samples: Sample[] };
  end: { summary: Record<string, unknown> };
}

/** "about 30 cents sharp" -> 30, "flat by 20 cents" -> -20. Null when the sentence has no number of cents. */
export function parseCentsOff(message: unknown): number | null {
  if (typeof message !== 'string') return null;
  const cents = /(\d+(?:\.\d+)?)\s*cents?\b/i.exec(message);
  const direction = /\b(sharp|flat)\b/i.exec(message);
  if (!cents || !direction) return null;
  const value = Number(cents[1]);
  return Number.isFinite(value) ? (direction[1].toLowerCase() === 'flat' ? -value : value) : null;
}

/** The tempo numbers a run is known by (each one left out when the feedback does not have it). */
function tempoFacts(feedback: Feedback) {
  const tempo = feedback.tempo;
  const played = finite(tempo?.played_bpm) ? tempo.played_bpm : undefined;
  const target = finite(tempo?.target_bpm) ? tempo.target_bpm : undefined;
  const ratio = finite(tempo?.ratio) ? tempo.ratio : played !== undefined && target !== undefined && target > 0 ? played / target : undefined;
  return { played, target, ratio, verdict: tempo?.verdict };
}

/** The three requests for one run, built from its feedback. */
export function buildSaveBodies(feedback: Feedback, ctx: SaveContext): SaveBodies {
  const { played, target, ratio, verdict } = tempoFacts(feedback);
  const issues = Array.isArray(feedback.issues) ? feedback.issues : [];

  const samples: Sample[] = [];
  if (played !== undefined) samples.push({ metric: 'played_bpm', value: played });
  if (target !== undefined) samples.push({ metric: 'target_bpm', value: target });
  if (ratio !== undefined) samples.push({ metric: 'tempo_ratio', value: ratio });
  samples.push({ metric: 'issue_count', value: issues.length });
  for (const issue of issues) {
    if (issue?.kind !== 'pitch') continue;
    const cents = parseCentsOff(issue.message);
    if (cents === null) continue;
    const at = finite(issue.start_sec) && issue.start_sec >= 0 ? { song_time_sec: issue.start_sec } : {};
    samples.push({ metric: 'pitch_cents_off', value: cents, ...at });
  }

  const tempoRatio = finite(ctx.tempoRatio) && ctx.tempoRatio > 0 && ctx.tempoRatio <= 4 ? ctx.tempoRatio : 1;
  const latency = finite(ctx.latencyOffsetMs) && Math.abs(ctx.latencyOffsetMs) <= 5000 ? { latency_offset_ms: ctx.latencyOffsetMs } : {};
  return {
    session: { song_id: ctx.songId, tempo_ratio: tempoRatio, ...latency },
    samples: { samples: samples.slice(0, MAX_SAMPLES) },
    end: { summary: { verdict, played_bpm: played, target_bpm: target, ratio, issues: issues.length, source: feedback.source } },
  };
}

/** The run as the history shows it (this browser's copy). */
export function runFromFeedback(feedback: Feedback, songId: string, startedAt: number, key: string): Run {
  const { played, target, ratio, verdict } = tempoFacts(feedback);
  const issues = Array.isArray(feedback.issues) ? feedback.issues.length : 0;
  return runFromStored({ key, songId, startedAt, playedBpm: played, targetBpm: target, ratio, verdict, issues }) ?? { key, songId, startedAt };
}

// ---- this browser's copy ----

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readAll(): Run[] {
  try {
    const raw = storage()?.getItem(LOCAL_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.map(runFromStored).filter((r): r is Run => r !== null);
  } catch {
    return [];
  }
}

function writeAll(runs: Run[]): void {
  try {
    storage()?.setItem(LOCAL_KEY, JSON.stringify(runs.slice(0, LOCAL_LIMIT)));
  } catch {
    // storage is full, blocked or switched off: the server still has the run
  }
}

/** This browser's saved runs, newest first (for one song, or all of them). */
export function readLocalRuns(songId?: string): Run[] {
  return readAll()
    .filter((r) => songId === undefined || r.songId === songId)
    .sort((a, b) => b.startedAt - a.startedAt);
}

const addLocalRun = (run: Run): void => writeAll([run, ...readAll().filter((r) => r.key !== run.key)].sort((a, b) => b.startedAt - a.startedAt));

function rememberServerId(key: string, id: string): void {
  const all = readAll();
  const mine = all.find((r) => r.key === key);
  if (!mine) return;
  mine.id = id;
  writeAll(all);
}

// ---- talking to the server ----

let tokenProvider: (() => string | null | undefined) | null = null;
/** Lets a sign-in button attach the user's token to the history requests (the server then keeps their runs apart). */
export function setSessionAuth(provider: (() => string | null | undefined) | null): void {
  tokenProvider = provider;
}

async function request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const token = tokenProvider?.();
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // no token: ask as a guest
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // A fetch that ignores the abort signal must not keep a save waiting forever.
  const timedOut = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('timed out'))));
  try {
    const res = await Promise.race([fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal }), timedOut]);
    if (!res.ok) throw new Error(`status ${res.status}`);
    return await Promise.race([res.json().catch(() => null), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** This song's runs from the server, newest first; null when the server cannot be reached or answers badly. */
export async function fetchServerRuns(songId: string): Promise<Run[] | null> {
  try {
    const rows = await request('GET', `/api/sessions?song_id=${encodeURIComponent(songId)}`);
    if (!Array.isArray(rows)) return null;
    return rows.map(runFromServer).filter((r): r is Run => r !== null && r.songId === songId);
  } catch {
    return null;
  }
}

/** Create the session, add its measurements, then end it with the summary. True when the run itself is stored. */
async function sendToServer(run: Run, bodies: SaveBodies): Promise<boolean> {
  let id: string;
  try {
    const made = await request('POST', '/api/sessions', bodies.session);
    const got = typeof made === 'object' && made !== null ? (made as { id?: unknown }).id : undefined;
    if (typeof got !== 'string' || !got) return false;
    id = got;
  } catch {
    return false;
  }
  rememberServerId(run.key, id);
  const base = `/api/sessions/${encodeURIComponent(id)}`;
  try {
    await request('POST', `${base}/samples`, bodies.samples);
  } catch {
    // the measurements are extras: the summary below is what the history needs
  }
  try {
    await request('POST', `${base}/end`, bodies.end);
    return true;
  } catch {
    return false;
  }
}

// ---- what the screen can show ----

export interface SaveState {
  /** A plain sentence when the last save did not reach the server, otherwise null. */
  note: string | null;
  /** Goes up whenever this browser's copy changes. */
  localVersion: number;
  /** Goes up whenever a save finished (well or not): time to ask the server again. */
  syncVersion: number;
}

let state: SaveState = { note: null, localVersion: 0, syncVersion: 0 };
const listeners = new Set<() => void>();
export const getSaveState = (): SaveState => state;
export function subscribeSaves(listener: () => void): Stop {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
function update(change: (s: SaveState) => Partial<SaveState>): void {
  state = { ...state, ...change(state) };
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (e) {
      console.error('[history] a listener threw', e);
    }
  }
}

// ---- saving ----

const handled = new WeakSet<object>();
let counter = 0;

/** Save one run. The same feedback document is never saved twice. Never throws. */
export async function saveFeedback(feedback: Feedback, ctx: SaveContext): Promise<void> {
  try {
    if (typeof feedback !== 'object' || feedback === null || handled.has(feedback)) return;
    handled.add(feedback);
    const startedAt = Date.now();
    const run = runFromFeedback(feedback, ctx.songId, startedAt, `local-${startedAt.toString(36)}-${(counter++).toString(36)}`);
    addLocalRun(run);
    update((s) => ({ note: null, localVersion: s.localVersion + 1 }));
    const stored = await sendToServer(run, buildSaveBodies(feedback, ctx));
    update((s) => ({ note: stored ? null : SAVE_NOTE, syncVersion: s.syncVersion + 1, localVersion: s.localVersion + 1 }));
  } catch (e) {
    console.error('[history] could not save a practice run', e);
    update((s) => ({ note: SAVE_NOTE, syncVersion: s.syncVersion + 1 }));
  }
}

let latency: number | undefined;
let stopSaver: Stop | null = null;

/**
 * Listen for new feedback and save each run. Safe to call again: only one listener ever runs, and it keeps running
 * while the practice panel is not on screen (a run that ends while you are on another tab still counts).
 */
export function startSessionSaver(): Stop {
  if (stopSaver) return stopSaver;
  const stops = [
    // the delay stays known even if a later message does not repeat it
    bus.on(
      'practice',
      (p) => {
        if (finite(p?.latencyOffsetMs)) latency = p.latencyOffsetMs;
      },
      { replay: true },
    ),
    // no replay: feedback that was already there when we started is not a new run
    bus.on('feedback', (feedback) => {
      const tempo = bus.last('controls')?.['playback.tempo'];
      const songId = bus.last('analysis')?.song_id ?? feedback?.song_id;
      if (typeof songId !== 'string' || !songId) return;
      void saveFeedback(feedback, { songId, tempoRatio: finite(tempo) ? tempo : 1, latencyOffsetMs: latency });
    }),
  ];
  stopSaver = () => {
    for (const stop of stops) stop();
    stopSaver = null;
  };
  return stopSaver;
}

export function stopSessionSaver(): void {
  stopSaver?.();
  latency = undefined;
}
