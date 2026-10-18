// The sheet-music view: shows one part of the loaded song with OpenSheetMusicDisplay and follows the playback position.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { bus } from '@/bus';
import type { SongAnalysis } from '@/contracts';
import { buildScore, INSTRUMENT_CHOICES, type Score } from './notes-to-musicxml';
import { emptySheetMessage } from './sheet-empty';
import { cursorTiming, DEFAULT_TIMING, stepAt, wholeNotesAt, type CursorTiming } from './sheet-cursor';
import { learnView, setLetters } from './learn-view';
import { fitWholeSystems, systemTopsOf, systemTopFor } from './sheet-systems';

type DrawState =
  | { status: 'empty' }
  | { status: 'drawing' }
  | { status: 'ready'; noteCount: number }
  | { status: 'error' };

interface Cursor {
  /** Where each cursor step sits in the music, in whole notes. */
  times: number[];
  /** Step the cursor is on now (-1 = not placed yet). */
  index: number;
}

export function Sheet() {
  const [analysis, setAnalysis] = useState<SongAnalysis | undefined>();
  const [partId, setPartId] = useState('');
  // "Beginner mode" is the same switch as the Learn screen's "Show letters" pill (see learn-view.ts)
  const [beginner, setBeginnerState] = useState(() => learnView().letters);
  useEffect(() => bus.on('learnView', (v) => setBeginnerState(v.letters), { replay: true }), []);
  const setBeginner = (on: boolean) => {
    setBeginnerState(on);
    setLetters(on);
  };
  const [instrument, setInstrument] = useState('auto');
  const [draw, setDraw] = useState<DrawState>({ status: 'empty' });

  const hostRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const cursorRef = useRef<Cursor>({ times: [], index: -1 });
  const positionRef = useRef(0);
  const timingRef = useRef<CursorTiming>(DEFAULT_TIMING);
  /** Where each system (line of music) starts inside the host, in px, after the last draw. */
  const systemsRef = useRef<number[]>([]);

  // The band shows whole systems only: its height is the largest number of systems that fit (at least one).
  const fitBand = () => {
    const host = hostRef.current;
    const osmd = osmdRef.current;
    if (!host || !osmd) return;
    systemsRef.current = systemTopsOf(osmd);
    host.style.height = '';
    const fitted = fitWholeSystems(systemsRef.current, host.clientHeight);
    if (fitted !== null) {
      host.style.flex = 'none';
      host.style.height = `${fitted}px`;
    }
  };

  // Listen for the loaded song (and pick its first part).
  useEffect(
    () =>
      bus.on(
        'analysis',
        (a) => {
          setAnalysis(a);
          setPartId(a.parts[0]?.id ?? '');
        },
        { replay: true },
      ),
    [],
  );

  const part = analysis?.parts.find((p) => p.id === partId) ?? analysis?.parts[0];
  const score = useMemo<Score | null>(() => {
    if (!analysis || !part) return null;
    try {
      return buildScore(analysis, part.id, { beginner, instrument: instrument === 'auto' ? undefined : instrument });
    } catch (e) {
      console.error('[sheet] could not build the score', e);
      return null;
    }
  }, [analysis, part, beginner, instrument]);

  if (analysis) timingRef.current = cursorTiming(analysis, part);

  // Move the cursor to where the song is now. Cheap: it only moves when the step changes.
  const followPosition = () => {
    const osmd = osmdRef.current;
    const host = hostRef.current;
    const c = cursorRef.current;
    if (!osmd || !host || c.times.length === 0) return;
    const lo = stepAt(c.times, wholeNotesAt(positionRef.current, timingRef.current));
    if (lo === c.index) return;
    try {
      if (lo < c.index || c.index < 0) {
        osmd.cursor.reset();
        c.index = 0;
      }
      while (c.index < lo) {
        osmd.cursor.next();
        c.index++;
      }
      // Keep the cursor in view inside the sheet box (without scrolling the whole page): turn to the page that starts
      // with the cursor's own system, so whole systems show.
      const el = osmd.cursor.cursorElement;
      if (el && (el.offsetTop < host.scrollTop || el.offsetTop + el.offsetHeight > host.scrollTop + host.clientHeight)) {
        host.scrollTop = Math.max(0, systemTopFor(systemsRef.current, el.offsetTop) ?? el.offsetTop - 24);
      }
    } catch {
      // the cursor is only a nice-to-have
    }
  };
  const followRef = useRef(followPosition);
  followRef.current = followPosition;

  useEffect(
    () =>
      bus.on(
        'transport',
        (t) => {
          positionRef.current = t.positionSec;
          followRef.current();
        },
        { replay: true },
      ),
    [],
  );

  // Draw whenever the score changes. Draws run one after another so a quick toggle cannot overlap.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!score || score.noteCount === 0) {
      queueRef.current = queueRef.current
        .then(() => {
          osmdRef.current?.clear();
          cursorRef.current = { times: [], index: -1 };
        })
        .catch(() => {});
      setDraw({ status: 'empty' });
      return;
    }
    let cancelled = false;
    setDraw({ status: 'drawing' });
    const drawScore = async () => {
      if (cancelled) return;
      try {
        let osmd = osmdRef.current;
        if (!osmd) {
          const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
          if (cancelled) return;
          osmd = osmdRef.current ?? new OpenSheetMusicDisplay(host, {
            autoResize: true,
            backend: 'svg',
            autoBeam: true,
            drawTitle: false,
            drawSubtitle: false,
            drawComposer: false,
            drawPartNames: false,
            followCursor: false,
          });
          osmdRef.current = osmd;
        }
        await osmd.load(score.xml);
        if (cancelled) return;
        osmd.render();
        osmd.cursor.show();
        // Remember where each cursor step sits so following the song is a quick lookup.
        const steps: number[] = [];
        const it = osmd.cursor.Iterator;
        for (let guard = 0; !it.EndReached && guard < 100000; guard++) {
          steps.push(it.CurrentSourceTimestamp.RealValue);
          it.moveToNext();
        }
        osmd.cursor.reset();
        cursorRef.current = { times: steps, index: steps.length ? 0 : -1 };
        if (!host.querySelector('svg')) throw new Error('OpenSheetMusicDisplay drew no SVG');
        setDraw({ status: 'ready', noteCount: score.noteCount });
        fitBand();
        followRef.current();
      } catch (e) {
        console.error('[sheet] could not draw the sheet music', e);
        if (!cancelled) setDraw({ status: 'error' });
      }
    };
    queueRef.current = queueRef.current.then(drawScore).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [score]);

  // After a window resize OSMD redraws on its own; fit the band again once it has.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(fitBand, 400);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // Stop OSMD listening to window resizes when the sheet goes away.
  useEffect(
    () => () => {
      const osmd = osmdRef.current;
      osmdRef.current = null;
      if (osmd) {
        try {
          osmd.setOptions({ autoResize: false });
          osmd.clear();
        } catch {
          // already gone
        }
      }
    },
    [],
  );

  const hasNotes = !!score && score.noteCount > 0;
  // A song with no notes in any part gets the server's own explanation (or a plain default) instead of an empty sheet.
  const songMessage = analysis ? emptySheetMessage(analysis) : undefined;
  return (
    <div className="sheet" data-testid="sheet">
      <div className="sheet-toolbar">
        {analysis && analysis.parts.length > 1 && (
          <label>
            Part{' '}
            <select data-testid="part-picker" value={part?.id ?? ''} onChange={(e) => setPartId(e.target.value)}>
              {analysis.parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Written for{' '}
          <select data-testid="instrument-picker" value={instrument} onChange={(e) => setInstrument(e.target.value)}>
            {INSTRUMENT_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" data-testid="beginner-toggle" checked={beginner} onChange={(e) => setBeginner(e.target.checked)} /> Beginner mode (show note letters)
        </label>
      </div>

      {!analysis && <p className="muted" data-testid="sheet-empty">Load a song to see its sheet music.</p>}
      {analysis && !hasNotes && (
        <p className="muted" data-testid="sheet-empty">
          {songMessage ?? 'This part has no notes to show.'}
        </p>
      )}
      {draw.status === 'drawing' && <p className="muted" role="status">Drawing the sheet music...</p>}
      {draw.status === 'error' && (
        <p className="error" role="alert" data-testid="sheet-error">
          Sorry, the sheet music could not be drawn for this part.
        </p>
      )}
      {draw.status === 'ready' && (
        <p className="muted sheet-status">
          <span data-testid="sheet-ready">Sheet ready.</span> Notes shown: <span data-testid="sheet-note-count">{draw.noteCount}</span>
          {score && score.transposeSemitones !== 0 && ' (written pitch; the song itself is unchanged)'}
        </p>
      )}

      <div ref={hostRef} className="sheet-host" hidden={!hasNotes} />
    </div>
  );
}
