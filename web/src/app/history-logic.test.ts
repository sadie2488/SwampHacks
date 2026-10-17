import { describe, expect, it } from 'vitest';
import { historyMessage, mergeRuns, NO_RUNS_YET, runFromServer, runFromStored, runLine, trendPoints, verdictWords, type Run } from './history-logic';

const T0 = Date.parse('2026-10-10T10:00:00Z');
const minutes = (n: number) => T0 + n * 60_000;
const run = (n: number, ratio?: number, extra: Partial<Run> = {}): Run => ({ key: `r${n}`, songId: 'demo-twinkle', startedAt: minutes(n), ...(ratio === undefined ? {} : { ratio }), ...extra });
/** Runs given oldest first, returned newest first like the history does. */
const newestFirst = (ratios: number[]): Run[] => ratios.map((r, i) => run(i, r)).reverse();

describe('runFromServer', () => {
  const row = { id: 's1', song_id: 'demo-twinkle', tempo_ratio: 0.8, started_at: '2026-10-10T10:00:00Z', ended_at: '2026-10-10T10:03:00Z', summary: { verdict: 'dragging', played_bpm: 90, target_bpm: 100, ratio: 0.9, issues: 2, source: 'rules' } };

  it('reads the summary the app saves', () => {
    expect(runFromServer(row)).toEqual({ key: 's1', id: 's1', songId: 'demo-twinkle', startedAt: T0, playedBpm: 90, targetBpm: 100, ratio: 0.9, verdict: 'dragging', issues: 2 });
  });

  it('works the ratio out from the two tempos when the summary has none', () => {
    expect(runFromServer({ ...row, summary: { played_bpm: 50, target_bpm: 100 } })?.ratio).toBe(0.5);
  });

  it('keeps a run whose summary is missing or odd, without making numbers up (the playback speed is not the played ratio)', () => {
    for (const summary of [null, undefined, 'x', [], { ratio: 'fast', played_bpm: -3 }]) {
      const r = runFromServer({ ...row, summary });
      expect(r, String(summary)).toMatchObject({ id: 's1', songId: 'demo-twinkle', startedAt: T0 });
      expect(r?.ratio).toBeUndefined();
    }
  });

  it('skips rows that are not usable', () => {
    for (const bad of [null, 'x', {}, { ...row, id: '' }, { ...row, song_id: 3 }, { ...row, started_at: 'yesterday' }, { ...row, started_at: null }]) expect(runFromServer(bad)).toBeNull();
  });
});

describe('runFromStored', () => {
  it('accepts a run and drops bad numbers', () => {
    expect(runFromStored({ key: 'k', songId: 'a', startedAt: 5, id: 'x', ratio: 0.9, playedBpm: 'many', verdict: 'steady', issues: 1 })).toEqual({ key: 'k', songId: 'a', startedAt: 5, id: 'x', ratio: 0.9, verdict: 'steady', issues: 1 });
  });
  it('rejects things that are not runs', () => {
    for (const bad of [null, 4, [], {}, { key: 'k', songId: 'a' }, { key: '', songId: 'a', startedAt: 1 }]) expect(runFromStored(bad)).toBeNull();
  });
});

