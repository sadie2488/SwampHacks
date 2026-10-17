// A thin wrapper over the browser's speech recognition (Chrome only: webkitSpeechRecognition).
// It only starts when asked and keeps itself running (Chrome ends a session after a pause) until told to stop.
interface ResultLike {
  readonly length: number;
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
  /** The text of speech results `firstIndex`, `firstIndex + 1`, ... (interim results repeat and grow). */
  onText(texts: string[], firstIndex: number): void;
  /** A new recognition run began (its results are numbered from 0 again). */
  onNewSession(): void;
  /** Something stopped voice commands from working, in plain words. */
  onProblem(message: string): void;
}

export function createSpeechListener(h: SpeechHandlers): SpeechListener | null {
  const Ctor = findCtor();
  if (!Ctor) return null;
  let rec: RecognizerLike | null = null;
  let wanted = false;
  let restart: ReturnType<typeof setTimeout> | undefined;

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
      const texts: string[] = [];
      for (let i = e.resultIndex; i < e.results.length; i++) texts.push(e.results[i][0].transcript);
      h.onText(texts, e.resultIndex);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') give('Voice commands were blocked: allow the microphone for speech in the address bar, then hold your fist again');
      else if (e.error === 'audio-capture') give('Voice commands could not hear the microphone');
      else if (e.error === 'network') give('Voice commands need an internet connection (Chrome sends speech to Google to read it)');
      // "no-speech" and "aborted" are normal: the end handler below starts again if we still want to listen
    };
    r.onend = () => {
      if (!wanted) return;
      clearTimeout(restart);
      restart = setTimeout(() => {
        if (wanted) tryStart();
      }, 250);
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
      tryStart();
    },
    stop() {
      wanted = false;
      clearTimeout(restart);
      try {
        rec?.abort();
      } catch {
        // already stopped
      }
    },
  };
}
