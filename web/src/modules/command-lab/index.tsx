// The Command Lab: the test page for the whole command system.
//   - live camera with the tracking drawn on top
//   - a live meter for every signal the app can sense
//   - every control and its current value (it flashes when a command arrives)
//   - the loaded mapping rules, as a grid of cards (a card lights up when its rule fires) and any problems found in mappings.yaml
//   - a "Test without a camera" panel: buttons and sliders that send fake signals, so mappings can be tried with no hardware
// Everything arrives over the bus. The one exception: the rule list is read from mappings.yaml itself (same lane as the engine),
// because the bus has no topic for "the loaded rules".
import { useCallback, useEffect, useRef, useState } from 'react';
import { bus, getStatus, isFakeMode, isModuleOn, sendSignal, type ControlState, type EngineIssue, type Landmarks, type Topics } from '@/bus';
import { controlCatalog, signalCatalog, signalInfo } from '@/contracts/catalogs';
import type { CommandEvent, ControlInfo, ControlValue, Mode, SignalInfo } from '@/contracts';
import { loadMappings, type Rule } from '../commands/engine';
import { getMappingsText, onMappingsText } from '../mappings';
import './command-lab.css';

// ---- small helpers ----------------------------------------------------------------------------------------------
/** The latest value of a bus topic as React state (starts from the last published value, if any). */
function useTopic<K extends keyof Topics>(topic: K, initial: Topics[K]): Topics[K] {
  const [value, setValue] = useState<Topics[K]>(() => bus.last(topic) ?? initial);
  useEffect(() => bus.on(topic, (v) => setValue(() => v), { replay: true }), [topic]);
  return value;
}

/** Things that light up for a moment: flash(key) turns key on, and it switches itself off after `ms`. */
function useFlashes(ms: number) {
  const [on, setOn] = useState<Record<string, boolean>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const all = timers.current;
    return () => all.forEach(clearTimeout);
  }, []);
  const flash = useCallback(
    (key: string) => {
      clearTimeout(timers.current.get(key));
      setOn((o) => ({ ...o, [key]: true }));
      timers.current.set(
        key,
        setTimeout(() => setOn((o) => ({ ...o, [key]: false })), ms),
      );
    },
    [ms],
  );
  return [on, flash] as const;
}

function formatValue(v: ControlValue | undefined, info: ControlInfo): string {
  if (v === undefined) return info.kind === 'trigger' ? 'button' : 'not set';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'number') return `${Number(v.toFixed(2))}${info.unit ? ' ' + info.unit : ''}`;
  if (Array.isArray(v)) return `${v[0]} to ${v[1]}${info.unit ? ' ' + info.unit : ''}`;
  return v;
}

// ---- camera -----------------------------------------------------------------------------------------------------
// The video is mirrored with CSS (command-lab.css) so it behaves like a mirror: your right hand shows on the right.
// The landmarks already arrive mirrored from the vision module, so the canvas is NOT flipped (not in CSS, not here):
// a point at x = 0.2 is drawn at 0.2 * width. Flipping it again would draw the hands on the wrong side.
const HAND_LINES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

