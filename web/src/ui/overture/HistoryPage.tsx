// The History page: the third record (its id stays 'play' because the contracts' Mode type is learn | play | create).
// It replaced the Play section Sun 6 AM. One calm page: your practice progress as a graph, the coach's feedback per
// run, and "Past creations", the tracks you saved in Create. Nothing on this page loads or plays a song by itself.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { apiFetch } from '@/app/api-fetch';
import { Trend, usePracticeRuns } from '@/app/History';
import { recentRuns, runLine, type Run } from '@/app/history-logic';
import { useBusValue } from '@/app/hooks';
import { coachingFor, coachLabel, knownCoaching, needsCoaching, type Coaching } from '@/app/practice-logic';
import { readLocalRuns } from '@/app/session-save';
import type { Feedback } from '@/contracts';
import { PastCreations } from '@/modules/create';
import './history-page.css';

const CHART = { width: 720, height: 220 };
const FEEDBACK_LENGTH = 8;

export const NO_RUNS_IN_HISTORY = 'Practice once in Learn to start your history';

/** How close a run was to the song's tempo: 1 is exactly on tempo, 0.9 is 10% off (either way). Null without a tempo reading. */
export function closeness(run: Run): number | null {
  if (run.ratio === undefined || !Number.isFinite(run.ratio) || run.ratio <= 0) return null;
  return Math.max(0, 1 - Math.abs(run.ratio - 1));
}

export function closenessText(run: Run | undefined): string {
  const c = run ? closeness(run) : null;
  return c === null ? '—' : `${Math.round(c * 100)}% on tempo`;
}

/** The run closest to the song's tempo (the newest one wins a tie). Runs come newest first. */
export function bestRun(runs: Run[]): Run | undefined {
  let best: Run | undefined;
  let bestScore = -1;
  for (const run of runs) {
    const c = closeness(run);
    if (c !== null && c > bestScore) {
      best = run;
      bestScore = c;
    }
  }
  return best;
}

/** The coach's wording for the latest feedback: what is already known, else ask once (same as the Learn feedback card). */
function useCoaching(feedback: Feedback | undefined): Coaching | null {
  const [got, setGot] = useState<{ for: Feedback; value: Coaching } | null>(null);
  useEffect(() => {
    if (!feedback || !needsCoaching(feedback) || knownCoaching(feedback)) return;
    let cancelled = false;
    void coachingFor(feedback).then((value) => {
      if (!cancelled) setGot({ for: feedback, value });
    });
    return () => {
      cancelled = true;
    };
  }, [feedback]);
  if (!feedback) return null;
  return knownCoaching(feedback) ?? (got?.for === feedback ? got.value : null);
}

/** Space between the mode title's last line and the top of the box. */
const TITLE_GAP = 16;

/**
 * The box starts under the mode's big words ("HISTORY / YOUR JOURNEY" and the line under them), never over or beside
 * them: the title's bottom edge is measured live (it depends on the window width and the header) and handed to the
 * stylesheet as --history-top; the stylesheet's own value stays as the fallback where nothing can be measured.
 */
function useTopBelowTitle(ref: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const title = el.closest('.stage')?.querySelector<HTMLElement>('.mode-title') ?? document.querySelector<HTMLElement>('.mode-title');
    const place = () => {
      const bottom = title?.getBoundingClientRect().bottom ?? 0;
      if (bottom > 0) el.style.setProperty('--history-top', `${Math.round(bottom + TITLE_GAP)}px`);
      else el.style.removeProperty('--history-top');
    };
    place();
    window.addEventListener('resize', place);
    const watcher = title && typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    if (title) watcher?.observe(title);
    return () => {
      window.removeEventListener('resize', place);
      watcher?.disconnect();
    };
  }, [ref]);
}

export function HistoryPage() {
  const ref = useRef<HTMLElement>(null);
  useTopBelowTitle(ref);
  const { songId, runs: songRuns, saves } = usePracticeRuns();
  // with a song loaded: that song's runs (server and this browser); with none: every run saved in this browser
  const runs = recentRuns(songId ? songRuns : [...readLocalRuns()].sort((a, b) => b.startedAt - a.startedAt));
  const feedback = useBusValue('feedback');
  const coaching = useCoaching(feedback);
  const [creations, setCreations] = useState(false);

  // no title of its own: the mode's big words "HISTORY / YOUR JOURNEY" and their line sit right above this box
  return (
    <section ref={ref} className="history-page" data-testid="history-page" aria-label="History">
      <div className="history-body">
        <div className="history-progress" data-testid="history-progress">
          {runs.length === 0 ? (
            <p className="history-empty" data-testid="history-page-empty">
              {NO_RUNS_IN_HISTORY}
            </p>
          ) : (
            <>
              <dl className="history-stats">
                <div>
                  <dt>Runs so far</dt>
                  <dd data-testid="history-stat-runs">{runs.length}</dd>
                </div>
                <div>
                  <dt>Best run</dt>
                  <dd data-testid="history-stat-best">{closenessText(bestRun(runs))}</dd>
                </div>
                <div>
                  <dt>Latest run</dt>
                  <dd data-testid="history-stat-latest">{closenessText(runs[0])}</dd>
                </div>
              </dl>
              <Trend runs={runs} width={CHART.width} height={CHART.height} />
              <p className="history-axis">Oldest run on the left, newest on the right. The dashed line is the song's tempo: above it you played faster, below it slower.</p>
            </>
          )}
          {saves.note && (
            <p className="notice" role="status">
              {saves.note}
            </p>
          )}
        </div>

        <div className="history-feedback" data-testid="history-feedback">
          <h3 className="history-kicker">Feedback</h3>
          {!feedback && runs.length === 0 && <p className="history-muted">The coach's notes land here after each practice run.</p>}
          <ol className="history-feedback-list">
            {feedback && (
              <li data-testid="history-feedback-latest">
                <b>Latest run</b>
                <span>{feedback.summary}</span>
                {coaching && (
                  <span className="history-coach" data-source={coaching.source}>
                    <em>{coachLabel(coaching.source)}</em> {coaching.text}
                  </span>
                )}
              </li>
            )}
            {runs.slice(0, FEEDBACK_LENGTH).map((run) => (
              <li key={run.key} data-testid="history-feedback-run">
                {runLine(run)}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <footer className="history-foot">
        <button type="button" className="pill" data-testid="btn-past-creations" aria-pressed={creations} title="The tracks you saved in Create" onClick={() => setCreations((c) => !c)}>
          Past creations
        </button>
        <span className="history-muted">{creations ? 'Load or Play puts a track into Create. Open Create to hear it.' : 'The tracks you saved in Create.'}</span>
      </footer>
      {creations && (
        <div className="history-creations" data-testid="history-creations">
          <PastCreations fetchFn={apiFetch} />
        </div>
      )}
    </section>
  );
}
