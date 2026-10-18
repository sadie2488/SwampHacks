// The thinking behind the Practice panel, kept free of React so it can be tested on its own:
// turning bars into song seconds, the plain-words lines, the local coaching sentence, and asking the server for coaching.
import type { Feedback, Part, SongAnalysis } from '@/contracts';
import { barStartAt, sheetGrid } from '@/modules/sheet/bar-grid';

export const COACH_URL = '/api/feedback/coach';
export const COACH_TIMEOUT_MS = 10_000;
export const COACH_LEVEL = 'beginner';
/** How slow the "loop this bar" button plays. */
export const LOOP_SPEED = 0.8;

type Issue = NonNullable<Feedback['issues']>[number];
type Bars = [number, number];

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

// ---- bars to song seconds ----

/** A clean, 1-based, in-order bar pair, or null when the feedback gave something unusable. */
export function cleanBars(bars: unknown): Bars | null {
  if (!Array.isArray(bars) || bars.length !== 2 || !bars.every(isNum)) return null;
  const from = Math.max(1, Math.floor(Math.min(bars[0], bars[1])));
  const to = Math.max(from, Math.floor(Math.max(bars[0], bars[1])));
  return [from, to];
}

/** "bar 3" or "bars 1-2". */
export const barsText = (bars: Bars): string => (bars[0] === bars[1] ? `bar ${bars[0]}` : `bars ${bars[0]}-${bars[1]}`);
export const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The part practice feedback compares against (melody, else vocals, else any pitched part), so its bar numbers match. */
function practicePart(a: SongAnalysis): Part | undefined {
  const parts = a.parts ?? [];
  return parts.find((p) => p.kind === 'melody') ?? parts.find((p) => p.kind === 'vocals') ?? parts.find((p) => p.kind !== 'drums') ?? parts[0];
}

/**
 * Where bars `from` to `to` (1-based, both included) start and end, in song seconds at 1.0x speed.
 * Uses the sheet's bar grid (the same one the sheet cursor and the practice feedback use), so "bar 5"
 * is the same bar everywhere, pickups and 6/8 included. Returns null when the bars lie outside the song.
 */
export function barRangeSec(analysis: SongAnalysis | undefined, bars: unknown): [number, number] | null {
  const range = cleanBars(bars);
  if (!analysis || !range) return null;
  const [from, to] = range;
  const grid = sheetGrid(analysis, practicePart(analysis));
  const start = round3(barStartAt(grid, from));
  const duration = isNum(analysis.duration_sec) && analysis.duration_sec > 0 ? analysis.duration_sec : Infinity;
  if (start >= duration) return null;
  const end = round3(Math.min(barStartAt(grid, to + 1), duration));
  return end > start ? [start, end] : null;
}

// ---- plain-words lines ----

/** The tempo line on the feedback card, e.g. "You played about 90 BPM; the song is 100 BPM: a bit slow". */
export function tempoLine(t: NonNullable<Feedback['tempo']>): string {
  const ratio = isNum(t.ratio) ? t.ratio : t.target_bpm > 0 ? t.played_bpm / t.target_bpm : 1;
  const far = Math.abs(1 - ratio) >= 0.2 ? 'quite' : 'a bit';
  const verdict = t.verdict === 'dragging' ? `${far} slow` : t.verdict === 'rushing' ? `${far} fast` : 'nice and steady';
  return `You played about ${Math.round(t.played_bpm)} BPM; the song is ${Math.round(t.target_bpm)} BPM: ${verdict}`;
}

/** What the practice panel says when the listening part gave a state but no sentence of its own. */
export function practiceWords(p: { state: string; message?: string } | undefined): string {
  if (p?.message) return p.message;
  switch (p?.state) {
    case 'calibrating':
      return 'Listening for your claps...';
    case 'listening':
      return 'Listening to you play...';
    case 'done':
      return 'All done. Here is how it went.';
    case 'error':
      return 'Practice hit a snag. Check the microphone and try again.';
    default:
      return 'Ready when you are.';
  }
}

export const NO_SONG_MESSAGE = 'Pick a song first: use the demo song or upload a file above, then start practice.';

// ---- coaching text ----

const endsSentence = (s: string) => /[.!?]$/.test(s);
const sentence = (s: string) => {
  const t = s.trim();
  return endsSentence(t) ? t : `${t}.`;
};
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * A short, kind paragraph built only from the facts in the feedback. Used whenever the server cannot be reached,
 * and in the same tone as the server's built-in tips.
 */
