// A thin wrapper over the browser's speech recognition (Chrome only: webkitSpeechRecognition).
// It only starts when asked and keeps itself running (Chrome ends a session after a pause) until told to stop.
interface ResultLike {
  readonly length: number;
  readonly isFinal?: boolean;
  readonly [i: number]: { readonly transcript: string };
}
interface ResultEventLike {
  readonly resultIndex: number;
  readonly results: ArrayLike<ResultLike>;
}
interface RecognizerLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((e: ResultEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type RecognizerCtor = new () => RecognizerLike;

const findCtor = (): RecognizerCtor | undefined => {
  const g = globalThis as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition;
};

export const speechSupported = (): boolean => findCtor() !== undefined;

export interface SpeechListener {
  /** Begin listening (safe to call again). */
  start(): void;
  /** Stop listening and throw away anything not yet reported. */
  stop(): void;
}

export interface SpeechHandlers {
  /** The text of speech results `firstIndex`, `firstIndex + 1`, ... (interim results repeat and grow); `finals[k]` is true once result k is finished. */
  onText(texts: string[], firstIndex: number, finals: boolean[]): void;
  /** A new recognition run began (its results are numbered from 0 again). */
  onNewSession(): void;
  /** Something stopped voice commands from working, in plain words. */
  onProblem(message: string): void;
  /** Speech came through again after a network problem. */
  onRecovered?(): void;
}

// Sat-night fix: a network error used to switch voice commands off until the next fist or mode change (venue Wi-Fi drops
// would silently end Create voice commands). Now it keeps trying, waiting longer each time, while listening is wanted.
export const NETWORK_RETRY_MS = [2000, 5000, 10000, 15000] as const;

export function createSpeechListener(h: SpeechHandlers): SpeechListener | null {
  const Ctor = findCtor();
  if (!Ctor) return null;
  let rec: RecognizerLike | null = null;
  let wanted = false;
  let restart: ReturnType<typeof setTimeout> | undefined;
  let networkFails = 0;
  let waitingForNetwork = false;

  const scheduleStart = (ms: number) => {
    clearTimeout(restart);
    restart = setTimeout(() => {
      waitingForNetwork = false;
      if (wanted) tryStart();
    }, ms);
  };

  const give = (message: string) => {
    wanted = false;
    h.onProblem(message);
  };

  const ensure = (): RecognizerLike => {
    if (rec) return rec;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    r.onstart = () => h.onNewSession();
    r.onresult = (e) => {
      if (networkFails > 0) {
        networkFails = 0;
        h.onRecovered?.();
      }
      const texts: string[] = [];
      const finals: boolean[] = [];
      for (let i = e.resultIndex; i < e.results.length; i++) {
        texts.push(e.results[i][0].transcript);
        finals.push(e.results[i].isFinal !== false);
      }
      h.onText(texts, e.resultIndex, finals);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') give('Voice commands were blocked: allow the microphone for speech in the address bar, then hold your fist again');
      else if (e.error === 'audio-capture') give('Voice commands could not hear the microphone');
      else if (e.error === 'network' && wanted) {
        h.onProblem('Voice commands need an internet connection (Chrome sends speech to Google to read it)');
        waitingForNetwork = true;
        scheduleStart(NETWORK_RETRY_MS[Math.min(networkFails++, NETWORK_RETRY_MS.length - 1)]);
      }
      // "no-speech" and "aborted" are normal: the end handler below starts again if we still want to listen
    };
    r.onend = () => {
      if (!wanted || waitingForNetwork) return; // a network retry is already booked
      scheduleStart(250);
    };
    return (rec = r);
  };

  const tryStart = () => {
    try {
      ensure().start();
    } catch {
      // already started: nothing to do
    }
  };

  return {
    start() {
      wanted = true;
      if (!waitingForNetwork) tryStart(); // never start early while a network retry is waiting
    },
    stop() {
      wanted = false;
      waitingForNetwork = false;
      networkFails = 0;
      clearTimeout(restart);
      try {
        rec?.abort();
      } catch {
        // already stopped
      }
    },
  };
}
