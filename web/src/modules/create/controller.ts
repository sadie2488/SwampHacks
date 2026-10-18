// Connects Create mode to the bus: commands and controls change the layers, pitch frames are collected while
// recording, and the sound engine is told what to do. All sound goes through the LoopEngine interface.
import { bus, reportStatus, sendCommand, type PitchFrame, type Stop } from '@/bus';
import { controlInfo } from '@/contracts/catalogs';
import type { CommandEvent } from '@/contracts';
import type { LoopEngine } from './engine';
import { fitTakeToKey } from './key';
import { currentLayer, describeState, hasAnyNotes, hasBeat, isRecording, type CreateState } from './layers';
import { countNumber } from './metronome';
import { isEffect, isInstrument, loopBeats as defaultLoopBeats } from './music';
import { segmentNotes } from './segment-notes';
import { applyAnalysis, createSettings, type SettingsStore } from './settings';
import type { CreateStore } from './store';

export interface ControllerOptions {
  engine: LoopEngine;
  store: CreateStore;
  /** Snap-to-key choice and the line about the last take. The screen reads the same object. Default: a private one. */
  settings?: SettingsStore;
  /** The page clock in milliseconds. Tests pass a fake one. */
  now?: () => number;
  /** How late (ms) a hummed note reaches us after it is sung; the take is shifted earlier by this much. */
  inputLatencyMs?: number;
  /** How long to keep listening after the loop's last beat is heard before cutting the take. */
  tailMs?: number;
}

const MODULE = 'create';

