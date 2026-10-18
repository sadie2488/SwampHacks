// The "audio-live" module: the microphone. It turns on only after a bus "enable" event for 'audio-live' (the user clicked
// a button), then publishes pitch frames, performance events (notes and onsets) and the audio.* signals
// (loudness, hum pitch, onset, snap, clap, spoken keywords). In fake mode it plays made-up data instead of using a mic.
// It also does practice mode (see ./practice): the shell sends practiceControl (calibrate | start | stop) and gets back
// practice (what is going on, in plain words) and feedback (rule-based coaching comparing the player with the song).
import { bus, getAudioContext, isFakeMode, reportStatus, sendSignal, type Stop } from '@/bus';
import { Analyzer } from './analyzer';
import { startCapture, type Capture } from './capture';
import { CONFIG } from './config';
import { fakeHum, twinkleMelody } from './fake';
import { KEYWORD_STATUS, KeywordGate } from './keywords';
import { MicPipeline } from './pipeline';
import { busSink } from './sink';
import { createSpeechListener, type SpeechListener } from './speech';
import { setFakeScript, startPracticeController } from './practice';

export { fakeHum, twinkleMelody } from './fake';
export type { FakeHumOptions, HumNote } from './fake';
export { CONFIG } from './config';
// Practice mode (compare the player with the song). The scripted-performance helpers let tests play a made-up player.
export { buildFeedback, compareNotes, computeCalibration, feedScriptedPerformance, melodyOf, scriptPlayed, setFakeScript as setFakePractice } from './practice';
export type { ScriptOptions } from './practice';

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
  let createMode = bus.last('mode') === 'create';
  let createVoiceEnabled = bus.last('controls')?.['create.instrument.voice'] === true;
  // The page-clock time that time 0 of the microphone's notes and onsets refers to. Practice mode needs it to line them up with the song.
  let micOriginMs = 0;

  const fireKeywords = (words: string[]) => {
    for (const w of words) sendSignal({ id: `audio.keyword.${w}`, kind: 'moment', state: 'start' });
  };

  const listeningStatus = () =>
    reportStatus(MODULE, 'running', createMode ? 'Listening for Create commands; enable Instrument Voice for instrument names' : KEYWORD_STATUS.armed);

  // Play voice commands use the fist; Create needs Start/Next available during its workflow.
  const syncKeywords = () => {
    if (!session || session.fake || !speech) return;
    if (gate.armed || createMode) {
      speech.start();
      listeningStatus();
    } else {
      speech.stop();
      reportStatus(MODULE, 'running', KEYWORD_STATUS.disarmed);
    }
  };

  const setUpKeywords = () => {
    if (!speechChecked) {
      speech = createSpeechListener({
        onText: (texts, first, finals) => fireKeywords(gate.accept(texts, first, createMode, finals)),
        onNewSession: () => gate.newSession(),
        onProblem: (message) => reportStatus(MODULE, 'running', message),
        onRecovered: () => {
          if (session && !session.fake && (gate.armed || createMode)) listeningStatus();
        },
      });
      speechChecked = true;
    }
    if (!speech) reportStatus(MODULE, 'running', KEYWORD_STATUS.unsupported); // said once, then carry on
    else syncKeywords();
  };

  sayToActive = (text) => {
    const words = gate.accept([text], fakeResult++, createMode);
    fireKeywords(words);
    return words;
  };

  const offSignal = bus.on('signal', (s) => {
    if (s.id !== CONFIG.keywords.armSignal) return;
    const changed = s.state === 'start' ? gate.arm() : s.state === 'end' ? gate.disarm() : false;
    if (changed) syncKeywords();
  });
  const offControls = bus.on('controls', (controls) => {
    const enabled = controls['create.instrument.voice'] === true;
    if (enabled === createVoiceEnabled) return;
    createVoiceEnabled = enabled;
    syncKeywords();
  }, { replay: true });
  const offMode = bus.on('mode', (mode) => {
    createMode = mode === 'create';
    syncKeywords();
  }, { replay: true });

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
      micOriginMs = performance.now();
      session = { fake: true, stop: fakeHum(twinkleMelody(), { loop: true, originMs: micOriginMs }) };
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
    micOriginMs = performance.now();
    const analyzer = new Analyzer(busSink, micOriginMs);
    const pipeline = new MicPipeline(ctx.sampleRate, analyzer);
    // stricter snap and clap detection while the song plays (it comes back through the speakers)
    const offTransport = bus.on('transport', (t) => pipeline.setSongPlaying(t.playing), { replay: true });
    let capture: Capture;
    try {
      capture = await startCapture(ctx, stream, (chunk, lost) => pipeline.push(chunk, lost));
    } catch (e) {
      offTransport();
      release();
      if (cancelled()) return;
      wantOn = false;
      reportStatus(MODULE, 'error', micErrorMessage(e));
      return;
    }
    if (cancelled()) {
      offTransport();
      capture.stop();
      return release();
    }
    session = {
      fake: false,
      stop: () => {
        offTransport();
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

  // practice mode: listens for practiceControl, and only uses the microphone when it is already on
  const practice = startPracticeController({ isOn: () => session !== null, originMs: () => micOriginMs }, bus);
  if (isFakeMode() && typeof window !== 'undefined') {
    // lets the lead's browser tests change the made-up player, e.g. __music.fakePractice({ pace: 0.9 })
    const hook = (window as unknown as { __music?: Record<string, unknown> }).__music;
    if (hook) hook.fakePractice = setFakeScript;
  }

  return () => {
    offEnable();
    offSignal();
    offControls();
    offMode();
    practice.stop();
    sayToActive = null;
    if (wantOn || session) {
      wantOn = false;
      teardown();
      reportStatus(MODULE, 'idle', 'Microphone is off');
    }
  };
}
