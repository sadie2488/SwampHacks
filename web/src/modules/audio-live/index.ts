// The "audio-live" module: the microphone. It turns on only after a bus "enable" event for 'audio-live' (the user clicked
// a button), then publishes pitch frames, performance events (notes and onsets) and the audio.* signals
// (loudness, hum pitch, onset, snap, clap, spoken keywords). In fake mode it plays made-up data instead of using a mic.
import { bus, getAudioContext, isFakeMode, reportStatus, sendSignal, type Stop } from '@/bus';
import { Analyzer } from './analyzer';
import { startCapture, type Capture } from './capture';
import { CONFIG } from './config';
import { fakeHum, twinkleMelody } from './fake';
import { KEYWORD_STATUS, KeywordGate } from './keywords';
import { MicPipeline } from './pipeline';
import { busSink } from './sink';
import { createSpeechListener, type SpeechListener } from './speech';

export { fakeHum, twinkleMelody } from './fake';
export type { FakeHumOptions, HumNote } from './fake';
export { CONFIG } from './config';

const MODULE = 'audio-live';

/** What went wrong with the microphone, in plain words. */
export function micErrorMessage(e: unknown): string {
  const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone permission was blocked: click the lock icon in the address bar and allow it';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found: plug one in or check your computer\'s sound settings';
    case 'NotReadableError':
    case 'AbortError':
      return 'The microphone is busy or not responding: close other apps that use it, then try again';
    default:
      return `The microphone could not start${name ? ` (${name})` : ''}: check that it is plugged in and allowed, then try again`;
  }
}

interface Session {
  stop(): void;
  /** True for made-up data: no real microphone and no keyword status messages. */
  fake: boolean;
}

// Lets tests pretend the speech recogniser heard something (see fakeSay).
let sayToActive: ((text: string) => string[]) | null = null;

/** Pretend the speech recogniser heard this text. It only counts while voice commands are armed, like the real thing. Returns the keywords that fired. */
export function fakeSay(text: string): string[] {
  return sayToActive ? sayToActive(text) : [];
}

export function start(): Stop {
  const gate = new KeywordGate(() => performance.now());
  let session: Session | null = null;
  let wantOn = false;
  let token = 0;
  let speech: SpeechListener | null = null;
  let speechChecked = false;
  let fakeResult = 0;

  const fireKeywords = (words: string[]) => {
    for (const w of words) sendSignal({ id: `audio.keyword.${w}`, kind: 'moment', state: 'start' });
  };

  // ---- keywords: only listen while the arming gesture is held ----
  const syncKeywords = () => {
    if (!session || session.fake || !speech) return;
    if (gate.armed) {
      speech.start();
      reportStatus(MODULE, 'running', KEYWORD_STATUS.armed);
    } else {
      speech.stop();
      reportStatus(MODULE, 'running', KEYWORD_STATUS.disarmed);
    }
  };

  const setUpKeywords = () => {
    if (!speechChecked) {
      speech = createSpeechListener({
        onText: (texts, first) => fireKeywords(gate.accept(texts, first)),
        onNewSession: () => gate.newSession(),
        onProblem: (message) => reportStatus(MODULE, 'running', message),
      });
      speechChecked = true;
    }
    if (!speech) reportStatus(MODULE, 'running', KEYWORD_STATUS.unsupported); // said once, then carry on
    else syncKeywords();
  };

  sayToActive = (text) => {
    const words = gate.accept([text], fakeResult++);
    fireKeywords(words);
    return words;
  };

  const offSignal = bus.on('signal', (s) => {
    if (s.id !== CONFIG.keywords.armSignal) return;
    const changed = s.state === 'start' ? gate.arm() : s.state === 'end' ? gate.disarm() : false;
    if (changed) syncKeywords();
  });

  // ---- turning the microphone on and off ----
  const teardown = () => {
    token++;
    speech?.stop();
    const s = session;
    session = null;
    s?.stop();
  };

  const begin = async () => {
    const mine = ++token;
    const cancelled = () => mine !== token;
    reportStatus(MODULE, 'starting', isFakeMode() ? 'Starting made-up microphone data...' : 'Starting the microphone...');

    if (isFakeMode()) {
      session = { fake: true, stop: fakeHum(twinkleMelody(), { loop: true }) };
      reportStatus(MODULE, 'running', 'Using made-up microphone data (fake mode)');
      return;
    }

    const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!devices?.getUserMedia) {
      wantOn = false;
      reportStatus(MODULE, 'error', 'This page cannot use the microphone: open it in Chrome at http://localhost or an https:// address');
      return;
    }
    let stream: MediaStream;
    try {
      // Echo cancelling, noise removal and auto-volume all smear the pitch, so they are switched off.
      stream = await devices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      if (cancelled()) return;
      wantOn = false;
      reportStatus(MODULE, 'error', micErrorMessage(e));
      return;
    }
    const release = () => stream.getTracks().forEach((t) => t.stop());
    if (cancelled()) return release();

    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {}); // the shell normally did this on the click already
    const analyzer = new Analyzer(busSink, performance.now());
    const pipeline = new MicPipeline(ctx.sampleRate, analyzer);
    let capture: Capture;
    try {
      capture = await startCapture(ctx, stream, (chunk, lost) => pipeline.push(chunk, lost));
    } catch (e) {
      release();
      if (cancelled()) return;
      wantOn = false;
      reportStatus(MODULE, 'error', micErrorMessage(e));
      return;
    }
    if (cancelled()) {
      capture.stop();
      return release();
    }
    session = {
      fake: false,
      stop: () => {
        capture.stop();
        release();
        analyzer.flush();
      },
    };
    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (cancelled()) return;
        wantOn = false;
        teardown();
        reportStatus(MODULE, 'error', 'The microphone stopped (was it unplugged?): click the microphone button to start it again');
      };
    });
    reportStatus(MODULE, 'running', 'Microphone is on');
    setUpKeywords();
  };

  const offEnable = bus.on('enable', ({ module, on }) => {
    if (module !== MODULE) return;
    if (on) {
      if (wantOn) return;
      wantOn = true;
      void begin();
    } else {
      wantOn = false;
      teardown();
      reportStatus(MODULE, 'idle', 'Microphone is off');
    }
  });

  return () => {
    offEnable();
    offSignal();
    sayToActive = null;
    if (wantOn || session) {
      wantOn = false;
      teardown();
      reportStatus(MODULE, 'idle', 'Microphone is off');
    }
  };
}
