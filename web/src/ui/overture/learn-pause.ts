// Learn's pause-by-sign: one toggle that pauses right away (a big pause mark shows) or counts down 3, 2, 1 and then
// plays on from wherever the song is. Pure: the clock and the play/pause actions are handed in, so it is tested
// with fake timers. The Play/Pause buttons go through the same `transport` path, so the mark follows them too.

export const COUNTDOWN_FROM = 3;
export const COUNT_STEP_MS = 1000;

export interface PauseView {
  /** Show the large pause mark (the song was paused and is waiting). */
  mark: boolean;
  /** The number on screen during the countdown (3, 2, 1), or null when none runs. */
  count: number | null;
}

export interface PauseDeps {
  pause(): void;
  play(): void;
  onChange(view: PauseView): void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

export function createLearnPause(deps: PauseDeps) {
  const setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let playing = false;
  let loaded = false;
  let view: PauseView = { mark: false, count: null };
  let timer: unknown = null;

  const show = (next: PauseView) => {
    if (next.mark === view.mark && next.count === view.count) return;
    view = next;
    deps.onChange(view);
  };
  const cancelCountdown = () => {
    if (timer !== null) clearT(timer);
    timer = null;
  };
  const tick = () => {
    timer = null;
    const n = (view.count ?? 1) - 1;
    if (n <= 0) {
      show({ mark: false, count: null });
      deps.play();
      return;
    }
    show({ mark: false, count: n });
    timer = setT(tick, COUNT_STEP_MS);
  };

  return {
    get view() {
      return view;
    },
    /** The latest transport: playing hides the mark (and ends any countdown); a song that stops shows the mark. */
    transport(t: { playing: boolean; loaded: boolean }) {
      const was = playing;
      playing = t.playing;
      loaded = t.loaded;
      if (t.playing) {
        cancelCountdown();
        show({ mark: false, count: null });
      } else if (was && !t.playing) {
        cancelCountdown();
        show({ mark: true, count: null });
      } else if (!t.loaded) {
        cancelCountdown();
        show({ mark: false, count: null });
      }
    },
    /** Two fingers up (or anything else wired to learn.pause). */
    toggle() {
      if (!loaded) return;
      if (playing) {
        deps.pause();
        show({ mark: true, count: null });
        return;
      }
      if (view.count !== null) {
        // a second sign during the countdown calls it off: stay paused
        cancelCountdown();
        show({ mark: true, count: null });
        return;
      }
      show({ mark: false, count: COUNTDOWN_FROM });
      timer = setT(tick, COUNT_STEP_MS);
    },
    dispose() {
      cancelCountdown();
    },
  };
}
