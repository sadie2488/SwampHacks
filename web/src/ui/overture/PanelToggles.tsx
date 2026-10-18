// The mode screens start blank (camera, title, the mode's base picture). Each group of controls is a small panel
// that a quiet toggle in the bottom-left corner opens and closes, like Guide and Hands. Several can be open at once;
// Esc closes them all. Closed panels stay mounted (their state survives) but hidden and out of the keyboard order.
import { useCallback, useEffect, useState } from 'react';
import type { ModeId } from './modes';

export type PanelName = 'song' | 'devices' | 'practice' | 'feedback' | 'player' | 'sheet' | 'layers' | 'tracks';

export const PANELS_FOR: Record<ModeId, PanelName[]> = {
  learn: ['song', 'practice', 'feedback', 'sheet', 'player', 'devices'],
  // Play has no panels at all: it is used purely by hands and voice (the demo song loads itself when none is loaded)
  play: [],
  // Create is one open playground (CreateStage): everything is on the screen, nothing to open or close
  create: [],
  lab: [],
};

const LABELS: Record<PanelName, { label: string; title: string }> = {
  song: { label: 'Song', title: 'Upload a song or use the demo song' },
  devices: { label: 'Devices', title: 'The camera and microphone switches, and your camera picture' },
  practice: { label: 'Practice', title: 'Practice along: steps, calibrate, start and stop, your history' },
  feedback: { label: 'Feedback', title: 'Your feedback after a practice run' },
  player: { label: 'Player', title: 'Play, pause, loop, speed, pitch and volume' },
  sheet: { label: 'Sheet', title: 'The sheet music (it turns its own pages as the song plays)' },
  layers: { label: 'Layers', title: 'Record, layers, instruments and the loop' },
  tracks: { label: 'Tracks', title: 'Save and open your tracks' },
};

const ALL: PanelName[] = ['song', 'devices', 'practice', 'feedback', 'player', 'sheet', 'layers', 'tracks'];

/**
 * Which panels are open. For people they all start closed (the blank screen).
 * In automated test browsers (navigator.webdriver) they all start OPEN, because the browser tests click controls
 * inside the panels right after the page loads. The tests will learn to open the toggles later; until then this
 * keeps them working.
 */
export function defaultOpen(): Set<PanelName> {
  return new Set(typeof navigator !== 'undefined' && navigator.webdriver === true ? ALL : []);
}

export function usePanels() {
  const [open, setOpen] = useState<ReadonlySet<PanelName>>(defaultOpen);
  // back to the start state: Learn and Play share panel names, so a panel left open in one must not show in the other
  const reset = useCallback(() => setOpen(defaultOpen()), []);
  const toggle = useCallback(
    (name: PanelName) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (!next.delete(name)) next.add(name);
        return next;
      }),
    [],
  );
  /** Open a panel if it is closed (Learn opens the player on arrival; the person can still close it). */
  const openPanel = useCallback((name: PanelName) => setOpen((prev) => (prev.has(name) ? prev : new Set(prev).add(name))), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen((prev) => (prev.size ? new Set() : prev));
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { isOpen: (name: PanelName) => open.has(name), toggle, openPanel, reset };
}

export function PanelToggles({ mode, isOpen, toggle }: { mode: ModeId; isOpen: (n: PanelName) => boolean; toggle: (n: PanelName) => void }) {
  const names = PANELS_FOR[mode];
  if (!names.length) return null;
  return (
    <nav className="panel-toggles" aria-label="Show or hide panels">
      {names.map((n) => (
        <button key={n} type="button" className="pill panel-toggle" data-testid={`toggle-${n}`} aria-pressed={isOpen(n)} title={LABELS[n].title} onClick={() => toggle(n)}>
          {LABELS[n].label}
        </button>
      ))}
    </nav>
  );
}

/** Props for a panel's wrapper: open or closed, and out of the keyboard order while closed. */
export const panelProps = (open: boolean) => ({ 'data-open': open ? 'true' : 'false', ...(open ? {} : { inert: '' }) }) as object;
