// Each mode's base picture over the camera (the Overture mockup's mode screens), driven by real bus data:
// - Learn: five staff lines, a playhead at 30% in the mode colour, the song's notes gliding right to left; a note
//   lights up and swells with the song's loudness while it sounds. Readout: key and tempo.
// - Create: three rings that swell with the voice, "HUM SOMETHING"; readout: the note heard, the layer count and
//   tiny labels of what each hand is doing. Nothing else.
// - History (the 'play' id): no canvas picture; the History page (feedback, progress, past creations) is shown instead.
// One canvas, never clickable; it draws at most 30 times a second and only while something changes.
import { useEffect, useRef, useState } from 'react';
import { bus, type PitchFrame, type TransportState } from '@/bus';
import type { SongAnalysis } from '@/contracts';
import { CountIn } from './CountIn';
import { HistoryPage } from './HistoryPage';
import { keyWords, noteName, placeNotes, staffGeometry, staffNotes } from './mode-visual';
import { LearnStage } from './LearnStage';
import { modeLook, type ModeId } from './modes';

const MAX_DPR = 1.5;
const FRAME_MS = 1000 / 30 - 2;
const HAND_WORDS: Record<string, string> = { fist: 'fist', open_palm: 'open hand', raised: 'raised', pinch: 'pinch', thumbs_up: 'thumbs up', drum_hit: 'drum hit' };

/** What the hands do in Create, always shown under the hum rings; the part in use lights up in the mode colour. */
const HAND_LEGEND: Array<[string, string]> = [
  ['pitch', 'Right hand up / down: pitch'],
  ['volume', 'side to side: volume'],
  ['keep', 'left thumbs-up: keep'],
  ['stop', 'fist: stop'],
];
const LEGEND_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  top: 'calc(80% + 48px)',
  margin: 0,
  textAlign: 'center',
  font: "500 12px / 1.4 var(--sans, 'Instrument Sans', sans-serif)",
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'rgba(242, 238, 230, 0.7)',
  pointerEvents: 'none',
  zIndex: 3,
};

interface Readout {
  a: [string, string];
  b: [string, string];
  hands?: string[];
}

