// The "touchdesigner" module. After an `enable` event it streams about 30 frames a second (see contracts/td-message) to a small
// relay on this laptop (node bridge/relay.mjs), which hands them to TouchDesigner as OSC. Each frame is also published on the
// bus "td" topic, even when no relay is running, so the rest of the app can be tested without TouchDesigner.
import { bus, reportStatus, type Stop } from '@/bus';
import { createSender, resolveRelayUrl, type SenderDeps } from './sender';
import { createTracker } from './frame';

export { buildFrame } from './frame';

/** Same as start(), but with the outside world (WebSocket, clock, timers) passed in. Tests use this. */
export function startWith(deps: Pick<SenderDeps, 'url' | 'notice' | 'createSocket' | 'now' | 'setInterval' | 'clearInterval' | 'setTimeout' | 'clearTimeout'>): Stop {
  const tracker = createTracker(deps.now);
  const sender = createSender({
    ...deps,
    makeFrame: tracker.frame,
    publish: (frame) => bus.emit('td', frame),
    report: (state, message) => reportStatus('touchdesigner', state, message),
  });

  const stops = [
    bus.on('mode', (m) => tracker.setMode(m), { replay: true }),
    bus.on('controls', (c) => tracker.setControls(c), { replay: true }),
    bus.on('transport', (t) => tracker.onTransport({ bpm: t.bpm, beatPhase: t.beatPhase }), { replay: true }),
    bus.on('songLevels', (l) => tracker.onSongLevels(l), { replay: true }),
    bus.on('pitch', (p) => tracker.onPitch({ midi: p.midi, rms: p.rms })),
    bus.on('signal', (s) => tracker.onSignal(s)),
    bus.on('enable', (e) => {
      if (e.module !== 'touchdesigner') return;
      if (e.on) sender.enable();
      else sender.disable();
    }),
  ];
  reportStatus('touchdesigner', 'idle', deps.notice ? `TouchDesigner is off. ${deps.notice}` : 'TouchDesigner is off.');

  return () => {
    for (const stop of stops) stop();
    sender.disable();
  };
}

export function start(): Stop {
  const { url, notice } = resolveRelayUrl(typeof location !== 'undefined' ? location.search : '');
  return startWith({
    url,
    notice,
    createSocket: (url) => new WebSocket(url),
    now: () => performance.now(),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  });
}