/** Draw hands (lines and dots) and face (small dots) over the camera picture. Pass null to clear. */
export function drawLandmarks(canvas: HTMLCanvasElement | null, lm: Landmarks | null): void {
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  if (lm && lm.width > 0 && lm.height > 0 && (canvas.width !== lm.width || canvas.height !== lm.height)) {
    canvas.width = lm.width;
    canvas.height = lm.height;
  }
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!lm) return;
  const dot = Math.max(2, w / 160);
  ctx.lineWidth = Math.max(2, w / 320);
  for (const point of lm.face?.points ?? []) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(point.x * w, point.y * h, dot / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const hand of lm.hands) {
    const color = hand.handedness === 'Left' ? '#3aa0ff' : '#ff9f1a';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    for (const [a, b] of HAND_LINES) {
      const p = hand.points[a];
      const q = hand.points[b];
      if (!p || !q) continue;
      ctx.beginPath();
      ctx.moveTo(p.x * w, p.y * h);
      ctx.lineTo(q.x * w, q.y * h);
      ctx.stroke();
    }
    for (const point of hand.points) {
      ctx.beginPath();
      ctx.arc(point.x * w, point.y * h, dot, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function CameraPanel() {
  const stream = useTopic('cameraStream', null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // the button follows what the vision module says it is doing (the same source as the camera button in the app header)
  const [cameraOn, setCameraOn] = useState(() => isModuleOn('vision'));
  const [message, setMessage] = useState(() => getStatus('vision')?.message ?? '');
  const [aspect, setAspect] = useState(4 / 3);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
    if (!stream) drawLandmarks(canvasRef.current, null);
  }, [stream]);

  useEffect(() => {
    const stopLandmarks = bus.on('landmarks', (lm) => {
      if (lm.width > 0 && lm.height > 0) setAspect(lm.width / lm.height);
      drawLandmarks(canvasRef.current, lm);
    });
    // keep the button honest: if the camera could not start, or was turned off elsewhere, show it
    const stopStatus = bus.on('status', (s) => {
      if (s.module !== 'vision') return;
      setMessage(s.message ?? '');
      setCameraOn(s.state === 'starting' || s.state === 'running');
    });
    return () => {
      stopLandmarks();
      stopStatus();
    };
  }, []);

  const toggleCamera = () => {
    const next = !cameraOn;
    setCameraOn(next);
    bus.emit('enable', { module: 'vision', on: next });
  };

  return (
    <section aria-labelledby="lab-camera-heading">
      <h2 id="lab-camera-heading">Camera</h2>
      <button type="button" data-testid="lab-enable-camera" aria-pressed={cameraOn} onClick={toggleCamera}>
        {cameraOn ? 'Turn camera off' : 'Turn camera on'}
      </button>
      {message ? <p role="status">{message}</p> : null}
      {isFakeMode() ? <p>Fake mode: recorded movements replace the camera.</p> : null}
      <div className="lab-camera" style={{ aspectRatio: String(aspect) }}>
        <video ref={videoRef} data-testid="lab-video" autoPlay playsInline muted onLoadedMetadata={(e) => e.currentTarget.videoWidth > 0 && setAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight)} />
        <canvas ref={canvasRef} data-testid="lab-overlay" aria-label="Tracking drawn over the camera picture" />
      </div>
    </section>
  );
}

// ---- signal meters ----------------------------------------------------------------------------------------------
interface Reading {
  value?: number;
  confidence?: number;
  /** A moment that is being held right now (a closed fist...). */
  held: boolean;
  /** How many times the moment has started. */
  count: number;
}

function SignalMeters() {
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const latest = useRef<Record<string, Reading>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [flashing, flash] = useFlashes(400);

  useEffect(() => {
    const flush = () => {
      timer.current = undefined;
      setReadings({ ...latest.current });
    };
    const stop = bus.on('signal', (s) => {
      const before = latest.current[s.id] ?? { held: false, count: 0 };
      const next: Reading = { ...before, confidence: s.confidence };
      if (s.kind === 'slider') {
        next.value = s.value;
      } else if (s.state === 'end') {
        next.held = false;
      } else {
        // only a holdable moment (a fist) stays "on" until its end; a clap or a spoken word never sends an end, so it just flashes
        next.held = signalInfo(s.id)?.holdable === true;
        next.count += 1;
        flash(s.id);
      }
      latest.current[s.id] = next;
      // sliders can arrive 60 times a second: draw them at most every 50 ms. Moments are rare: show them at once.
      if (s.kind === 'moment') {
        clearTimeout(timer.current);
        flush();
      } else if (!timer.current) {
        timer.current = setTimeout(flush, 50);
      }
    });
    return () => {
      stop();
      clearTimeout(timer.current);
      timer.current = undefined;
    };
  }, [flash]);

  const groups: Array<[string, SignalInfo[]]> = [
    ['Camera signals', signalCatalog.signals.filter((s) => s.source === 'vision')],
    ['Sound signals', signalCatalog.signals.filter((s) => s.source === 'audio')],
    ['Other signals', signalCatalog.signals.filter((s) => s.source !== 'vision' && s.source !== 'audio')],
  ];

  return (
    <section aria-labelledby="lab-signals-heading">
      <h2 id="lab-signals-heading">Signals</h2>
      <p>Everything the app can sense. Sliders show a bar; moments light a lamp.</p>
      {groups
        .filter(([, list]) => list.length)
        .map(([title, list]) => (
          <div key={title}>
            <h3>{title}</h3>
            <ul className="lab-list">
              {list.map((s) => {
                const r = readings[s.id];
                const lit = s.holdable ? !!r?.held : !!flashing[s.id];
                return (
                  <li key={s.id} data-testid={`meter-${s.id}`} data-kind={s.kind} data-state={r ? 'live' : 'no-data'} data-value={r?.value ?? ''} data-on={s.kind === 'moment' ? String(lit) : undefined}>
                    <code>{s.id}</code> <span className="lab-hint">{s.description}</span>
                    <div className="lab-reading">
                      {s.kind === 'slider' ? <meter min={0} max={1} value={r?.value ?? 0} aria-label={s.id} /> : <span className="lab-lamp" data-on={String(lit)} aria-hidden="true" />}
                      <span>
                        {!r
                          ? 'no data yet'
                          : s.kind === 'slider'
                            ? `${(r.value ?? 0).toFixed(2)}${r.confidence === undefined ? '' : ` (sure ${Math.round(r.confidence * 100)}%)`}`
                            : r.held
                              ? 'on'
                              : `happened ${r.count} time${r.count === 1 ? '' : 's'}`}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
    </section>
  );
}

// ---- controls ---------------------------------------------------------------------------------------------------
function ControlsPanel() {
  const controls = useTopic('controls', {} as ControlState);
  const [flashing, flash] = useFlashes(500);
  const [log, setLog] = useState<CommandEvent[]>([]);

  useEffect(
    () =>
      bus.on('command', (c) => {
        flash(c.command);
        setLog((old) => [c, ...old].slice(0, 6));
      }),
    [flash],
  );

  return (
    <section aria-labelledby="lab-controls-heading">
      <h2 id="lab-controls-heading">Controls</h2>
      <p>Everything a command can change, with its value right now. A control flashes when a command for it arrives.</p>
      <ul className="lab-list">
        {controlCatalog.controls.map((c) => (
          <li key={c.id} data-testid={`control-${c.id}`} data-flash={String(!!flashing[c.id])}>
            <code>{c.id}</code> <span className="lab-hint">{c.description}</span>
            <div>
              Now: <strong>{formatValue(controls[c.id], c)}</strong>
            </div>
          </li>
        ))}
      </ul>
      <h3>Latest commands</h3>
      <ol data-testid="lab-log" className="lab-log">
        {log.length === 0 ? <li>none yet</li> : null}
        {log.map((c, i) => (
          <li key={`${c.t_ms}-${i}`}>
            {c.command} {c.how ?? ''} {c.value === undefined ? '' : JSON.stringify(c.value)} (from {c.source}
            {c.mapping ? `, rule "${c.mapping}"` : ''})
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---- rules and problems -----------------------------------------------------------------------------------------
function RulesPanel() {
  const [rules, setRules] = useState<Rule[]>(() => loadMappings(getMappingsText()).rules);
  const [lit, flash] = useFlashes(600);
  const mode = useTopic('mode', 'play' as Mode);

  useEffect(
    () =>
      onMappingsText((text) => {
        const result = loadMappings(text);
        if (!result.fatal) setRules(result.rules); // a file that cannot be read keeps the last good rules, like the engine does
      }),
    [],
  );
  useEffect(() => bus.on('fired', (f) => flash(f.mapping)), [flash]);

  return (
    <section aria-labelledby="lab-rules-heading">
      <h2 id="lab-rules-heading">Rules</h2>
      <p>
        Loaded from mappings.yaml (changes apply as soon as you save). Current mode: <strong>{mode}</strong>. A rule's card lights up when it fires.
      </p>
      {rules.length === 0 ? <p>No rules loaded.</p> : null}
      <ul className="lab-rule-grid" aria-label="Loaded rules">
        {rules.map((r) => (
          <li
            key={r.index}
            className="lab-rule-card"
            data-testid={`rule-${r.index}`}
            data-enabled={String(r.enabled)}
            data-fired={String(!!lit[r.label])}
            data-section={r.mode}
          >
            <div className="lab-rule-top">
              <span className="lab-lamp" data-on={String(!!lit[r.label])} aria-hidden="true" />
              <span className="lab-rule-number">Rule {r.index + 1}</span>
              <span className="lab-rule-tag" data-section={r.mode}>
                {sectionName(r.mode)}
              </span>
            </div>
            <strong className="lab-rule-name">{r.label}</strong>
            {r.enabled ? null : <span className="lab-rule-off">Switched off</span>}
            <dl className="lab-rule-facts">
              <div>
                <dt>When</dt>
                <dd>
                  <code>{r.when}</code>
                  {r.onlyWhile ? (
                    <>
                      {' '}
                      while <code>{r.onlyWhile}</code>
                    </>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>Does</dt>
                <dd>
                  {r.how} <code>{r.do}</code>
                  {actionDetail(r)}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The section a rule works in, as the tag on its card shows it. */
function sectionName(mode: Rule['mode']): string {
  return mode === 'any' ? 'Any' : mode.charAt(0).toUpperCase() + mode.slice(1);
}

/** The value part of a rule's action: the range it follows, the step it nudges by, or the value it sets. */
function actionDetail(r: Rule): string {
  if (r.how === 'follow' && r.range) return ` from ${r.range[0]} to ${r.range[1]}`;
  if (r.how === 'nudge' && r.step !== undefined) return ` by ${r.step > 0 ? '+' : ''}${r.step}`;
  if (r.value !== undefined) return ` to ${String(r.value)}`;
  return '';
}

function IssuesPanel() {
  const issues = useTopic('issues', [] as EngineIssue[]);
  return (
    <section aria-labelledby="lab-issues-heading">
      <h2 id="lab-issues-heading">Problems in mappings.yaml</h2>
      <div data-testid="lab-issues">
        {issues.length === 0 ? (
          <p>Everything looks fine.</p>
        ) : (
          <ul className="lab-list">
            {issues.map((issue, i) => (
              <li key={i} data-level={issue.level}>
                <strong>{issue.level === 'error' ? 'Problem' : 'Heads up'}</strong> in {issue.where}: {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ---- test without a camera --------------------------------------------------------------------------------------
function TestPanel() {
  const [held, setHeld] = useState<Record<string, boolean>>({});
  const [sliders, setSliders] = useState<Record<string, number>>({});
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const all = timers.current;
    return () => all.forEach(clearTimeout);
  }, []);

  const pressMoment = (s: SignalInfo) => {
    if (s.holdable) {
      // holdable: the button works like a switch (hold, then release)
      const next = !held[s.id];
      setHeld((h) => ({ ...h, [s.id]: next }));
      sendSignal({ id: s.id, kind: 'moment', state: next ? 'start' : 'end', confidence: 1 });
      return;
    }
    sendSignal({ id: s.id, kind: 'moment', state: 'start', confidence: 1 });
    const t = setTimeout(() => {
      timers.current.delete(t);
      sendSignal({ id: s.id, kind: 'moment', state: 'end', confidence: 1 });
    }, 300);
    timers.current.add(t);
  };

  const moments = signalCatalog.signals.filter((s) => s.kind === 'moment');
  const sliderSignals = signalCatalog.signals.filter((s) => s.kind === 'slider');
  return (
    <section aria-labelledby="lab-test-heading">
      <h2 id="lab-test-heading">Test without a camera</h2>
      <p>Send fake signals to try your mappings with no camera or microphone. Buttons send a moment; sliders send a reading as you drag.</p>
      <h3>Moments</h3>
      <ul className="lab-list">
        {moments.map((s) => (
          <li key={s.id}>
            <button type="button" data-testid={`fake-${s.id}`} aria-pressed={s.holdable ? !!held[s.id] : undefined} title={s.description} onClick={() => pressMoment(s)}>
              {s.holdable ? (held[s.id] ? `Release ${s.id}` : `Hold ${s.id}`) : `Send ${s.id}`}
            </button>
          </li>
        ))}
      </ul>
      <h3>Sliders</h3>
      <ul className="lab-list">
        {sliderSignals.map((s) => (
          <li key={s.id}>
            <label>
              <code>{s.id}</code>{' '}
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                defaultValue={0.5}
                data-testid={`fake-${s.id}`}
                title={s.description}
                onChange={(e) => {
                  const value = Number(e.currentTarget.value);
                  setSliders((v) => ({ ...v, [s.id]: value }));
                  sendSignal({ id: s.id, kind: 'slider', value, confidence: 1 });
                }}
              />{' '}
              <output>{sliders[s.id] === undefined ? '' : sliders[s.id].toFixed(2)}</output>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CommandLab() {
  return (
    <div data-testid="command-lab" className="command-lab">
      <h1>Command Lab</h1>
      <p>See what the app senses, what each command changes, and which rule fires. No camera? Use "Test without a camera" at the bottom.</p>
      <CameraPanel />
      <IssuesPanel />
      <RulesPanel />
      <SignalMeters />
      <ControlsPanel />
      <TestPanel />
    </div>
  );
}
