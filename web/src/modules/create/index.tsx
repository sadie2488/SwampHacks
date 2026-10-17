// Create mode (lane D): hum a melody, hear it as an instrument, stack layers into a loop.
// start() listens to the bus and drives the sound; CreatePanel is the screen. Every button sends a command on the bus,
// so gestures and voice use the same path.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { bus, resumeAudio, sendCommand, type Stop } from '@/bus';
import type { Mode } from '@/contracts';
import { startController } from './controller';
import { playFakeHum } from './fake-hum';
import { currentLayer, describeState, hasBeat, initialState, isRecording } from './layers';
import { EFFECT_IDS, INSTRUMENT_IDS, midiToName } from './music';
import { createStore } from './store';
import { createToneEngine } from './tone-engine';

/** The one store of layers for the running app. The screen reads it; the controller changes it. */
const store = createStore(initialState());

export function start(): Stop {
  return startController({ engine: createToneEngine(), store });
}

// ---- small helpers for the screen ----

/** Browsers only start sound after a click: wake the audio, then do the thing. */
const run = (fn: () => void) => {
  void resumeAudio().catch(() => {});
  fn();
};
const press = (fn: () => void) => () => run(fn);

/** The note being hummed right now ("A3"), or a dash when there is none. */
function useHumNote(): string {
  const [note, setNote] = useState('—');
  useEffect(() => {
    let clearTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = bus.on('pitch', (f) => {
      if (f.midi === null || !(f.confidence >= 0.5)) return;
      setNote(midiToName(f.midi));
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => setNote('—'), 400);
    });
    return () => {
      stop();
      clearTimeout(clearTimer);
    };
  }, []);
  return note;
}

function useMode(): Mode | undefined {
  const [mode, setMode] = useState<Mode | undefined>(() => bus.last('mode'));
  useEffect(() => bus.on('mode', setMode, { replay: true }), []);
  return mode;
}

const label = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

export function CreatePanel() {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const humNote = useHumNote();
  const mode = useMode();
  const [faking, setFaking] = useState(false);
  const cancelFake = useRef<() => void>();
  useEffect(() => () => cancelFake.current?.(), []);

  const cur = currentLayer(state);
  const recording = isRecording(state);
  const beatOn = hasBeat(state);
  const instrument = cur?.instrument ?? state.newLayerInstrument;
  const effects = cur?.effects ?? 'none';

  const startFake = () => {
    if (faking) return;
    setFaking(true);
    cancelFake.current = playFakeHum((frame) => bus.emit('pitch', frame), () => setFaking(false));
  };

  return (
    <section data-testid="create-panel" aria-label="Create mode">
      <h2>Create</h2>
      {mode !== 'create' && <p role="note">Create mode is not active yet, so these buttons will not do anything.</p>}

      <p>
        You are humming: <output data-testid="hum-note" aria-live="off">{humNote}</output>
      </p>
      <p data-testid="create-status" role="status">
        {describeState(state)}
        {state.message ? `. ${state.message}` : ''}
      </p>
      <p>
        Loop: {state.bars} bars of 4/4 at {state.bpm} beats per minute
      </p>

      <div role="group" aria-label="Loop controls">
        <button type="button" data-testid="btn-record" aria-pressed={recording} onClick={press(() => sendCommand('create.loop.record', 'button', { how: 'toggle' }))}>
          {recording ? 'Stop recording' : 'Record'}
        </button>{' '}
        <button type="button" data-testid="btn-stop-loop" onClick={press(() => sendCommand('create.loop.stop', 'button', { how: 'trigger' }))}>
          Stop loop
        </button>{' '}
        <button type="button" data-testid="btn-add-layer" onClick={press(() => sendCommand('create.layer.add', 'button', { how: 'trigger' }))}>
          Add layer
        </button>{' '}
        <button type="button" data-testid="btn-beat" aria-pressed={beatOn} onClick={press(() => sendCommand('create.beat', 'button', { how: 'toggle' }))}>
          Beat: {beatOn ? 'on' : 'off'}
        </button>{' '}
        <button type="button" data-testid="btn-fake-hum" disabled={faking} onClick={press(startFake)}>
          {faking ? 'Humming…' : 'Simulate humming'}
        </button>
      </div>

      <p>
        <label>
          Instrument for the current layer{' '}
          <select
            data-testid="select-instrument"
            value={instrument}
            disabled={cur?.kind === 'beat'}
            onChange={(e) => run(() => sendCommand('create.instrument', 'button', { how: 'set', value: e.target.value }))}
          >
            {INSTRUMENT_IDS.map((id) => (
              <option key={id} value={id}>
                {label(id)}
              </option>
            ))}
          </select>
        </label>{' '}
        <label>
          Effect{' '}
          <select
            data-testid="select-effects"
            value={effects}
            onChange={(e) => run(() => sendCommand('create.effects', 'button', { how: 'set', value: e.target.value }))}
          >
            {EFFECT_IDS.map((id) => (
              <option key={id} value={id}>
                {label(id)}
              </option>
            ))}
          </select>
        </label>
      </p>

      <h3>Layers</h3>
      {state.layers.length === 0 ? (
        <p>No layers yet. Press Record, or Add layer, to start.</p>
      ) : (
        <ol>
          {state.layers.map((layer, i) => (
            <li key={layer.id} data-testid={`layer-${i}`} aria-current={layer.id === state.currentId ? 'true' : undefined}>
              <button type="button" data-testid={`layer-${i}-select`} aria-pressed={layer.id === state.currentId} onClick={() => store.dispatch({ type: 'selectLayer', id: layer.id })}>
                {layer.name}
                {layer.id === state.currentId ? ' (current)' : ''}
              </button>{' '}
              <span data-testid={`layer-${i}-instrument`}>{label(layer.instrument)}</span>
              {layer.effects !== 'none' && <span>, {layer.effects}</span>}
              {', notes: '}
              <span data-testid={`layer-${i}-notes`}>{layer.notes.length}</span>{' '}
              <label>
                Volume{' '}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={layer.volume}
                  data-testid={`layer-${i}-volume`}
                  onChange={(e) => {
                    // the volume control always means "the current layer", so make this one current first
                    if (layer.id !== store.getState().currentId) store.dispatch({ type: 'selectLayer', id: layer.id });
                    sendCommand('create.layer.volume', 'button', { how: 'set', value: Number(e.target.value) });
                  }}
                />
              </label>{' '}
              <label>
                <input type="checkbox" data-testid={`layer-${i}-mute`} checked={layer.muted} onChange={(e) => store.dispatch({ type: 'setMuted', id: layer.id, muted: e.target.checked })} /> Mute
              </label>
            </li>
          ))}
        </ol>
      )}
      <p>
        <button type="button" data-testid="btn-play-loop" disabled={state.phase !== 'idle'} onClick={press(() => sendCommand('create.loop.play', 'button', { how: 'trigger' }))}>
          Play loop
        </button>
      </p>
    </section>
  );
}