describe('mergeRuns', () => {
  it('puts server and local runs in one list, newest first', () => {
    const merged = mergeRuns([run(5, 0.9, { id: 'a', key: 'a' }), run(1, 0.8, { id: 'b', key: 'b' })], [run(3, 1.1, { key: 'local-3' })]);
    expect(merged.map((r) => r.startedAt)).toEqual([minutes(5), minutes(3), minutes(1)]);
  });

  it('shows a run once when the local copy knows the server id', () => {
    const merged = mergeRuns([run(5, 0.9, { id: 'a', key: 'a' })], [run(5, 0.9, { id: 'a', key: 'local-5' }), run(2, 1, { key: 'local-2' })]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ key: 'a', id: 'a' });
  });

  it('shows a run once when only the start times match (a few seconds apart)', () => {
    const server = { ...run(5, 0.9, { id: 'a', key: 'a' }), startedAt: minutes(5) + 800 };
    const merged = mergeRuns([server], [run(5, 0.9, { key: 'local-5' })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('a');
  });

  it('keeps two different runs that are minutes apart, and runs of other songs', () => {
    expect(mergeRuns([run(1, 0.9, { id: 'a', key: 'a' })], [run(2, 0.9, { key: 'l' })])).toHaveLength(2);
    expect(mergeRuns([run(1, 0.9, { id: 'a', key: 'a' })], [run(1, 0.9, { key: 'l', songId: 'upload-1a2b3c4d' })])).toHaveLength(2);
  });

  it('fills in what the server did not record, but never overrides what it did', () => {
    const server = run(5, undefined, { id: 'a', key: 'a' });
    const local = run(5, 0.9, { id: 'a', key: 'local-5', playedBpm: 90, targetBpm: 100, verdict: 'dragging' });
    expect(mergeRuns([server], [local])[0]).toMatchObject({ key: 'a', ratio: 0.9, playedBpm: 90, verdict: 'dragging' });
    expect(mergeRuns([run(5, 0.5, { id: 'a', key: 'a' })], [local])[0].ratio).toBe(0.5);
  });

  it('does not change what it was given', () => {
    const server = [run(5, undefined, { id: 'a', key: 'a' })];
    mergeRuns(server, [run(5, 0.9, { id: 'a', key: 'l' })]);
    expect(server[0].ratio).toBeUndefined();
  });

  it('works with nothing on either side', () => {
    expect(mergeRuns([], [])).toEqual([]);
  });
});

describe('historyMessage', () => {
  it('says to practise when there is nothing yet, or no song', () => {
    expect(historyMessage([])).toBe(NO_RUNS_YET);
    expect(historyMessage([], false)).toMatch(/Load a song/);
  });

  it('welcomes the first run', () => {
    expect(historyMessage(newestFirst([0.9]))).toBe('Nice, your first run is saved. Practice again to see how you are doing.');
  });

  it('notices when the last 3 runs are closer to the tempo than the first 3', () => {
    expect(historyMessage(newestFirst([0.7, 0.75, 0.8, 0.95, 0.98, 1.0]))).toBe("You are getting steadier: your last 3 runs were closer to the song's tempo than your first 3");
  });

  it('notices when the last 3 runs are further from the tempo', () => {
    const message = historyMessage(newestFirst([1.0, 0.98, 0.95, 0.8, 0.75, 0.7]));
    expect(message).toMatch(/^Your last 3 runs were a bit further from the song's tempo than your first 3\./);
    expect(message).toMatch(/slower speed/);
  });

  it('says steady when nothing really changed', () => {
    expect(historyMessage(newestFirst([0.9, 1.1, 0.95, 0.91, 1.09, 0.96]))).toBe("You are staying consistent: your last 3 runs were about as close to the song's tempo as your first 3");
  });

  it('treats running too fast and too slow as the same distance from the tempo', () => {
    expect(historyMessage(newestFirst([1.3, 1.25, 1.2, 0.9, 0.95, 1.02]))).toMatch(/^You are getting steadier/);
  });

  it('compares smaller groups when there are fewer than six runs', () => {
    expect(historyMessage(newestFirst([0.7, 0.99]))).toBe("You are getting steadier: your latest run was closer to the song's tempo than your first");
    expect(historyMessage(newestFirst([0.99, 0.7]))).toMatch(/^Your latest run was a bit further from the song's tempo than your first\./);
    expect(historyMessage(newestFirst([0.6, 0.7, 0.8, 0.95, 1.0]))).toMatch(/your last 2 runs were closer .* than your first 2/);
  });

  it('only looks at runs that have a tempo reading', () => {
    const runs = [run(4, 0.99), run(3), run(2), run(1, 0.6)];
    expect(historyMessage(runs)).toMatch(/^You are getting steadier: your latest run/);
    expect(historyMessage([run(2), run(1)])).toMatch(/Play along to the end/);
  });

  it('only looks at the 20 newest runs', () => {
    const old = Array.from({ length: 20 }, (_, i) => run(i, 1)); // perfect, but old
    const recent = Array.from({ length: 20 }, (_, i) => run(100 + i, 0.8));
    expect(historyMessage([...recent.reverse(), ...old.reverse()])).toMatch(/staying consistent/);
  });
});

describe('trendPoints', () => {
  it('goes oldest to newest from left to right, with faster runs drawn higher', () => {
    const { points, mid } = trendPoints(newestFirst([0.8, 1.0, 1.2]), 200, 60);
    expect(points.map((p) => p.ratio)).toEqual([0.8, 1.0, 1.2]);
    expect(points[0].x).toBeLessThan(points[1].x);
    expect(points[1].x).toBeLessThan(points[2].x);
    expect(points[1].y).toBeCloseTo(mid);
    expect(points[0].y).toBeGreaterThan(mid);
    expect(points[2].y).toBeLessThan(mid);
  });

  it('keeps every point inside the chart', () => {
    const { points } = trendPoints(newestFirst([0.2, 3, 1]), 200, 60);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(200);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(60);
    }
  });

  it('puts a single run in the middle, and has no points when no run has a reading', () => {
    expect(trendPoints(newestFirst([1.1]), 200, 60).points[0].x).toBe(100);
    expect(trendPoints([run(1)], 200, 60).points).toEqual([]);
    expect(trendPoints([], 200, 60).points).toEqual([]);
  });
});

describe('words', () => {
  it('describes the verdict', () => {
    expect(verdictWords({ verdict: 'dragging', ratio: 0.9 })).toBe('a bit slow');
    expect(verdictWords({ verdict: 'dragging', ratio: 0.6 })).toBe('quite slow');
    expect(verdictWords({ verdict: 'rushing', ratio: 1.3 })).toBe('quite fast');
    expect(verdictWords({ verdict: 'steady', ratio: 1 })).toBe('nice and steady');
    expect(verdictWords({})).toBe('no tempo reading');
  });

  it('writes a line for the list', () => {
    expect(runLine(run(0, 0.9, { playedBpm: 90.4, targetBpm: 100, verdict: 'dragging' }))).toMatch(/: played about 90 BPM, the song is 100 BPM: a bit slow$/);
    expect(runLine(run(0))).toMatch(/: practice run saved$/);
  });
});
