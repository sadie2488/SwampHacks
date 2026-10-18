// The "commands" module: connects the mapping engine (engine.ts) to the bus.
//   listens:   signal (a reading from camera/mic/buttons), mode (play | create | learn), controls (current values),
//              practice (while a practice run listens, follow rules leave tempo and pitch alone: Sat-night fix)
//   publishes: command (what the rules decided), fired (so the Command Lab lights the rule up),
//              issues (friendly errors and warnings about mappings.yaml; sent again whenever they change)
// It never opens a camera or mic. Rules come from mappings/mappings.yaml and reload live when you save the file.
import { bus, type EngineIssue, type Stop } from '@/bus';
import { getMappingsText, onMappingsText } from '../mappings';
import { createEngine } from './engine';

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

  const stops: Stop[] = [
    onMappingsText((text) => loadRules(text)),
    bus.on('mode', (mode) => engine.setMode(mode), { replay: true }),
    bus.on('practice', (p) => engine.setPracticeRun(p.state === 'listening'), { replay: true }),
    bus.on('signal', (signal) => {
      for (const { command, fire } of engine.handleSignal(signal)) {
        bus.emit('command', command);
        if (fire) bus.emit('fired', { mapping: command.mapping ?? '', command });
      }
    }),
  ];
  return () => stops.forEach((stop) => stop());
}
