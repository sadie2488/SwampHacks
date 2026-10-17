// Turns the comparison numbers into coaching, by fixed rules (music-notes sections 6 and 7):
// one specific point, kind words, lead with something that went well, no walls of numbers.
// The result is a `Feedback` with source "rules"; Gemini may rephrase it later (pending: true).
import type { Feedback, SongAnalysis } from '@/contracts';
import { barEndSec, barOf, barsText, barStartSec } from './bars';
import type { CompareResult, NoteResult } from './compare';
import { PRACTICE } from './config';
import { median, noteLetter, roundTo } from './math';

type Issue = NonNullable<Feedback['issues']>[number];
type Severity = NonNullable<Issue['severity']>;

export interface FeedbackInput {
  analysis: SongAnalysis;
  result: CompareResult;
  /** Was the clap check done? Without it we cannot tell lateness of the hardware from lateness of the player. */
  calibrated: boolean;
  sessionId?: string;
  /** For tests. */
  now?: Date;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
const KIND_RANK: Record<Issue['kind'], number> = { tempo: 5, rhythm: 4, missed: 3, pitch: 2, extra: 1 };

const pct = (x: number): number => Math.round(Math.abs(x) * 100);
const barsOf = (analysis: SongAnalysis, notes: NoteResult[]): [number, number] => {
  const bars = notes.map((n) => barOf(analysis, n.note.onsetSec));
  return [Math.min(...bars), Math.max(...bars)];
};
const span = (analysis: SongAnalysis, bars: [number, number]): Pick<Issue, 'start_sec' | 'end_sec'> => ({
  start_sec: roundTo(barStartSec(analysis, bars[0]), 3),
  end_sec: roundTo(Math.max(barStartSec(analysis, bars[0]), barEndSec(analysis, bars[1])), 3),
});
/** From the first of these notes to the end of the last one. */
const noteSpan = (notes: NoteResult[]): Pick<Issue, 'start_sec' | 'end_sec'> => ({
  start_sec: roundTo(Math.min(...notes.map((n) => n.note.onsetSec)), 3),
  end_sec: roundTo(Math.max(...notes.map((n) => n.note.onsetSec + n.note.durationSec)), 3),
});

interface BarTempo {
  bar: number;
  /** How long the gaps between this bar's notes were meant to be, ms. */
  length: number;
  /** How much longer (positive) or shorter the player took over them, ms. */
  extra: number;
  gaps: number;
}

/** Each bar's own tempo: how much the gaps between its notes were stretched or squeezed. Bars with too few gaps are left out. */
function barTempos(analysis: SongAnalysis, matched: NoteResult[]): BarTempo[] {
  const perBar = new Map<number, BarTempo>();
  for (let k = 0; k + 1 < matched.length; k++) {
    const a = matched[k];
    const b = matched[k + 1];
    if (b.index !== a.index + 1) continue; // a skipped note in between would be mistaken for slowness
    const bar = barOf(analysis, a.note.onsetSec);
    const e = perBar.get(bar) ?? { bar, length: 0, extra: 0, gaps: 0 };
    e.length += (b.expectedSec - a.expectedSec) * 1000;
    e.extra += b.timingErrorMs! - a.timingErrorMs!;
    e.gaps++;
    perBar.set(bar, e);
  }
  return [...perBar.values()].filter((e) => e.gaps >= PRACTICE.rules.minGapsPerBar && e.length > 0).sort((a, b) => a.bar - b.bar);
}

interface TempoRun {
  bars: [number, number];
  verdict: 'rushing' | 'dragging';
  /** How far from the song's tempo, as a share (0.1 = 10 percent). */
  off: number;
}

/** The longest stretch of consecutive bars whose own tempo is further than `band` from the song's, in the given direction. */
function longestRun(tempos: BarTempo[], verdict: 'rushing' | 'dragging', band: number): TempoRun | null {
  let best: (TempoRun & { count: number }) | null = null;
  let current: BarTempo[] = [];
  const close = () => {
    if (current.length === 0) return;
    const length = current.reduce((s, e) => s + e.length, 0);
    const extra = current.reduce((s, e) => s + e.extra, 0);
    const off = Math.abs(1 - length / Math.max(1, length + extra));
    const run = { bars: [current[0].bar, current[current.length - 1].bar] as [number, number], verdict, off, count: current.length };
    if (!best || run.count > best.count || (run.count === best.count && run.off > best.off)) best = run;
    current = [];
  };
  for (const e of tempos) {
    const ratio = e.length / Math.max(1, e.length + e.extra); // played tempo / song tempo in this bar
    const qualifies = verdict === 'dragging' ? ratio < 1 - band : ratio > 1 + band;
    if (qualifies && (current.length === 0 || e.bar === current[current.length - 1].bar + 1)) current.push(e);
    else {
      close();
      if (qualifies) current.push(e);
    }
  }
  close();
  return best;
}

function suggestedSpeed(rate: number, ratio: number | undefined): number {
  const v = rate * Math.min(ratio ?? 1, 1);
  return Math.max(50, Math.floor(v * 10 - 1) * 10);
}

export function buildFeedback(input: FeedbackInput): Feedback {
  const { analysis, result, calibrated } = input;
  const rules = PRACTICE.rules;
  const matched = result.matched;
  const n = matched.length;
  const enough = n >= rules.minMatchedNotes && result.line !== null;
  const out: Feedback = {
    version: 1,
    song_id: analysis.song_id,
    generated_at: (input.now ?? new Date()).toISOString(),
    source: 'rules',
    pending: true,
    summary: '',
  };
  if (input.sessionId) out.session_id = input.sessionId;

  // ---- nothing (or almost nothing) was heard ----
  const heard = n + result.extras.length;
  if (heard === 0) {
    out.summary = "I didn't hear any notes. Check that the microphone is on, play a little louder or closer to it, and try again.";
    out.issues = [];
    out.strengths = [];
    out.next_step = 'Press Start, then play along a little louder or closer to the microphone.';
    return out;
  }

  // ---- tempo ----
  let ratio: number | undefined;
  let verdict: 'rushing' | 'dragging' | 'steady' | undefined;
  if (enough) {
    ratio = 1 / result.line!.slope; // played pace / song pace: below 1 = slower
    verdict = Math.abs(ratio - 1) <= rules.steadyBand ? 'steady' : ratio < 1 ? 'dragging' : 'rushing';
    const target = analysis.tempo_bpm * result.rate;
    out.tempo = { target_bpm: roundTo(target, 1), played_bpm: roundTo(target * ratio, 1), ratio: roundTo(ratio, 3), verdict };
  }

  const issues: Issue[] = [];

  let tempoRun: TempoRun | null = null;
  if (enough) {
    const tempos = barTempos(analysis, matched);
    if (verdict !== 'steady') {
      // the player is off overall: name the stretch where it shows, or the whole run when no stretch stands out
      tempoRun = longestRun(tempos, verdict!, rules.steadyBand) ?? { bars: barsOf(analysis, matched), verdict: verdict!, off: Math.abs(1 - ratio!) };
    } else {
      // steady overall, but maybe two or more bars in a row dragged (or ran ahead)
      const runs = (['dragging', 'rushing'] as const).map((v) => longestRun(tempos, v, rules.localBand)).filter((r): r is TempoRun => r !== null && r.bars[1] > r.bars[0]);
      runs.sort((a, b) => b.bars[1] - b.bars[0] - (a.bars[1] - a.bars[0]) || b.off - a.off);
      tempoRun = runs[0] ?? null;
    }
  }
  if (tempoRun) {
    const all = barsOf(analysis, matched);
    const whole = verdict !== 'steady' && tempoRun.bars[0] === all[0] && tempoRun.bars[1] === all[1];
    const word = tempoRun.verdict === 'dragging' ? 'dragged' : 'rushed';
    const where = whole && all[0] !== all[1] ? `through ${barsText(all)}` : `in ${barsText(tempoRun.bars)}`;
    issues.push({
      kind: 'tempo',
      ...span(analysis, tempoRun.bars),
      bars: tempoRun.bars,
      severity: tempoRun.off >= 0.2 ? 'high' : tempoRun.off >= 0.08 ? 'medium' : 'low',
      message: `You ${word} ${where}, about ${pct(tempoRun.off)}% ${tempoRun.verdict === 'dragging' ? 'slower' : 'faster'} than the song: try counting along with the beat.`,
    });
  }

  // ---- rhythm: uneven playing, or consistently early/late ----
  const residuals = matched.map((m) => m.residualMs).filter((r): r is number => r !== undefined);
  const wobbly = enough ? matched.filter((m) => Math.abs(m.residualMs ?? 0) > rules.wobbleMs) : [];
  const wobbles = wobbly.length >= 2 && wobbly.length >= 0.15 * n;
  if (wobbles) {
    const bars = barsOf(analysis, wobbly);
    issues.push({
      kind: 'rhythm',
      ...span(analysis, bars),
      bars,
      severity: wobbly.length >= 0.3 * n ? 'medium' : 'low',
      message: `Your timing wobbled in ${barsText(bars)}: try tapping your foot to keep the beat steady.`,
    });
  } else if (enough && calibrated && verdict === 'steady') {
    const bias = median(matched.map((m) => m.timingErrorMs!));
    if (Math.abs(bias) > rules.onTimeMs) {
      const bars = barsOf(analysis, matched);
      const which = bias > 0 ? 'late' : 'early';
      issues.push({
        kind: 'rhythm',
        ...span(analysis, bars),
        bars,
        severity: Math.abs(bias) > rules.aBitMs ? 'medium' : 'low',
        message: `You came in ${Math.abs(bias) > rules.aBitMs ? '' : 'a bit '}${which} on most notes: listen for the beat and try to land right on it.`,
      });
    }
  }

  // ---- missed notes ----
  if (result.missed.length > 0) {
    const k = result.missed.length;
    const bars = barsOf(analysis, result.missed);
    const share = k / Math.max(1, result.notes.length);
    issues.push({
      kind: 'missed',
      ...noteSpan(result.missed),
      bars,
      severity: share >= 0.25 ? 'high' : share >= 0.1 ? 'medium' : 'low',
      message: k === 1 ? `You skipped a note in ${barsText(bars)}: slow down a little so every note is there.` : `You skipped ${k} notes, mostly in ${barsText(bars)}: slow down a little so every note is there.`,
    });
  }

  // ---- pitch (judged on the median over each note) ----
  const withPitch = matched.filter((m) => m.pitchErrorCents !== undefined);
  const flagged = withPitch.filter((m) => Math.abs(m.pitchErrorCents!) > rules.pitchFineCents);
  const wrong = flagged.filter((m) => Math.abs(m.pitchErrorCents!) >= rules.wrongNoteCents);
  if (wrong.length > 0) {
    const bars = barsOf(analysis, wrong);
    const first = wrong[0];
    const said = `${noteLetter(first.played!.pitch!)} instead of ${noteLetter(first.note.pitch + result.pitchShift)}`;
    issues.push({
      kind: 'pitch',
      ...noteSpan(wrong),
      bars,
      severity: wrong.length >= 0.3 * n ? 'high' : 'medium',
      message: wrong.length === 1 ? `In ${barsText(bars)} you played ${said}: check the sheet music for that note.` : `${wrong.length} notes were not the ones in the song, first in bar ${bars[0]} (${said}): check the sheet music for those notes.`,
    });
  } else if (flagged.length > 0) {
    const bars = barsOf(analysis, flagged);
    const sharpCount = flagged.filter((m) => m.pitchErrorCents! > 0).length;
    const direction = sharpCount >= 0.75 * flagged.length ? 'sharp' : sharpCount <= 0.25 * flagged.length ? 'flat' : null;
    const worst = Math.max(...flagged.map((m) => Math.abs(m.pitchErrorCents!)));
    const adverb = worst > rules.pitchMentionCents ? 'a bit' : 'slightly';
    const fix = direction === 'sharp' ? 'aim a touch lower' : direction === 'flat' ? 'aim a touch higher' : 'listen to the song and match each note';
    let message: string;
    if (flagged.length === 1) {
      const f = flagged[0];
      message = `In ${barsText(bars)} the ${noteLetter(f.note.pitch + result.pitchShift)} was ${adverb} ${f.pitchErrorCents! > 0 ? 'sharp' : 'flat'}: ${fix}.`;
    } else {
      message = `${flagged.length} notes were ${direction ? `${adverb} ${direction}` : 'out of tune'}, in ${barsText(bars)}: ${fix}.`;
    }
    issues.push({ kind: 'pitch', ...noteSpan(flagged), bars, severity: worst > rules.pitchMentionCents ? 'medium' : 'low', message });
  }

  // ---- extra notes ----
  if (result.extras.length > 0) {
    const k = result.extras.length;
    const line = result.line;
    const songBars = result.extras.map((p) => {
      const corrected = p.timeSec - result.latencyMs / 1000;
      const wall = line ? (corrected - line.interceptSec) / line.slope : corrected;
      return barOf(analysis, Math.max(0, result.startSec + wall * result.rate));
    });
    const bars: [number, number] = [Math.min(...songBars), Math.max(...songBars)];
    issues.push({
      kind: 'extra',
      ...span(analysis, bars),
      bars,
      severity: k >= 3 || k >= 0.15 * Math.max(1, n) ? 'medium' : 'low',
      message: k === 1 ? `You played an extra note in ${barsText(bars)}: play only the notes in the song.` : `You played ${k} extra notes, around ${barsText(bars)}: play only the notes in the song.`,
    });
  }

  issues.sort((a, b) => SEVERITY_RANK[b.severity!] - SEVERITY_RANK[a.severity!] || KIND_RANK[b.kind] - KIND_RANK[a.kind]);
  out.issues = issues.slice(0, 3);

  // ---- things that went well, best first ----
  const good: string[] = [];
  const evenRhythm = enough && !wobbles && (residuals.length === 0 || median(residuals.map(Math.abs)) <= rules.onTimeMs);
  if (enough && verdict === 'steady') good.push(tempoRun ? 'You kept a steady tempo overall' : 'You kept a steady tempo');
  if (evenRhythm && verdict !== 'steady') good.push('Your rhythm was even from note to note');
  if (n >= rules.minMatchedNotes && result.missed.length === 0 && result.extras.length === 0) good.push('You played every note, with no extras');
  else if (n >= rules.minMatchedNotes && result.missed.length === 0) good.push('You played every note');
  if (withPitch.length >= rules.minMatchedNotes && flagged.length === 0) good.push('Your notes were in tune');
  else if (withPitch.length >= rules.minMatchedNotes && flagged.length <= 0.2 * withPitch.length) good.push('Most of your notes were in tune');
  if (calibrated && enough && matched.filter((m) => Math.abs(m.timingErrorMs!) <= rules.onTimeMs).length >= 0.7 * n) good.push('Most notes landed right on the beat');
  out.strengths = good.slice(0, 2);

  // ---- the one next step ----
  out.next_step = nextStep(input, issues[0], ratio);

  // ---- the summary ----
  out.summary = summarize(enough, verdict, ratio, evenRhythm, out.issues, out.strengths, n);
  return out;
}

function nextStep(input: FeedbackInput, top: Issue | undefined, ratio: number | undefined): string {
  const { result } = input;
  if (!top) {
    if (result.matched.length < PRACTICE.rules.minMatchedNotes) return 'Try again from the start, playing a little louder so every note is heard.';
    const now = Math.round(result.rate * 100);
    return now < 100 ? `Try it again at ${Math.min(100, now + 10)}% speed.` : 'Try the next section, or play this one without looking at the sheet music.';
  }
  const bars = top.bars ? barsText(top.bars) : 'that part';
  switch (top.kind) {
    case 'tempo':
      return `Loop ${bars} at ${suggestedSpeed(result.rate, ratio)}% speed, then bring it back up.`;
    case 'missed':
      return `Loop ${bars} at ${suggestedSpeed(result.rate, 1)}% speed until every note is there.`;
    case 'pitch':
      return `Play ${bars} slowly and match each note to the song.`;
    case 'extra':
      return `Play ${bars} slowly, one note at a time.`;
    case 'rhythm':
      return `Tap your foot to the beat while you play ${bars}.`;
  }
}

function summarize(enough: boolean, verdict: string | undefined, ratio: number | undefined, evenRhythm: boolean, issues: Issue[], strengths: string[], n: number): string {
  if (!enough) return `I only heard ${n === 1 ? 'one note' : `${n} notes`} that matched the song, which is too few to judge your tempo. Try again from the start and play a little louder.`;
  const side = issues.find((i) => i.kind !== 'tempo');
  if (verdict === 'steady') {
    if (issues.length === 0) return `Nice playing! ${strengths.length > 1 ? `${strengths[0]} and ${strengths[1].charAt(0).toLowerCase()}${strengths[1].slice(1)}.` : `${strengths[0] ?? 'You kept a steady tempo'}.`}`;
    return `You kept a steady tempo${issues.some((i) => i.kind === 'tempo') ? ' overall' : ''}. ${issues[0].message}`;
  }
  const how = verdict === 'dragging' ? 'slower' : 'faster';
  const first = `You played about ${pct(1 - ratio!)}% ${how} than the song${evenRhythm ? ', but your rhythm was even' : ''}.`;
  return side ? `${first} ${side.message}` : `${first} Everything else sounded good.`;
}
