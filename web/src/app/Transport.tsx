// The player bar that floats at the bottom of Learn and Play: the big play button, the song and its facts, the
// progress line, and the compact controls (pause, loop, speed, pitch, volume).
import { useEffect, useRef, useState } from 'react';
import { bus, sendCommand, type ControlState } from '@/bus';
import { SongFacts } from './AnalysisSummary';
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
  // The progress line is moved directly for the same reason.
  const [stateText, setStateText] = useState('no song');
  const [positionText, setPositionText] = useState('00:00 / 00:00');
  const progressRef = useRef<HTMLSpanElement>(null);
  const playback = useModuleStatus('playback');
  const hasSong = Boolean(useBusValue('analysis'));

  useEffect(
    () =>
      bus.on(
        'transport',
        (t) => {
          setStateText(!t.loaded ? 'no song' : t.playing ? 'playing' : 'paused');
          setPositionText(`${mmss(t.positionSec)} / ${mmss(t.durationSec)}`);
          const share = t.durationSec > 0 ? Math.min(1, Math.max(0, t.positionSec / t.durationSec)) : 0;
          if (progressRef.current) progressRef.current.style.width = `${(share * 100).toFixed(2)}%`;
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

  const time = (
    <span className="fact">
      <span data-testid="transport-position">{positionText}</span>
      <span className="transport-state">
        {' '}
        (<span data-testid="transport-state">{stateText}</span>)
      </span>
    </span>
  );

  return (
    <section className="player-bar" aria-labelledby="transport-heading" data-state={stateText}>
      <h2 id="transport-heading" className="sr-only">
        Play it
      </h2>
      <button type="button" className="play-button" data-testid="btn-play" title="Play" onClick={press('playback.play', { how: 'trigger' })}>
        <span className="sr-only">Play</span>
      </button>

      <div className="player-info">
        <SongFacts extra={time} />
        {!hasSong && (
          <div className="song-facts">
            <p className="song-title">No song yet</p>
            <p className="song-meta">Upload a file or use the demo song. {time}</p>
          </div>
        )}
        <div className="progress" aria-hidden="true">
          <span ref={progressRef} />
        </div>
        {playback?.message && (
          <p className="player-status" data-testid="status-playback" data-state={playback.state} role={playback.state === 'error' ? 'alert' : 'status'}>
            {playback.state === 'error' ? `Problem: ${playback.message}` : playback.message}
          </p>
        )}
      </div>

      <div className="player-controls">
        <div className="player-row">
          <button type="button" data-testid="btn-pause" onClick={press('playback.pause', { how: 'trigger' })}>
            Pause
          </button>
          <button type="button" data-testid="btn-loop" aria-pressed={loop} onClick={press('playback.loop', { how: 'toggle' })}>
            Loop: {loop ? 'on' : 'off'}
          </button>
          <label className="player-label volume">
            <span>Volume</span>
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
        <div className="player-row">
          <span className="player-label" id="speed-label">
            Speed
          </span>
          <div className="seg" role="group" aria-labelledby="speed-label">
            <button type="button" data-testid="btn-tempo-down" aria-label="Slower" title="Slower" onClick={press('playback.tempo', { how: 'nudge', value: -0.1 })}>
              −
            </button>
            <output data-testid="tempo-value">{tempo.toFixed(1)}x</output>
            <button type="button" data-testid="btn-tempo-up" aria-label="Faster" title="Faster" onClick={press('playback.tempo', { how: 'nudge', value: 0.1 })}>
              +
            </button>
          </div>
          <span className="player-label" id="pitch-label">
            Pitch
          </span>
          <div className="seg" role="group" aria-labelledby="pitch-label">
            <button type="button" data-testid="btn-pitch-down" aria-label="Lower" title="Lower (one semitone)" onClick={press('playback.pitch', { how: 'nudge', value: -1 })}>
              −
            </button>
            <output data-testid="pitch-value" title="semitones">
              {pitch}
              <span className="sr-only"> semitones</span>
            </output>
            <button type="button" data-testid="btn-pitch-up" aria-label="Higher" title="Higher (one semitone)" onClick={press('playback.pitch', { how: 'nudge', value: 1 })}>
              +
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
