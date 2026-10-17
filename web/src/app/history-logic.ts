// Practice history: turning saved runs (from the server and from this browser) into one tidy list, a trend line and one
// plain sentence. Pure functions only, so they are easy to test.

export type Verdict = 'rushing' | 'dragging' | 'steady';

/** One practice run, however we learned about it. Numbers that were not recorded are left out. */
export interface Run {
  /** The server's id once the run is saved there, otherwise a local id. */
  key: string;
  /** The server's id for this run, when it has one. */
  id?: string;
  songId: string;
  /** When the run was saved, in milliseconds since 1970. */
  startedAt: number;
  playedBpm?: number;
  targetBpm?: number;
  /** Played tempo divided by the song's tempo: 1 is exactly on tempo. */
  ratio?: number;
  verdict?: Verdict;
  issues?: number;
}

export const HISTORY_WINDOW = 20;
/** Runs this close together in time (same song) are the same run when one came from the server and one from here. */
const SAME_RUN_MS = 5000;
/** Closer to the song's tempo by at least this much (as a share of the tempo) counts as a real change. */
const CHANGE_THRESHOLD = 0.02;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const positive = (v: unknown): v is number => finite(v) && v > 0;
const isVerdict = (v: unknown): v is Verdict => v === 'rushing' || v === 'dragging' || v === 'steady';

/** Set only the fields that have a real value, so a missing number never overwrites a known one. */
function defined<T extends object>(fields: T): Partial<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** A run from `GET /api/sessions` (null when the row is not usable). The summary may be empty or odd: use what is there. */
export function runFromServer(row: unknown): Run | null {
  if (!isObject(row) || typeof row.id !== 'string' || !row.id || typeof row.song_id !== 'string') return null;
  const startedAt = typeof row.started_at === 'string' ? Date.parse(row.started_at) : NaN;
  if (!Number.isFinite(startedAt)) return null;
  const s = isObject(row.summary) ? row.summary : {};
  const playedBpm = positive(s.played_bpm) ? s.played_bpm : undefined;
  const targetBpm = positive(s.target_bpm) ? s.target_bpm : undefined;
  const ratio = positive(s.ratio) ? s.ratio : playedBpm && targetBpm ? playedBpm / targetBpm : undefined;
  return {
    key: row.id,
    id: row.id,
    songId: row.song_id,
    startedAt,
    ...defined({ playedBpm, targetBpm, ratio, verdict: isVerdict(s.verdict) ? s.verdict : undefined, issues: finite(s.issues) && s.issues >= 0 ? s.issues : undefined }),
  };
}

/** A run read back from this browser's saved copy (null when it does not look like a run). */
export function runFromStored(raw: unknown): Run | null {
  if (!isObject(raw) || typeof raw.key !== 'string' || !raw.key || typeof raw.songId !== 'string' || !finite(raw.startedAt)) return null;
  return {
    key: raw.key,
    songId: raw.songId,
    startedAt: raw.startedAt,
    ...defined({
      id: typeof raw.id === 'string' && raw.id ? raw.id : undefined,
      playedBpm: positive(raw.playedBpm) ? raw.playedBpm : undefined,
      targetBpm: positive(raw.targetBpm) ? raw.targetBpm : undefined,
      ratio: positive(raw.ratio) ? raw.ratio : undefined,
      verdict: isVerdict(raw.verdict) ? raw.verdict : undefined,
      issues: finite(raw.issues) && raw.issues >= 0 ? raw.issues : undefined,
    }),
  };
}

/** Server runs and this browser's runs as one list, newest first, each run once (matched by id, else by start time). */
export function mergeRuns(server: Run[], local: Run[]): Run[] {
  const fromServer: Run[] = server.map((r) => ({ ...r }));
  const extra: Run[] = [];
  const taken = new Set<Run>();
  for (const mine of local) {
    const same = (r: Run) => r.songId === mine.songId && (mine.id !== undefined ? r.id === mine.id : Math.abs(r.startedAt - mine.startedAt) <= SAME_RUN_MS);
    const match = fromServer.find((r) => !taken.has(r) && same(r));
    if (match) {
      taken.add(match);
      // the server's copy leads; whatever it did not record comes from here
      Object.assign(match, { ...mine, ...defined(match), key: match.key });
    } else {
      extra.push({ ...mine });
    }
  }
  return [...fromServer, ...extra].sort((a, b) => b.startedAt - a.startedAt || (a.key < b.key ? -1 : 1));
}