export function startController(opts: ControllerOptions): Stop {
  const { engine, store } = opts;
  const settings = opts.settings ?? createSettings();
  const now = opts.now ?? (() => performance.now());
  const inputLatencyMs = opts.inputLatencyMs ?? 30;
  const tailMs = opts.tailMs ?? 60;

  let heard: Array<{ at: number; frame: PitchFrame }> = [];
  let framesSeen = 0;
  let takeStartMs = 0;
  /** Loop-clock bar the running take started on (from the engine), so the layer plays back in the same place. */
  let takeStartBar: number | undefined;
  let takeId = 0;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  /** Waiting count-in numbers: each shows when its click is heard. */
  let countTimers: Array<ReturnType<typeof setTimeout>> = [];
  let lastStatus = '';
  /** Set when the sound engine failed; shown as an error until the next command. */
  let problem = '';

  const state = () => store.getState();
  const inCreate = () => bus.last('mode') === 'create';

  // ---- status for the shell, in plain words ----
  function publishStatus(s: CreateState) {
    const text = problem || [describeState(s), s.message].filter(Boolean).join('. ');
    if (text === lastStatus) return;
    lastStatus = text;
    const kind = problem ? 'error' : s.phase === 'idle' ? 'idle' : s.phase === 'countIn' ? 'starting' : 'running';
    reportStatus(MODULE, kind, text);
  }

  // ---- keep the engine's layers in step with the state ----
  const syncEngine = (s: CreateState) => {
    try {
      engine.syncLayers(s.layers, s.bpm, s.bars);
    } catch (e) {
      fail(e);
    }
  };
  const stopStore = store.subscribe((s) => {
    syncEngine(s);
    publishStatus(s);
  });

  function fail(e: unknown) {
    console.error('[create] sound problem', e);
    problem = 'Something went wrong with the sound. Click the page and try again.';
    publishStatus(state());
  }
  /** Run an engine call; false when it threw. */
  function safe(fn: () => void): boolean {
    try {
      fn();
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }

  // ---- recording ----
  // A take runs for exactly one pass of the loop length, with a 4-count first and a metronome through it, while
  // the other layers play along. When it ends by itself the take becomes the layer and everything stops (Play starts
  // the loop again). Ending it early (Stop, Record again, or the fist gestures: record off) throws the take away
  // and stops everything too; the layer keeps what it had.
  const clearFinishTimer = () => {
    if (finishTimer !== undefined) clearTimeout(finishTimer);
    finishTimer = undefined;
    for (const t of countTimers) clearTimeout(t);
    countTimers = [];
  };

  /** Let the record control go back to "off" once a take is over, so pressing Record again starts a new one. */
  function releaseRecordControl() {
    if (bus.last('controls')?.['create.loop.record'] === true) sendCommand('create.loop.record', 'button', { how: 'set', value: false });
  }

  function startRecording() {
    if (isRecording(state())) return;
    clearFinishTimer();
    heard = [];
    framesSeen = 0;
    takeStartBar = undefined;
    settings.set({ take: undefined });
    const id = ++takeId;
    store.dispatch({ type: 'recordStart' });
    const ok = safe(() =>
      engine.startLoop(
        { countIn: true },
        {
          onCountBeat: (beat, atMs) => {
            if (id !== takeId) return;
            const show = () => {
              if (id === takeId) store.dispatch({ type: 'countBeat', value: countNumber(beat) });
            };
            const wait = atMs === undefined ? 0 : Math.max(0, atMs - now());
            if (wait <= 0) show();
            else countTimers.push(setTimeout(show, wait));
          },
          onGo: (atMs, startBar) => {
            if (id !== takeId) return;
            takeStartMs = atMs ?? now();
            takeStartBar = startBar;
            heard = [];
            framesSeen = 0;
            store.dispatch({ type: 'recordGo' });
          },
          onPassEnd: (atMs) => {
            if (id !== takeId) return;
            // the engine hears the end a little before we do; wait for it, so the last notes are not cut
            const wait = atMs === undefined ? 0 : Math.max(0, atMs - now()) + tailMs;
            const passEnd = () => {
              if (id === takeId) finishTake();
            };
            clearFinishTimer();
            if (wait <= 0) passEnd();
            else finishTimer = setTimeout(passEnd, wait);
          },
        },
      ),
    );
    if (!ok) {
      store.dispatch({ type: 'recordCancel' });
      releaseRecordControl();
    }
  }

  /** The take ran its full pass: turn what we heard into notes, keep them in the layer, and stop all sound. */
  function finishTake() {
    clearFinishTimer();
    const s = state();
    if (s.phase !== 'recording') return;
    takeId++;
    const loopBeats = defaultLoopBeats(s.bars);
    const loopSeconds = (loopBeats * 60) / s.bpm;
    const take = heard.map(({ at, frame }) => ({ ...frame, t_ms: at - takeStartMs - inputLatencyMs }));
    const heardNotes = segmentNotes(take, { bpm: s.bpm, quantize: true, lengthSec: loopSeconds });
    const { notes, key, moved } = fitTakeToKey(heardNotes, { snap: settings.getState().snap, songKey: settings.getState().songKey });
    settings.set({ take: { notes: notes.length, key, moved } });
    const layerName = s.layers.find((l) => l.id === s.recordingId)?.name ?? 'Layer';
    const message =
      notes.length > 0
        ? `${layerName} saved: ${notes.length} note${notes.length === 1 ? '' : 's'}`
        : framesSeen === 0
          ? 'No microphone sound came in. Turn the microphone on, or try Simulate humming'
          : 'No hum heard, so the layer is unchanged';
    heard = [];
    store.dispatch({ type: 'recordEnd', notes, loopBeats, startBar: takeStartBar, message });
    // the other layers and the metronome were playing along; everything goes quiet until Play
    safe(() => engine.stopLoop());
    const completed = currentLayer(state());
    if (completed?.notes.length && completed.instrumentVoiceEnabled) {
      sendCommand('create.instrument.voice', 'button', { how: 'set', value: true });
    }
    releaseRecordControl();
  }

  /** The take was ended early (record off, Stop): throw it away, the layer keeps what it had, and all sound stops. */
  function discardTake() {
    if (!isRecording(state())) return;
    takeId++;
    clearFinishTimer();
    heard = [];
    safe(() => engine.stopLoop());
    const message = state().phase === 'recording' ? 'Discarded: recording stopped early, so the layer is unchanged' : '';
    store.dispatch({ type: 'recordCancel', message });
    releaseRecordControl();
  }

  /** Record control turned off during a take or the count-in: the take is dropped. */
  const stopRecording = () => discardTake();

  // ---- playing ----
  function playLoop() {
    if (state().phase !== 'idle' || !hasAnyNotes(state())) return;
    store.dispatch({ type: 'play' });
    if (!safe(() => engine.startLoop({ countIn: false }))) store.dispatch({ type: 'stop' });
  }

  /** Stop the loop and any recording. A take under way is thrown away. */
  function stopAll() {
    discardTake();
    takeId++;
    clearFinishTimer();
    safe(() => engine.stopLoop());
    store.dispatch({ type: 'stop' });
    releaseRecordControl();
  }

  function setBeat(on: boolean) {
    if (on === hasBeat(state())) return;
    const before = state().phase;
    store.dispatch({ type: on ? 'beatOn' : 'beatOff' });
    if (on) playLoop();
    else if (before === 'playing' && state().phase === 'idle') safe(() => engine.stopLoop());
  }

  // ---- bus: commands ----
  function onCommand(cmd: CommandEvent) {
    if (!cmd.command.startsWith('create.') || !inCreate()) return;
    problem = '';
    const v = cmd.value;
    switch (cmd.command) {
      case 'create.layer.add':
        store.dispatch({ type: 'addLayer' });
        break;
      case 'create.loop.record': {
        const want = typeof v === 'boolean' ? v : !isRecording(state());
        if (want) startRecording();
        else stopRecording();
        break;
      }
      case 'create.loop.stop':
        stopAll();
        break;
      case 'create.loop.play':
        // not in the catalog yet; accepted so a button or voice phrase can use it later
        playLoop();
        break;
      case 'create.layer.confirm_pitch': {
        const cur = currentLayer(state());
        if (!isRecording(state()) && cur) store.dispatch({ type: 'confirmPitch', id: cur.id });
        break;
      }
      case 'create.layer.next':
        // "next": a new layer, recorded right away (the finished layers play along)
        if (!isRecording(state()) && hasAnyNotes(state())) {
          store.dispatch({ type: 'advanceLayer' });
          sendCommand('create.instrument.voice', 'button', { how: 'set', value: currentLayer(state())?.instrumentVoiceEnabled ?? false });
          startRecording();
        }
        break;
      case 'create.beat':
        setBeat(typeof v === 'boolean' ? v : !hasBeat(state()));
        break;
      case 'create.instrument':
        // a spoken instrument word only counts for a layer whose "Voice controls" are on (a hum can sound like a word)
        if (cmd.source === 'voice' && !currentLayer(state())?.instrumentVoiceEnabled) break;
        if (!isInstrument(v)) break;
        store.dispatch({ type: 'setInstrument', value: v });
        break;
      case 'create.layer.volume': {
        const cur = currentLayer(state());
        if (!cur) break;
        if (cmd.source === 'gesture' && isRecording(state())) break;
        if (cmd.how === 'nudge') {
          const step = typeof v === 'number' ? v : (controlInfo('create.layer.volume')?.step ?? 0.1);
          store.dispatch({ type: 'setVolume', value: cur.volume + step });
        } else if (typeof v === 'number' && Number.isFinite(v)) {
          store.dispatch({ type: 'setVolume', value: v });
        }
        break;
      }
      case 'create.layer.pitch': {
        const s = state();
        const cur = currentLayer(s);
        // the right hand shapes the selected layer's pitch (on by default once it has notes), except mid-take
        if (!cur || !cur.handPitchEnabled || cur.notes.length === 0 || isRecording(s)) break;
        if (typeof v === 'number' && Number.isFinite(v)) store.dispatch({ type: 'setPitch', id: cur.id, value: v });
        break;
      }
      case 'create.instrument.voice': {
        const cur = currentLayer(state());
        if (cur?.kind === 'hum' && typeof v === 'boolean') {
          store.dispatch({ type: 'setInstrumentVoiceEnabled', id: cur.id, enabled: v });
        }
        break;
      }
      case 'create.effects':
        if (isEffect(v)) store.dispatch({ type: 'setEffects', value: v });
        break;
    }
  }

  // ---- bus: pitch, mode, overall volume ----
  function onPitch(frame: PitchFrame) {
    if (state().phase !== 'recording') return;
    framesSeen++;
    heard.push({ at: now(), frame });
  }

  const stops: Stop[] = [
    bus.on('command', onCommand),
    bus.on('pitch', onPitch),
    bus.on('analysis', (a) => applyAnalysis(settings, a), { replay: true }),
    bus.on('mode', (mode) => {
      if (mode !== 'create' && state().phase !== 'idle') stopAll();
    }),
    bus.on(
      'controls',
      (c) => {
        const volume = c['playback.volume'];
        if (typeof volume === 'number') safe(() => engine.setMasterVolume(volume));
      },
      { replay: true },
    ),
  ];

  // a fresh start: nothing is playing yet
  store.dispatch({ type: 'stop' });
  syncEngine(state());
  publishStatus(state());

  return () => {
    stops.forEach((s) => s());
    stopStore();
    clearFinishTimer();
    takeId++;
    safe(() => engine.stopLoop());
    store.dispatch({ type: 'stop' });
    safe(() => engine.dispose());
  };
}