export function builtInCoaching(f: Feedback): string {
  const strength = f.strengths?.find((s) => s.trim());
  const opener = strength ? `Nice work: ${lowerFirst(strength.trim().replace(/[.!?]+$/, ''))}.` : 'Good effort.';

  let focus: string;
  const verdict = f.tempo?.verdict;
  const issue = f.issues?.find((i) => i.message?.trim());
  if (verdict === 'dragging') focus = 'Your speed ran a little slow, which is really common.';
  else if (verdict === 'rushing') focus = 'Your speed ran a little fast, which is really common.';
  else if (issue) focus = sentence(issue.message);
  else if (verdict === 'steady') focus = 'Your speed was steady.';
  else focus = 'Keep a steady beat.';

  const bars = cleanBars(f.issues?.find((i) => i.bars)?.bars);
  const next = f.next_step?.trim()
    ? sentence(f.next_step)
    : bars
      ? `Try ${barsText(bars)} at 80% speed, then bring it back up.`
      : 'Try again at a slower tempo, around 80% speed.';

  return `${opener} ${focus} ${next}`;
}

export type CoachSource = 'gemini' | 'built-in';
export interface Coaching {
  text: string;
  source: CoachSource;
}
export const coachLabel = (source: CoachSource): string => (source === 'gemini' ? 'Coach (Gemini)' : 'Coach (built-in tips)');

/** The coaching a feedback document already carries (feedback that came back from the server), if any. */
export function coachingIn(f: Feedback): Coaching | null {
  const text = f.source === 'rules' ? '' : f.coaching?.trim();
  return text ? { text, source: f.source === 'gemini' ? 'gemini' : 'built-in' } : null;
}

/** Only the rules feedback from the browser is sent to the server for friendly phrasing. */
export const needsCoaching = (f: Feedback): boolean => f.source === 'rules';

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Ask the server to phrase the facts as coaching. Never throws and never returns an error message:
 * if the server is missing, slow (over 10 seconds), or answers badly, the local sentence is used instead.
 */
export async function fetchCoaching(feedback: Feedback, opts: { fetchFn?: FetchFn; timeoutMs?: number } = {}): Promise<Coaching> {
  const fetchFn: FetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? COACH_TIMEOUT_MS);
  // A fetch that ignores the abort signal must not be able to hold the card on "Writing friendly tips..." forever.
  const timedOut = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('timed out'))));
  const ask = async (): Promise<Coaching> => {
    const res = await fetchFn(COACH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback, level: COACH_LEVEL }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const answer = (await res.json()) as Feedback | null;
    const text = typeof answer?.coaching === 'string' ? answer.coaching.trim() : '';
    if (!text) throw new Error('no coaching in the answer');
    return { text, source: answer?.source === 'gemini' ? 'gemini' : 'built-in' };
  };
  try {
    return await Promise.race([ask(), timedOut]);
  } catch {
    return { text: builtInCoaching(feedback), source: 'built-in' };
  } finally {
    clearTimeout(timer);
  }
}

// The same feedback document is asked about once, even when the panel is closed and opened again (switching tabs).
const asked = new WeakMap<Feedback, Promise<Coaching>>();
const answered = new WeakMap<Feedback, Coaching>();

/** The coaching for this feedback if it is already known (carried in it, or answered before). */
export const knownCoaching = (f: Feedback): Coaching | null => coachingIn(f) ?? answered.get(f) ?? null;

/** The coaching for this feedback, asking the server once per document. */
export function coachingFor(f: Feedback, opts?: Parameters<typeof fetchCoaching>[1]): Promise<Coaching> {
  const known = knownCoaching(f);
  if (known) return Promise.resolve(known);
  let pending = asked.get(f);
  if (!pending) {
    pending = fetchCoaching(f, opts).then((c) => {
      answered.set(f, c);
      return c;
    });
    asked.set(f, pending);
  }
  return pending;
}

/** The first issue that points at bars, with the song seconds to loop (from the analysis, else the issue's own times). */
export function loopTarget(f: Feedback, analysis: SongAnalysis | undefined): { bars: Bars; range: [number, number] | null } | null {
  const issue: Issue | undefined = f.issues?.find((i) => cleanBars(i.bars));
  const bars = issue ? cleanBars(issue.bars) : null;
  if (!issue || !bars) return null;
  const own: [number, number] | null = isNum(issue.start_sec) && isNum(issue.end_sec) && issue.end_sec > issue.start_sec ? [issue.start_sec, issue.end_sec] : null;
  return { bars, range: barRangeSec(analysis, bars) ?? own };
}
