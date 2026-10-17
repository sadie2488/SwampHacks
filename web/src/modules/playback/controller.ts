// The transport: what is playing, where we are, and what the controls say. It decides what the sound engine should do
// and publishes the "transport" state. It never touches Web Audio directly (that is output.ts), so it can be tested
// with a pretend output and fake timers.
import type { ControlState, TransportState } from '@/bus';
import type { SongAnalysis } from '@/contracts';
import { beatPhaseAt } from './beats';
import { renderNotesToSamples } from './render-notes';
import type { LoopRegion, PcmSource } from './stretch-engine';

/** Whatever makes the sound. output.ts is the real one (Web Audio); tests use a pretend one. */
export interface AudioOutput {
  /** Sample rate of the speakers; demo songs are made at this rate. */
  readonly sampleRate: number;
  /** Length and position of the loaded song, in song seconds. */
  readonly durationSec: number;
  readonly positionSec: number;
  /** Put a new song in, paused at the start. */
  load(source: PcmSource): void;
  play(): void;
  pause(): void;
  seek(sec: number): void;
  setTempo(t: number): void;
  setPitch(semitones: number): void;
  setVolume(v: number): void;
  setLoop(region: LoopRegion): void;
  /** Wake the audio device if the browser left it asleep (it only wakes after a click). Rejects if it cannot. */
  wake(): Promise<void>;
  /** Called when a song that is not looping reaches its end. */
  onEnded: (() => void) | null;
  dispose(): void;
}

export interface ControllerDeps {
  output: AudioOutput;
  publish: (state: TransportState) => void;
  report: (state: 'idle' | 'starting' | 'running' | 'error', message?: string) => void;
}

const TICK_MS = 1000 / 15;

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export class PlaybackController {
  private analysis: SongAnalysis | null = null;
  private songId: string | undefined;
  private loaded = false;
  /** Which song the loaded sound belongs to (an uploaded file's id, or a demo song we made sound for). */
  private audioSongId: string | null = null;
  private playing = false;
  private tempo = 1;
  private pitch = 0;
  private volume = 0.8;
  private loop = false;
  private loopSection: [number, number] | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: ControllerDeps) {
    deps.output.onEnded = () => this.handleEnded();
  }

  // ---- what the bus tells us ----
  /** The analysis of the song. Demo songs get sound made from their notes; uploads wait for their decoded audio. */
  setAnalysis(analysis: SongAnalysis): void {
    this.analysis = analysis;
    if (this.audioSongId === analysis.song_id) {
      this.songId = analysis.song_id;
    } else if (analysis.source?.kind === 'upload') {
      this.unload(analysis.song_id);
      this.deps.report('starting', 'Waiting for the song to finish loading');
    } else {
      this.deps.report('starting', 'Making the demo song');
      try {
        const samples = renderNotesToSamples(analysis, this.deps.output.sampleRate);
        this.loadSource({ sampleRate: this.deps.output.sampleRate, channels: [samples] }, analysis.song_id);
      } catch (e) {
        this.fail('The demo song could not be made', e);
      }
    }
    this.emit();
  }

  /** The decoded audio of an uploaded song. */
  setSongAudio(songId: string, source: PcmSource): void {
    try {
      this.loadSource(source, songId);
    } catch (e) {
      this.fail('This song could not be played', e);
    }
    this.emit();
  }

  /** The latest value of every control. Only the playback ones matter here. */
  applyControls(c: ControlState): void {
    const tempo = num(c['playback.tempo'], 1);
    const pitch = num(c['playback.pitch'], 0);
    const volume = num(c['playback.volume'], 0.8);
    const loop = c['playback.loop'] === true;
    const raw = c['playback.loop_section'];
    const section: [number, number] | null = Array.isArray(raw) && raw.length === 2 && raw.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [raw[0], raw[1]] : null;
    const sameSection = (a: [number, number] | null, b: [number, number] | null) => (a === null || b === null ? a === b : a[0] === b[0] && a[1] === b[1]);
    const changed = tempo !== this.tempo || pitch !== this.pitch || volume !== this.volume || loop !== this.loop || !sameSection(section, this.loopSection);
    if (!changed) return;
    this.tempo = tempo;
    this.pitch = pitch;
    this.volume = volume;
    this.loop = loop;
    this.loopSection = section;
    this.pushSettings();
    this.emit();
  }

  /** A trigger command (play, pause, toggle). Other commands are ignored. */
  command(name: string): void {
    if (name === 'playback.play') this.play();
    else if (name === 'playback.pause') this.pause();
    else if (name === 'playback.toggle') this.toggle();
  }

  // ---- transport ----
  play(): void {
    if (!this.loaded || this.playing) return;
    this.playing = true;
    this.deps.output.play();
    this.deps.output.wake().catch((e) => {
      if (!this.playing) return;
      this.fail('The browser did not allow sound yet. Click the page once and press play again', e);
      this.pause();
    });
    this.startTicking();
    this.emit();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.deps.output.pause();
    this.stopTicking();
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Jump to a place in the song (song seconds). */
  seek(sec: number): void {
    if (!this.loaded) return;
    this.deps.output.seek(Math.min(Math.max(Number.isFinite(sec) ? sec : 0, 0), this.deps.output.durationSec));
    this.emit();
  }

  dispose(): void {
    this.stopTicking();
    this.deps.output.onEnded = null;
    this.deps.output.dispose();
  }

  /** The state as it would be published right now. */
  state(): TransportState {
    const position = this.loaded ? this.deps.output.positionSec : 0;
    const a = this.analysis && this.analysis.song_id === this.songId ? this.analysis : null;
    return {
      loaded: this.loaded,
      songId: this.songId,
      playing: this.playing,
      positionSec: position,
      durationSec: this.loaded ? this.deps.output.durationSec : (a?.duration_sec ?? 0),
      tempo: this.tempo,
      pitch: this.pitch,
      volume: this.volume,
      loop: this.loop,
      loopSection: this.loopSection,
      bpm: a ? a.tempo_bpm * this.tempo : undefined,
      beatPhase: a ? beatPhaseAt(position, a.beats, a.tempo_bpm) : undefined,
    };
  }

  // ---- internals ----
  private emit(): void {
    this.deps.publish(this.state());
  }

  private loadSource(source: PcmSource, songId: string): void {
    this.stopTicking();
    this.playing = false;
    this.deps.output.pause();
    this.deps.output.load(source);
    this.loaded = true;
    this.songId = songId;
    this.audioSongId = songId;
    this.pushSettings();
    this.deps.report('running', 'Ready to play');
  }

  private unload(songId: string): void {
    this.stopTicking();
    this.playing = false;
    if (this.loaded) this.deps.output.pause();
    this.loaded = false;
    this.audioSongId = null;
    this.songId = songId;
  }

  private pushSettings(): void {
    const o = this.deps.output;
    o.setTempo(this.tempo);
    o.setPitch(this.pitch);
    o.setVolume(this.volume);
    if (!this.loaded) return;
    // Loop on with a section: wrap inside it. Loop on with no section: loop the whole song. Loop off: play through.
    o.setLoop(this.loop ? (this.loopSection ?? [0, o.durationSec]) : null);
  }

  private handleEnded(): void {
    // The song reached its end (it was not looping): stop and rewind.
    this.playing = false;
    this.stopTicking();
    this.deps.output.seek(0);
    this.emit();
  }

  private fail(message: string, error: unknown): void {
    console.error('[playback]', message, error);
    this.deps.report('error', message);
  }

  private startTicking(): void {
    if (this.timer === null) this.timer = setInterval(() => this.emit(), TICK_MS);
  }

  private stopTicking(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
