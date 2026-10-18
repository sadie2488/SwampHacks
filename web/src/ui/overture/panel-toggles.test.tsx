// @vitest-environment jsdom
// The open-panels set: reset() puts it back to its start state (none open for people, all open in test browsers).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PANELS_FOR, usePanels } from './PanelToggles';

type Panels = ReturnType<typeof usePanels>;
let latest: Panels;
let root: Root;
let container: HTMLDivElement;

function Probe() {
  latest = usePanels();
  return null;
}

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Probe />));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('usePanels reset', () => {
  it('closes every open panel for a person', async () => {
    vi.stubGlobal('navigator', { ...navigator, webdriver: false });
    await mount();
    expect(latest.isOpen('song')).toBe(false);
    await act(async () => latest.toggle('song'));
    await act(async () => latest.toggle('practice'));
    expect(latest.isOpen('song')).toBe(true);
    expect(latest.isOpen('practice')).toBe(true);
    await act(async () => latest.reset());
    expect(latest.isOpen('song')).toBe(false);
    expect(latest.isOpen('practice')).toBe(false);
    expect(latest.isOpen('player')).toBe(false);
  });

  it('reopens every panel in an automated browser', async () => {
    vi.stubGlobal('navigator', { ...navigator, webdriver: true });
    await mount();
    expect(latest.isOpen('sheet')).toBe(true);
    await act(async () => latest.toggle('sheet'));
    await act(async () => latest.toggle('player'));
    expect(latest.isOpen('sheet')).toBe(false);
    expect(latest.isOpen('player')).toBe(false);
    await act(async () => latest.reset());
    for (const name of ['song', 'devices', 'practice', 'player', 'sheet', 'layers', 'tracks'] as const) expect(latest.isOpen(name)).toBe(true);
  });
});

describe('PANELS_FOR', () => {
  it('gives Learn its panels and Play none at all (hands and voice only)', () => {
    expect(PANELS_FOR.learn).toEqual(['feedback', 'sheet', 'player', 'devices', 'practice', 'song']);
    expect(PANELS_FOR.play).toEqual([]);
  });
});
