import { useEffect, useState } from 'react';
import { bus, sendCommand, type ControlState } from '@/bus';
import { afterAudioWakes, useBusValue, useModuleStatus } from './hooks';

const mmss = (sec: number) => {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Every control here sends a command with source "button", the same commands motion and voice will send. */
export function Transport() {
  const controls: ControlState = useBusValue('controls') ?? {};
  // Only the text is kept in state, so the page does not redraw 60 times a second while playing.
  const [stateText, setStateText] = useState('no song');
  const [positionText, setPositionText] = useState('00:00 / 00:00');
  const playback = useModuleStatus('playback');

  useEffect(
    () =>
      bus.on(
        'transport',
        (t) => {
          setStateText(!t.loaded ? 'no song' : t.playing ? 'playing' : 'paused');
          setPositionText(`${mmss(t.positionSec)} / ${mmss(t.durationSec)}`);
        },
        { replay: true },
      ),
    [],
  );

  const tempo = num(controls['playback.tempo'], 1);
  const pitch = num(controls['playback.pitch'], 0);
  const volume = num(controls['playback.volume'], 0.8);
  const loop = controls['playback.loop'] === true;

  const press = (command: string, extra: Parameters<typeof sendCommand>[2]) => () => void afterAudioWakes(() => sendCommand(command, 'button', extra));

  return (
    <section className="panel" aria-labelledby="transport-heading">
      <h2 id="transport-heading">Play it</h2>
      <p>
        Now: <strong data-testid="transport-state">{stateText}</strong>, at <span data-testid="transport-position">{positionText}</span>
      </p>
      {playback?.message && (
        <p data-testid="status-playback" data-state={playback.state} role={playback.state === 'error' ? 'alert' : 'status'}>
          {playback.state === 'error' ? `Problem: ${playback.message}` : playback.message}
        </p>
      )}
      <div className="row">
        <button type="button" data-testid="btn-play" onClick={press('playback.play', { how: 'trigger' })}>
          Play
        </button>
        <button type="button" data-testid="btn-pause" onClick={press('playback.pause', { how: 'trigger' })}>
          Pause
        </button>
        <button type="button" data-testid="btn-loop" aria-pressed={loop} onClick={press('playback.loop', { how: 'toggle' })}>
          Loop: {loop ? 'on' : 'off'}
        </button>
      </div>
      <div className="row">
        <span>Speed</span>
        <button type="button" data-testid="btn-tempo-down" onClick={press('playback.tempo', { how: 'nudge', value: -0.1 })}>
          Slower
        </button>
        <output data-testid="tempo-value">{tempo.toFixed(1)}x</output>
        <button type="button" data-testid="btn-tempo-up" onClick={press('playback.tempo', { how: 'nudge', value: 0.1 })}>
          Faster
        </button>
      </div>
      <div className="row">
        <span>Pitch</span>
        <button type="button" data-testid="btn-pitch-down" onClick={press('playback.pitch', { how: 'nudge', value: -1 })}>
          Lower
        </button>
        <output data-testid="pitch-value">{pitch} semitones</output>
        <button type="button" data-testid="btn-pitch-up" onClick={press('playback.pitch', { how: 'nudge', value: 1 })}>
          Higher
        </button>
      </div>
      <div className="row">
        <label>
          Volume{' '}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            data-testid="volume-slider"
            onChange={(e) => sendCommand('playback.volume', 'button', { how: 'set', value: Number(e.target.value) })}
          />
        </label>
      </div>
    </section>
  );
}
