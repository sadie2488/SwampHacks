// @vitest-environment jsdom
// The whole page: the history panel sits under the practice panel, and a finished practice run lands in it.
import rulesTempo from '@fixtures/feedback/rules-tempo.json';
import twinkle from '@fixtures/song-analysis/twinkle.json';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus, resetControls, type Topics } from '@/bus';
import type { SongAnalysis } from '@/contracts';
import { App } from './App';
import { stopSessionSaver } from './session-save';

vi.mock('@/modules/playback', () => ({ start: () => () => {} }));
vi.mock('@/modules/commands', () => ({ start: () => () => {} }));
vi.mock('@/modules/vision', () => ({ start: () => () => {} }));
vi.mock('@/modules/audio-live', () => ({ start: () => () => {} }));
vi.mock('@/modules/touchdesigner', () => ({ start: () => () => {} }));
vi.mock('@/modules/create', async () => {
  const { createElement } = await import('react');
  return { start: () => () => {}, CreatePanel: () => createElement('div', { 'data-testid': 'create-panel' }) };
});
vi.mock('@/modules/command-lab', async () => {
  const { createElement } = await import('react');
  return { CommandLab: () => createElement('div', { 'data-testid': 'command-lab' }) };
});
vi.mock('@/modules/sheet', async () => {
  const { createElement } = await import('react');
  return { Sheet: () => createElement('div', { 'data-testid': 'sheet' }) };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 5))));
async function until(check: () => unknown, what: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await settle();
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(async () => {
  localStorage.clear();
  resetControls();
  bus.emit('analysis', twinkle as unknown as SongAnalysis);
  bus.emit('feedback', undefined as unknown as Topics['feedback']);
  vi.stubGlobal('fetch', vi.fn(async () => reply({ detail: 'The history database is not available.' }, 503)));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<App />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  stopSessionSaver();
  vi.unstubAllGlobals();
});

describe('history in the page', () => {
  it('is under the practice panel on Learn and Play, and not on the other tabs', async () => {
    for (const tab of ['tab-learn', 'tab-play']) {
      await act(async () => void $(tab)!.click());
      const practice = $('btn-practice-start')!.closest('.panel')!;
      const history = $('history')!;
      expect(history, tab).not.toBeNull();
      expect(practice.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING, tab).toBeTruthy();
      expect($('sheet')!.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_PRECEDING, tab).toBeTruthy();
    }
    for (const tab of ['tab-create', 'tab-lab']) {
      await act(async () => void $(tab)!.click());
      expect($('history'), tab).toBeNull();
    }
  });

  it('shows a finished run from this browser even though the server is down, with the note', async () => {
    await act(async () => void bus.emit('feedback', structuredClone(rulesTempo) as unknown as Topics['feedback']));
    await until(() => $('history-save-note'), 'the note');
    expect($('history-runs')!.querySelectorAll('li')).toHaveLength(1);
    expect($('feedback-card')).not.toBeNull();
  });
});