export function ModeVisual({ mode }: { mode: ModeId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  /** Which part of the hand legend the hands are using right now (Create only). */
  const [lit, setLit] = useState<string | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || mode === 'lab' || mode === 'play') return setReadout(null);
    const ink = modeLook(mode).a;
    let analysis: SongAnalysis | undefined = bus.last('analysis');
    let notes = staffNotes(analysis);
    let transport: TransportState | undefined;
    let transportAt = 0;
    let level = 0;
    let voice = 0;
    let heard: number | null = null;
    const hands: Record<string, string> = {};
    let raf = 0;
    let last = 0;

    const text = () => {
      if (mode === 'learn') return setReadout({ a: ['Key', keyWords(analysis)], b: ['Tempo', analysis ? `${Math.round(transport?.bpm ?? analysis.tempo_bpm)} bpm` : '—'] });
      const layers = document.querySelectorAll('[data-testid="create-panel"] li[data-testid^="layer-"]').length;
      const handList = Object.entries(hands).map(([side, what]) => `${side} hand · ${what}`);
      setReadout({ a: ['Heard', heard === null ? '—' : noteName(heard)], b: ['Layers', String(layers)], hands: handList });
    };

    const draw = (now: number) => {
      raf = 0;
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(242, 238, 230, 0.7)';
      ctx.lineWidth = 1;
      voice += ((heard === null ? 0 : 1) * level - voice) * 0.25;
      if (mode === 'learn') {
        const g = staffGeometry(w, h);
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          ctx.moveTo(0, g.top + i * g.gap);
          ctx.lineTo(w, g.top + i * g.gap);
        }
        ctx.stroke();
        ctx.strokeStyle = ink;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(g.playheadX, g.top - 40);
        ctx.lineTo(g.playheadX, g.top + g.gap * 4 + 40);
        ctx.stroke();
        const playing = !!transport?.playing;
        const pos = (transport?.positionSec ?? 0) + (playing ? ((now - transportAt) / 1000) * (transport?.tempo ?? 1) : 0);
        ctx.lineWidth = 1;
        for (const n of placeNotes(notes, pos, g, w)) {
          ctx.beginPath();
          ctx.ellipse(n.x, n.y, n.on ? 9 + level * 10 : 7, n.on ? 6 + level * 6 : 5, -0.35, 0, Math.PI * 2);
          ctx.fillStyle = ink;
          if (n.on) ctx.fill();
          ctx.strokeStyle = 'rgba(242, 238, 230, 0.9)';
          ctx.stroke();
        }
        if (playing) schedule();
      } else if (mode === 'create') {
        const cx = w / 2;
        const cy = h * 0.52;
        for (let k = 0; k < 3; k++) {
          ctx.setLineDash(k ? [1, 9] : []);
          ctx.beginPath();
          ctx.arc(cx, cy, h * 0.28 + k * 18 + voice * 40 * (k + 1), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(242, 238, 230, 0.9)';
        ctx.font = "500 13px 'Instrument Sans', sans-serif";
        ctx.textAlign = 'center';
        ctx.fillText('Hum something', cx, cy + 5);
        if (voice > 0.01) schedule();
      }
    };
    const schedule = () => {
      if (raf || document.hidden) return;
      raf = requestAnimationFrame((now) => (now - last >= FRAME_MS ? ((last = now), draw(now)) : ((raf = 0), schedule())));
    };

    const offs = [
      bus.on('analysis', (a) => ((analysis = a), (notes = staffNotes(a)), text(), schedule()), { replay: true }),
      bus.on('transport', (t) => ((transport = t), (transportAt = performance.now()), text(), schedule()), { replay: true }),
      bus.on('songLevels', (lv) => void (level = lv.level)),
    ];
    if (mode === 'create') {
      offs.push(
        bus.on('pitch', (p: PitchFrame) => {
          level = Math.min(1, p.rms * 4);
          const was = heard;
          heard = p.midi !== null && p.confidence > 0.6 ? p.midi : null;
          if ((was === null) !== (heard === null) || (heard !== null && was !== null && Math.round(was) !== Math.round(heard))) text();
          schedule();
        }),
        bus.on('signal', (s) => {
          const m = /^vision\.hand\.(left|right)\.([a-z_]+)$/.exec(s.id);
          if (!m || !HAND_WORDS[m[2]] || !s.state) return;
          if (s.state === 'start') hands[m[1]] = HAND_WORDS[m[2]];
          else delete hands[m[1]];
          text();
        }),
        bus.on('command', (c) => {
          if (!c.command.startsWith('create.')) return;
          setTimeout(text, 50);
          if (c.source !== 'gesture') return;
          // light the legend part the hands are using right now
          if (c.command === 'create.layer.pitch') light('pitch', 400);
          else if (c.command === 'create.layer.volume') light('volume', 400);
          else if (c.command === 'create.layer.confirm_pitch') light('keep', 1200);
          else if (c.command === 'create.loop.stop' || (c.command === 'create.loop.record' && c.value === false)) light('stop', 1200);
        }),
      );
    }
    let litTimer: ReturnType<typeof setTimeout> | undefined;
    const light = (what: string, ms: number) => {
      setLit(what);
      clearTimeout(litTimer);
      litTimer = setTimeout(() => setLit(null), ms);
    };
    const onResize = () => schedule();
    window.addEventListener('resize', onResize);
    text();
    schedule();
    return () => {
      offs.forEach((off) => off());
      window.removeEventListener('resize', onResize);
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(litTimer);
      setLit(null);
    };
  }, [mode]);

  return (
    <>
      <canvas ref={ref} className="mode-visual" aria-hidden="true" />
      {mode === 'learn' && <LearnStage ink={modeLook('learn').a} />}
      {mode === 'play' && <HistoryPage />}
      {mode === 'create' && <CountIn />}
      {mode === 'create' && (
        <p className="hand-legend" data-testid="hand-legend" aria-live="off" style={LEGEND_STYLE}>
          {HAND_LEGEND.map(([key, words], i) => (
            <span key={key} style={lit === key ? { color: modeLook('create').a } : undefined}>
              {i ? ' · ' : ''}
              {words}
            </span>
          ))}
        </p>
      )}
      {readout && (
        <div className="mode-readout" data-testid="mode-readout" aria-live="off">
          {[readout.a, readout.b].map(([k, v]) => (
            <p key={k}>
              {k}
              <b>{v}</b>
            </p>
          ))}
          {readout.hands?.map((t) => <p key={t} className="hand-label">{t}</p>)}
        </div>
      )}
    </>
  );
}
