// The "commands" module: connects the mapping engine (engine.ts) to the bus.
//   listens:   signal (a reading from camera/mic/buttons), mode (play | create | learn), controls (current values),
//              practice (while a practice run listens, follow rules leave tempo and pitch alone: Sat-night fix)
//   publishes: command (what the rules decided), fired (so the Command Lab lights the rule up),
//              issues (friendly errors and warnings about mappings.yaml; sent again whenever they change),
//              holdProgress (a "hold_ms" rule filling up while its gesture is held; progress 0 when let go or fired)
// It never opens a camera or mic. Rules come from mappings/mappings.yaml and reload live when you save the file.
import { bus, type EngineIssue, type Stop } from '@/bus';
import { getMappingsText, onMappingsText } from '../mappings';
import { createEngine, type Emission, type HoldProgress } from './engine';

export type { HoldProgress } from './engine';

// Adds the holdProgress topic to the shared bus (TypeScript merges this into the Topics list in @/bus).
declare module '@/bus' {
  interface Topics {
    holdProgress: HoldProgress;
  }
}

const TICK_MS = 50; // how often a held rule checks its time and updates the ring
const NO_HANDS_MS = 300; // the camera saw no hands this long: every held camera gesture is let go

export function start(): Stop {
  const engine = createEngine({ current: (control) => bus.last('controls')?.[control] });
  let lastIssues = '';

  const loadRules = (text: string, force = false) => {
    const issues: EngineIssue[] = [...engine.load(text)];
    const key = JSON.stringify(issues);
    if (force || key !== lastIssues) {
      lastIssues = key;
      bus.emit('issues', issues);
    }
  };
  loadRules(getMappingsText(), true);

  const send = (emissions: Emission[]) => {
    for (const { command, fire } of emissions) {
      bus.emit('command', command);
      if (fire) bus.emit('fired', { mapping: command.mapping ?? '', command });
    }
  };

  // Holds: a timer runs only while some hold_ms rule is filling up.
  let timer: ReturnType<typeof setInterval> | undefined;
  let shown: HoldProgress | undefined;
  let noHandsSince: number | undefined;
  const updateHolds = () => {
    if (noHandsSince !== undefined && performance.now() - noHandsSince > NO_HANDS_MS) engine.release('vision.');
    send(engine.tick());
    const best = engine.holds().sort((a, b) => b.progress - a.progress)[0];
    if (best) bus.emit('holdProgress', (shown = best));
    else if (shown) {
      bus.emit('holdProgress', { ...shown, progress: 0 });
      shown = undefined;
    }
    if (best && !timer) timer = setInterval(updateHolds, TICK_MS);
    if (!best && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const stops: Stop[] = [
    onMappingsText((text) => loadRules(text)),
    bus.on('mode', (mode) => engine.setMode(mode), { replay: true }),
    bus.on('practice', (p) => engine.setPracticeRun(p.state === 'listening'), { replay: true }),
    bus.on('signal', (signal) => {
      send(engine.handleSignal(signal));
      updateHolds();
    }),
    // camera off: nothing stays held
    bus.on('status', (s) => {
      if (s.module !== 'vision' || s.state === 'running' || s.state === 'starting') return;
      engine.release('vision.');
      updateHolds();
    }),
    bus.on('landmarks', (l) => {
      if (l.hands.length) noHandsSince = undefined;
      else noHandsSince ??= performance.now();
    }),
  ];
  return () => {
    stops.forEach((stop) => stop());
    if (timer) clearInterval(timer);
    timer = undefined;
  };
}
