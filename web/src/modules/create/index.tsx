// Create mode (lane D): hum a melody, hear it as an instrument, stack layers into a loop.
// start() listens to the bus and drives the sound; CreatePanel is the screen. Every button sends a command on the bus,
// so gestures and voice use the same path.
// The screen is one open playground (see ui/overture/CreateStage.tsx and create-stage.css for the places): the hum
// column on the left, instruments and the big Record button in the middle, the layers strip under them, the save line
// bottom right. Every control keeps its data-testid.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { bus, resumeAudio, sendCommand, type Stop } from '@/bus';
import type { Mode } from '@/contracts';
import { startController } from './controller';
import { playFakeHum } from './fake-hum';
import { currentLayer, describeState, hasBeat, isRecording } from './layers';
import { EFFECT_IDS, INSTRUMENT_IDS, midiToName } from './music';
import type { FetchFn } from './api';
import { SavedTracks } from './saved-tracks';
import { applyAnalysis, takeSummaryText } from './settings';
import { settings, store } from './app-store';
import { createToneEngine } from './tone-engine';

export { useCreateCountIn } from './app-store';

/** The saved-tracks list on its own (the History page's "Past creations"): same store, same buttons as in Create. */
export function PastCreations({ fetchFn }: { fetchFn?: FetchFn } = {}) {
  return <SavedTracks store={store} fetchFn={fetchFn} />;
}

