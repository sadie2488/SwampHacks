// "Your practice so far": the saved runs of the loaded song, a small trend line and one plain sentence about progress.
// Runs come from the server when it is there and from this browser's own copy always, so it works with no server.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { historyMessage, mergeRuns, recentRuns, runLine, trendPoints, type Run } from './history-logic';
import { fetchServerRuns, getSaveState, readLocalRuns, startSessionSaver, subscribeSaves } from './session-save';
import { useBusValue } from './hooks';

const LIST_LENGTH = 10;
const CHART = { width: 200, height: 60 };

function Trend({ runs }: { runs: Run[] }) {
  const { points, mid } = trendPoints(runs, CHART.width, CHART.height);
  if (points.length === 0) return null;
  return (
    <svg
      data-testid="history-trend"
      data-points={points.length}
      role="img"
      aria-label={`Your tempo over your last ${points.length} ${points.length === 1 ? 'run' : 'runs'}, oldest on the left. The dashed line is the song's tempo.`}
      viewBox={`0 0 ${CHART.width} ${CHART.height}`}
      width={CHART.width}
      height={CHART.height}
      style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
    >
      <line data-testid="history-trend-ideal" x1={0} x2={CHART.width} y1={mid} y2={mid} stroke="currentColor" strokeOpacity={0.5} strokeDasharray="4 3" />
      {points.length > 1 && <polyline data-testid="history-trend-line" points={points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={i === points.length - 1 ? 3.5 : 2.5} fill="currentColor" />
      ))}
    </svg>
  );
}

export function History() {
  const songId = useBusValue('analysis')?.song_id;
  const saves = useSyncExternalStore(subscribeSaves, getSaveState);
  const [fromServer, setFromServer] = useState<{ songId: string; runs: Run[] } | null>(null);

  // Runs must be saved even when this panel is not on screen, so the saver outlives it.
  useEffect(() => {
    startSessionSaver();
  }, []);

  // Ask the server again when the song changes and after every finished save. If it cannot be reached, keep what we had.
  useEffect(() => {
    if (!songId) return;
    let cancelled = false;
    void fetchServerRuns(songId).then((runs) => {
      if (!cancelled && runs) setFromServer({ songId, runs });
    });
    return () => {
      cancelled = true;
    };
  }, [songId, saves.syncVersion]);

  const runs = useMemo(
    () => (songId ? mergeRuns(fromServer?.songId === songId ? fromServer.runs : [], readLocalRuns(songId)) : []),
    // localVersion changes whenever this browser's copy does
    [songId, fromServer, saves.localVersion],
  );
  const recent = recentRuns(runs);

  return (
    <section className="panel history" aria-labelledby="history-heading" data-testid="history">
      <h2 id="history-heading">Your practice so far</h2>
      <p data-testid="history-message">{historyMessage(recent, Boolean(songId))}</p>
      {saves.note && (
        <p className="notice" data-testid="history-save-note" role="status">
          {saves.note}
        </p>
      )}
      <Trend runs={recent} />
      {recent.length > 0 && (
        <ul data-testid="history-runs">
          {recent.slice(0, LIST_LENGTH).map((run) => (
            <li key={run.key} data-testid="history-run" data-started={new Date(run.startedAt).toISOString()} data-verdict={run.verdict}>
              {runLine(run)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
