// @vitest-environment jsdom
// The History page: with no runs it points at Learn; with saved runs it shows the numbers, the graph and one feedback
// line per run (newest first); Past creations opens and closes the saved-tracks list. No server, no song playing.
import twinkle from '@fixtures/song-analysis/twinkle.json';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus, type Topics } from '@/bus';
import type { SongAnalysis } from '@/contracts';
import type { Run } from '@/app/history-logic';
import { LOCAL_KEY, stopSessionSaver } from '@/app/session-save';
import { bestRun, closeness, closenessText, HistoryPage, NO_RUNS_IN_HISTORY } from './HistoryPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const song = twinkle as unknown as SongAnalysis;
let container: HTMLDivElement;
let root: Root;
const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (id: string) => [...container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
const forget = <K extends keyof Topics>(topic: K) => bus.emit(topic, undefined as unknown as Topics[K]);
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 5))));
const mount = () => act(async () => root.render(<HistoryPage />));

const T0 = Date.parse('2026-10-10T10:00:00Z');
const run = (n: number, ratio: number): Run => ({
  key: `local-${n}`,
  songId: song.song_id,
  startedAt: T0 + n * 60_000,
  playedBpm: ratio * 100,
  targetBpm: 100,
  ratio,
  verdict: ratio < 0.97 ? 'dragging' : ratio > 1.03 ? 'rushing' : 'steady',
  issues: 1,
});

beforeEach(() => {
  // no server: the history database is not there, so only this browser's runs count
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'The history database is not available.' }), { status: 503 })));
  localStorage.clear();
  forget('analysis');
  forget('feedback');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  stopSessionSaver();
  vi.unstubAllGlobals();
});

describe('closeness to the song tempo', () => {
  it('is 1 on tempo, less the further off, and unknown without a reading', () => {
    expect(closeness(run(1, 1))).toBe(1);
    expect(closeness(run(1, 0.9))).toBeCloseTo(0.9);
    expect(closeness(run(1, 1.25))).toBeCloseTo(0.75);
    expect(closeness({ key: 'k', songId: 's', startedAt: 1 })).toBeNull();
    expect(closenessText(undefined)).toBe('—');
    expect(closenessText(run(1, 0.9))).toBe('90% on tempo');
  });
  it('the best run is the one closest to the tempo', () => {
    expect(bestRun([run(3, 1.2), run(2, 0.98), run(1, 0.9)])?.key).toBe('local-2');
    expect(bestRun([])).toBeUndefined();
  });
});

describe('the History page', () => {
  it('with no runs, says to practice in Learn first and shows no graph', async () => {
    await mount();
    await settle();
    expect($('history-page-empty')?.textContent).toBe(NO_RUNS_IN_HISTORY);
    expect($('history-trend')).toBeNull();
    expect(all('history-feedback-run')).toHaveLength(0);
    expect($('btn-past-creations')?.getAttribute('aria-pressed')).toBe('false');
    expect($('saved-tracks-section')).toBeNull();
  });

  it('with saved runs, shows the numbers, the graph and one feedback line per run, newest first', async () => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify([run(1, 0.9), run(2, 0.95), run(3, 1.01)]));
    bus.emit('analysis', song);
    await mount();
    await settle();
    expect($('history-page-empty')).toBeNull();
    expect($('history-stat-runs')?.textContent).toBe('3');
    expect($('history-stat-best')?.textContent).toBe('99% on tempo');
    expect($('history-stat-latest')?.textContent).toBe('99% on tempo');
    expect($('history-trend')?.getAttribute('data-points')).toBe('3');
    expect($('history-trend-line')).not.toBeNull();
    const lines = all('history-feedback-run').map((li) => li.textContent ?? '');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('101 BPM');
    expect(lines[2]).toContain('90 BPM');
  });

  it('with no song loaded, every run saved in this browser counts', async () => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify([run(1, 0.9), { ...run(2, 1), songId: 'upload-other' }]));
    await mount();
    await settle();
    expect($('history-stat-runs')?.textContent).toBe('2');
  });

  it('Past creations opens and closes the saved-tracks list', async () => {
    await mount();
    await settle();
    await act(async () => $('btn-past-creations')!.click());
    await settle();
    expect($('btn-past-creations')?.getAttribute('aria-pressed')).toBe('true');
    expect($('saved-tracks-section')).not.toBeNull();
    expect($('saved-tracks')).not.toBeNull();
    await act(async () => $('btn-past-creations')!.click());
    expect($('saved-tracks-section')).toBeNull();
  });
});