export function start(): Stop {
  return startController({ engine: createToneEngine(), store, settings });
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

/** `fetchFn`: the app's fetch for its own server (it adds the login token); saving falls back to plain fetch without it. */
export function CreatePanel({ fetchFn }: { fetchFn?: FetchFn } = {}) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const options = useSyncExternalStore(settings.subscribe, settings.getState);
  // the controller also listens, but the screen must show the right default even when it is drawn first
  useEffect(() => bus.on('analysis', (a) => applyAnalysis(settings, a), { replay: true }), []);
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
    <section data-testid="create-panel" aria-label="Create mode" className="create-stage">
      <h2 className="create-stage-title">Create</h2>
      {mode !== 'create' && (
        <p role="note" className="create-note">
          Create mode is not active yet, so these buttons will not do anything.
        </p>
      )}

      {/* left: the hum rings (ModeVisual draws them above this column), the words, and the note heard */}
      <div className="hum-col">
        <p className="hum-words">Hum something</p>
        <p className="hum-heard">
          Heard <output data-testid="hum-note" aria-live="off">{humNote}</output>
        </p>
        <p className="hum-small">
          <label>
            <input type="checkbox" data-testid="toggle-snap" checked={options.snap} onChange={(e) => settings.set({ snap: e.target.checked })} /> Snap to the key
          </label>
          {!options.songKey && options.snap && <span> (no song key is loaded, so the key is guessed from your hum)</span>}
        </p>
        {options.take && (
          <p data-testid="take-summary" className="hum-small">
            {takeSummaryText(options.take)}
          </p>
        )}
        <button type="button" className="pill hum-fake" data-testid="btn-fake-hum" disabled={faking} onClick={press(startFake)}>
          {faking ? 'Humming…' : 'Simulate humming'}
        </button>
      </div>

      {/* middle: WHAT (the instrument of the selected layer) above HOW (the big Record button) */}
      <div className="make-col">
        <div role="group" aria-label="Instrument for the current layer" className="instrument-row">
          {INSTRUMENT_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className="instrument-pill"
              data-testid={`btn-instrument-${id}`}
              aria-pressed={instrument === id}
              disabled={cur?.kind === 'beat'}
              onClick={press(() => sendCommand('create.instrument', 'button', { how: 'set', value: id }))}
            >
              {label(id)}
            </button>
          ))}
        </div>

        <div role="group" aria-label="Loop controls" className="record-row">
          <button type="button" data-testid="btn-record" className="record-big" aria-pressed={recording} onClick={press(() => sendCommand('create.loop.record', 'button', { how: 'toggle' }))}>
            {recording ? 'Stop' : 'Record a layer'}
          </button>
          <div className="record-side">
            <p data-testid="create-status" role="status" className="create-status">
              {describeState(state)}
              {state.message ? `. ${state.message}` : ''}
            </p>
            <p className="loop-info">
              Loop: {state.bars} bars of 4/4 at {state.bpm} beats per minute
            </p>
            <p className="record-extras">
              <button type="button" className="pill" data-testid="btn-beat" aria-pressed={beatOn} onClick={press(() => sendCommand('create.beat', 'button', { how: 'toggle' }))}>
                Beat: {beatOn ? 'on' : 'off'}
              </button>
              <label>
                Instrument{' '}
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
              </label>
              <label>
                Effect{' '}
                <select data-testid="select-effects" value={effects} onChange={(e) => run(() => sendCommand('create.effects', 'button', { how: 'set', value: e.target.value }))}>
                  {EFFECT_IDS.map((id) => (
                    <option key={id} value={id}>
                      {label(id)}
                    </option>
                  ))}
                </select>
              </label>
            </p>
          </div>
        </div>
      </div>

      {/* under them: Play / Stop for the loop, then one chip per layer and "+ Add layer" at the end */}
      <div className="layers-row">
        <h3 className="layers-title">Layers</h3>
        <div className="loop-pills">
          <button type="button" className="pill" data-testid="btn-play-loop" disabled={state.phase !== 'idle'} onClick={press(() => sendCommand('create.loop.play', 'button', { how: 'trigger' }))}>
            Play loop
          </button>
          <button type="button" className="pill" data-testid="btn-stop-loop" onClick={press(() => sendCommand('create.loop.stop', 'button', { how: 'trigger' }))}>
            Stop loop
          </button>
        </div>
        <ol className="layer-strip">
          {state.layers.map((layer, i) => {
            const current = layer.id === state.currentId;
            return (
              <li key={layer.id} data-testid={`layer-${i}`} className="layer-chip" aria-current={current ? 'true' : undefined}>
                <button type="button" data-testid={`layer-${i}-select`} className="chip-name" aria-pressed={current} onClick={() => store.dispatch({ type: 'selectLayer', id: layer.id })}>
                  {layer.name}
                </button>
                <span className="chip-meta">
                  {' · '}
                  <span data-testid={`layer-${i}-instrument`}>{label(layer.instrument)}</span>
                  {layer.effects !== 'none' && <span>, {layer.effects}</span>}
                  {' · '}
                  <span data-testid={`layer-${i}-notes`}>{layer.notes.length}</span>
                  {' notes'}
                </span>
                <span className="chip-tools">
                  <label className="chip-mute" title="Mute this layer">
                    <input type="checkbox" className="mute-dot" data-testid={`layer-${i}-mute`} checked={layer.muted} onChange={(e) => store.dispatch({ type: 'setMuted', id: layer.id, muted: e.target.checked })} /> Mute
                  </label>
                  <label className="chip-volume" title="Volume of this layer">
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
                  </label>
                  <label className="chip-small">
                    <input
                      type="checkbox"
                      data-testid={`layer-${i}-hand-pitch`}
                      aria-label={`${layer.name} hand pitch`}
                      checked={layer.handPitchEnabled ?? false}
                      disabled={layer.notes.length === 0}
                      onChange={(e) => store.dispatch({ type: 'setHandPitchEnabled', id: layer.id, enabled: e.target.checked })}
                    />{' '}
                    Hand pitch
                  </label>
                  {layer.handPitchEnabled && (
                    <span data-testid={`layer-${i}-pitch-value`}>
                      {(layer.pitchSemitones ?? 0) > 0 ? '+' : ''}
                      {(layer.pitchSemitones ?? 0).toFixed(1)} semitones
                    </span>
                  )}
                  <label className="chip-small">
                    <input
                      type="checkbox"
                      data-testid={`layer-${i}-instrument-voice`}
                      aria-label={`${layer.name} instrument voice`}
                      checked={layer.instrumentVoiceEnabled ?? false}
                      disabled={layer.notes.length === 0}
                      onChange={(e) => {
                        if (layer.id !== store.getState().currentId) store.dispatch({ type: 'selectLayer', id: layer.id });
                        sendCommand('create.instrument.voice', 'button', { how: 'set', value: e.target.checked });
                      }}
                    />{' '}
                    Voice
                  </label>
                </span>
              </li>
            );
          })}
          <li className="layer-chip layer-chip-add">
            <button type="button" data-testid="btn-add-layer" className="chip-add" onClick={press(() => sendCommand('create.layer.add', 'button', { how: 'trigger' }))}>
              + Add layer
            </button>
          </li>
        </ol>
        {state.layers.length === 0 && <p className="layers-hint">No layers yet. Press Record, or Add layer, to start.</p>}
      </div>

      <SavedTracks store={store} fetchFn={fetchFn} />
    </section>
  );
}