/** The newest runs, newest first. */
export const recentRuns = (runs: Run[], n = HISTORY_WINDOW): Run[] => runs.slice(0, n);

/** The runs that have a tempo reading, oldest first. */
const rated = (runs: Run[]): Array<Run & { ratio: number }> => runs.filter((r): r is Run & { ratio: number } => positive(r.ratio)).reverse();

// ---- words ----

/** How the tempo went, in plain words ("a bit slow", "quite fast", "nice and steady"). */
export function verdictWords(run: Pick<Run, 'verdict' | 'ratio'>): string {
  const far = run.ratio !== undefined && Math.abs(1 - run.ratio) >= 0.2 ? 'quite' : 'a bit';
  if (run.verdict === 'dragging') return `${far} slow`;
  if (run.verdict === 'rushing') return `${far} fast`;
  if (run.verdict === 'steady') return 'nice and steady';
  return 'no tempo reading';
}

export function whenText(startedAt: number): string {
  try {
    return new Date(startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return new Date(startedAt).toISOString();
  }
}

/** One line for the list: when, what was played against the song, and how it went. */
export function runLine(run: Run): string {
  const when = whenText(run.startedAt);
  if (run.playedBpm === undefined || run.targetBpm === undefined) return `${when}: practice run saved`;
  return `${when}: played about ${Math.round(run.playedBpm)} BPM, the song is ${Math.round(run.targetBpm)} BPM: ${verdictWords(run)}`;
}

export const NO_SONG_HISTORY = 'Load a song to see your practice history.';
export const NO_RUNS_YET = 'Practice once to start your history';

/** The one sentence under the heading: whether the runs are getting closer to the song's tempo. Takes the runs newest first. */
export function historyMessage(runs: Run[], hasSong = true): string {
  if (!hasSong) return NO_SONG_HISTORY;
  if (runs.length === 0) return NO_RUNS_YET;
  const timed = rated(recentRuns(runs));
  if (timed.length === 0) return 'Your runs are saved. Play along to the end of the song to see how your tempo is doing.';
  if (timed.length === 1) return 'Nice, your first run is saved. Practice again to see how you are doing.';

  const k = Math.min(3, Math.floor(timed.length / 2));
  const miss = (group: typeof timed) => group.reduce((sum, r) => sum + Math.abs(r.ratio - 1), 0) / group.length;
  const change = miss(timed.slice(0, k)) - miss(timed.slice(-k));
  const last = k === 1 ? 'your latest run' : `your last ${k} runs`;
  const first = k === 1 ? 'your first' : `your first ${k}`;
  if (change > CHANGE_THRESHOLD) return `You are getting steadier: ${last} ${k === 1 ? 'was' : 'were'} closer to the song's tempo than ${first}`;
  if (change < -CHANGE_THRESHOLD) return `${last.charAt(0).toUpperCase()}${last.slice(1)} ${k === 1 ? 'was' : 'were'} a bit further from the song's tempo than ${first}. That happens: try a slower speed and build back up.`;
  return `You are staying consistent: ${last} ${k === 1 ? 'was' : 'were'} about as close to the song's tempo as ${first}`;
}

// ---- the trend line ----

export interface TrendPoint {
  x: number;
  y: number;
  ratio: number;
}

/**
 * Where each run goes on a small chart, oldest on the left. The middle of the chart is a ratio of 1 (on tempo); faster
 * runs are drawn higher. `mid` is the y of the on-tempo line.
 */
export function trendPoints(runs: Run[], width: number, height: number, pad = 8): { points: TrendPoint[]; mid: number } {
  const timed = rated(recentRuns(runs));
  const mid = height / 2;
  const span = Math.max(0.1, ...timed.map((r) => Math.abs(r.ratio - 1))) * 1.15;
  const points = timed.map((r, i) => ({
    x: timed.length === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (timed.length - 1),
    y: mid - ((r.ratio - 1) / span) * (mid - pad),
    ratio: r.ratio,
  }));
  return { points, mid };
}
