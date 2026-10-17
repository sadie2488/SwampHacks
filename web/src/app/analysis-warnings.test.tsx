// @vitest-environment jsdom
// The song's plain-words warnings, the "no sheet music" message and the "not very sure" hints, with a pretend sheet engine.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import twinkle from '@fixtures/song-analysis/twinkle.json';
import { bus, type Topics } from '@/bus';
import type { SongAnalysis } from '@/contracts';
import { Sheet } from '@/modules/sheet';
import { AnalysisSummary } from './AnalysisSummary';

vi.mock('opensheetmusicdisplay', () => ({
  OpenSheetMusicDisplay: class {
    constructor(private host: HTMLElement) {}
    async load() {}
    render() {
      this.host.innerHTML = '<svg></svg>';
    }
    clear() {
      this.host.innerHTML = '';
    }
    setOptions() {}
    cursor = { show() {}, reset() {}, next() {}, cursorElement: null, Iterator: { EndReached: true, moveToNext() {}, CurrentSourceTimestamp: { RealValue: 0 } } };
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const demo = twinkle as unknown as SongAnalysis;
const BAND = 'This song has many instruments playing at once, so the notes may not be right. For the best sheet music, use a recording of one instrument playing alone.';
const NO_MELODY = "I couldn't find a single melody line in this song, so there is no sheet music, but the tempo and key are real.";
const withoutNotes = (extra: Partial<SongAnalysis> = {}): SongAnalysis => ({ ...demo, song_id: 'upload-1a2b3c4d', parts: [], ...extra });

let container: HTMLDivElement;
let root: Root;
const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const text = (id: string) => $(id)?.textContent ?? null;
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 5))));
async function until(check: () => unknown, what: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await settle();
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const emit = <K extends keyof Topics>(topic: K, value: Topics[K]) => act(async () => void bus.emit(topic, value));
/** Shows a song in both places at once, the way the song view does. */
const show = (a: SongAnalysis) => emit('analysis', structuredClone(a));

beforeEach(async () => {
  bus.emit('analysis', structuredClone(demo)); // a known song to start from: the bus replays the last one to new listeners
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <>
        <AnalysisSummary />
        <Sheet />
      </>,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('warnings box', () => {
  it('lists every warning, in order, exactly as the server sent them', async () => {
    await show({ ...demo, warnings: [BAND, NO_MELODY] });
    const box = $('analysis-warnings')!;
    expect(box).not.toBeNull();
    expect(box.getAttribute('role')).toBe('status');
    expect(text('analysis-warning-0')).toBe(BAND);
    expect(text('analysis-warning-1')).toBe(NO_MELODY);
    expect($('analysis-warning-2')).toBeNull();
    expect($('analysis-warning-0')!.tagName).toBe('LI');
    // above the sheet music
    expect(box.compareDocumentPosition($('sheet')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows text as text: markup in a warning is not turned into elements', async () => {
    const sneaky = 'Careful: <b>x</b> <img src=x onerror="alert(1)">';
    await show({ ...demo, warnings: [sneaky] });
    expect(text('analysis-warning-0')).toBe(sneaky);
    expect($('analysis-warning-0')!.querySelector('b, img')).toBeNull();
    expect($('analysis-warnings')!.querySelector('b, img')).toBeNull();
  });

  it('draws no box at all when there are no warnings, an empty list, or only blank ones', async () => {
    await show(demo);
    expect($('analysis-summary')).not.toBeNull();
    expect($('analysis-warnings')).toBeNull();
    await show({ ...demo, warnings: [] });
    expect($('analysis-warnings')).toBeNull();
    await show({ ...demo, warnings: ['', '   '] });
    expect($('analysis-warnings')).toBeNull();
  });

  it('goes away when the next song has no warnings', async () => {
    await show({ ...demo, warnings: [BAND] });
    expect($('analysis-warnings')).not.toBeNull();
    await show(demo);
    expect($('analysis-warnings')).toBeNull();
  });
});

describe('the sheet for a song with no notes', () => {
  it('says the first warning in place of an empty sheet', async () => {
    await show(withoutNotes({ warnings: [NO_MELODY, BAND] }));
    await until(() => $('sheet-empty'), 'the message');
    expect(text('sheet-empty')).toBe(NO_MELODY);
    expect($('sheet-ready')).toBeNull();
    expect($('sheet-note-count')).toBeNull();
  });

  it('says the default line when there is no warning', async () => {
    await show(withoutNotes());
    await until(() => $('sheet-empty'), 'the message');
    expect(text('sheet-empty')).toBe('There is no sheet music for this song yet.');
  });

  it('does the same when the parts exist but none has a note', async () => {
    await show(withoutNotes({ parts: [{ id: 'melody', name: 'Melody', notes: [] }, { id: 'bass', name: 'Bass', notes: [] }] }));
    await until(() => $('sheet-empty'), 'the message');
    expect(text('sheet-empty')).toBe('There is no sheet music for this song yet.');
  });

  it('keeps the sheet and its test ids for a song that has notes, warnings or not', async () => {
    await show({ ...demo, warnings: [BAND] });
    await until(() => $('sheet-ready'), 'the sheet');
    expect($('sheet-empty')).toBeNull();
    expect(text('sheet-note-count')).toBe('42');
    expect(text('analysis-warning-0')).toBe(BAND);
  });

  it('keeps the old line for an empty part of a song whose other parts have notes', async () => {
    await show({ ...demo, warnings: [BAND], parts: [{ id: 'empty', name: 'Empty', notes: [] }, demo.parts[0]] });
    await until(() => $('sheet-empty'), 'the message');
    expect(text('sheet-empty')).toBe('This part has no notes to show.');
  });
});

describe('"not very sure" hints', () => {
  const sure = (tempo?: number, key?: number): SongAnalysis => ({ ...demo, tempo_confidence: tempo, key: { ...demo.key, confidence: key } });

  it('shows the tempo hint only below 0.3', async () => {
    await show(sure(0.29, 0.9));
    expect(text('analysis-tempo-unsure')).toBe("I'm not very sure about the tempo");
    expect($('analysis-key-unsure')).toBeNull();
    await show(sure(0.3, 0.9));
    expect($('analysis-tempo-unsure')).toBeNull();
    await show(sure(0, 0.9));
    expect($('analysis-tempo-unsure')).not.toBeNull();
  });

  it('shows the key hint only below 0.5', async () => {
    await show(sure(0.9, 0.49));
    expect(text('analysis-key-unsure')).toBe("I'm not very sure about the key");
    expect($('analysis-tempo-unsure')).toBeNull();
    await show(sure(0.9, 0.5));
    expect($('analysis-key-unsure')).toBeNull();
  });

  it('shows both when both are low, next to the values, which keep their own text', async () => {
    await show(sure(0.1, 0.2));
    expect($('analysis-tempo-unsure')).not.toBeNull();
    expect($('analysis-key-unsure')).not.toBeNull();
    expect(text('analysis-tempo')).toBe('100 BPM');
    expect(text('analysis-key')).toBe('C major');
    expect($('analysis-tempo')!.parentElement).toBe($('analysis-tempo-unsure')!.parentElement);
    expect($('analysis-key')!.parentElement).toBe($('analysis-key-unsure')!.parentElement);
  });

  it('shows nothing when the confidence is missing or high', async () => {
    await show(sure(undefined, undefined));
    expect($('analysis-tempo-unsure')).toBeNull();
    expect($('analysis-key-unsure')).toBeNull();
    await show(sure(0.98, 0.97));
    expect($('analysis-tempo-unsure')).toBeNull();
    expect($('analysis-key-unsure')).toBeNull();
  });
});

describe('the built-in demo song', () => {
  it('shows nothing extra: no warnings, no hints, a normal sheet', async () => {
    await show(demo);
    await until(() => $('sheet-ready'), 'the sheet');
    expect($('analysis-warnings')).toBeNull();
    expect($('analysis-tempo-unsure')).toBeNull();
    expect($('analysis-key-unsure')).toBeNull();
    expect($('sheet-empty')).toBeNull();
    expect(text('analysis-tempo')).toBe('100 BPM');
    expect(text('sheet-note-count')).toBe('42');
  });
});
