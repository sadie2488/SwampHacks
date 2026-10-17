// The transport logic with a pretend output (no sound) and a fake clock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import twinkleJson from '@fixtures/song-analysis/twinkle.json';
import type { TransportState } from '@/bus';
import type { SongAnalysis } from '@/contracts';
import { PlaybackController, type AudioOutput } from './controller';
import type { LoopRegion, PcmSource } from './stretch-engine';

const twinkle = twinkleJson as unknown as SongAnalysis;
const upload: SongAnalysis = { ...twinkle, song_id: 'upload-1', source: { kind: 'upload', file_name: 'mine.mp3' } };

/** A pretend speaker: its position moves with the (fake) clock while it is playing, at the current tempo. */
class FakeOutput implements AudioOutput {
  sampleRate = 8000;
  durationSec = 0;
  onEnded: (() => void) | null = null;
  calls: string[] = [];
  loaded: PcmSource | null = null;
  loop: LoopRegion = null;
  tempo = 1;
  pitch = 0;
  volume = 0.8;
  wakeFails = false;
  private base = 0;
  private since = 0;
  private running = false;

  get positionSec(): number {
    return Math.min(this.durationSec, this.base + (this.running ? ((Date.now() - this.since) / 1000) * this.tempo : 0));
  }
  private rebase(): void {
    this.base = this.positionSec;
    this.since = Date.now();
  }
  load(source: PcmSource): void {
    this.calls.push('load');
    this.loaded = source;
    this.durationSec = source.channels[0].length / source.sampleRate;
    this.base = 0;
    this.running = false;
  }
  play(): void {
    this.calls.push('play');
    this.rebase();
    this.running = true;
  }
  pause(): void {
    this.calls.push('pause');
    this.rebase();
    this.running = false;
  }
  seek(sec: number): void {
    this.calls.push(`seek ${sec}`);
    this.base = sec;
    this.since = Date.now();
  }
  setTempo(t: number): void {
    this.rebase();
    this.tempo = t;
  }
  setPitch(s: number): void {
    this.pitch = s;
  }
  setVolume(v: number): void {
    this.volume = v;
  }
  setLoop(region: LoopRegion): void {
    this.loop = region;
  }
  wake(): Promise<void> {
    this.calls.push('wake');
    return this.wakeFails ? Promise.reject(new Error('not allowed')) : Promise.resolve();
  }
  dispose(): void {
    this.calls.push('dispose');
  }
  /** Pretend the song played to its end. */
  finish(): void {
    this.base = this.durationSec;
    this.running = false;
    this.onEnded?.();
  }
}

let out: FakeOutput;
let ctl: PlaybackController;
let published: TransportState[];
let statuses: Array<[string, string | undefined]>;

const last = () => published[published.length - 1];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  out = new FakeOutput();
  published = [];
  statuses = [];
  ctl = new PlaybackController({ output: out, publish: (s) => published.push(s), report: (s, m) => statuses.push([s, m]) });
});
afterEach(() => {
  ctl.dispose();
  vi.useRealTimers();
});

describe('loading', () => {
  it('starts empty and cannot play', () => {
    expect(ctl.state()).toMatchObject({ loaded: false, playing: false, positionSec: 0, durationSec: 0, tempo: 1, pitch: 0, volume: 0.8, loop: false, loopSection: null });
    ctl.play();
    expect(ctl.state().playing).toBe(false);
    expect(out.calls).toEqual([]);
  });

  it('makes sound for a demo song from its notes, at the speakers\' sample rate', () => {
    ctl.setAnalysis(twinkle);
    expect(out.loaded!.sampleRate).toBe(8000);
    expect(out.loaded!.channels[0].length / 8000).toBeCloseTo(28.8, 1);
    expect(last()).toMatchObject({ loaded: true, songId: 'demo-twinkle', playing: false, positionSec: 0 });
    expect(last().durationSec).toBeCloseTo(28.8, 1);
    expect(statuses[statuses.length - 1][0]).toBe('running');
  });

  it('waits for the real audio of an uploaded song, then plays that', () => {
    ctl.setAnalysis(upload);
    expect(out.calls).toEqual([]);
    expect(last()).toMatchObject({ loaded: false, songId: 'upload-1' });
    ctl.setSongAudio('upload-1', { sampleRate: 8000, channels: [new Float32Array(8000 * 5)] });
    expect(last()).toMatchObject({ loaded: true, songId: 'upload-1' });
    expect(last().durationSec).toBeCloseTo(5, 3); // the real file's length, not the analysis' 28.8
  });

  it('copes with the audio arriving before the analysis, and does not replace it with a demo', () => {
    ctl.setSongAudio('upload-1', { sampleRate: 8000, channels: [new Float32Array(8000 * 5)] });
    ctl.setAnalysis(upload);
    ctl.setAnalysis({ ...twinkle, song_id: 'upload-1' }); // even a demo-looking analysis for the same song keeps the real audio
    expect(out.calls.filter((c) => c === 'load')).toHaveLength(1);
    expect(last().durationSec).toBeCloseTo(5, 3);
  });

  it('does not restart a song that is playing when the same analysis arrives again', () => {
    ctl.setAnalysis(twinkle);
    ctl.play();
    vi.advanceTimersByTime(2000);
    ctl.setAnalysis({ ...twinkle, title: 'Twinkle (better analysis)' });
    expect(out.calls.filter((c) => c === 'load')).toHaveLength(1);
    expect(last().playing).toBe(true);
    expect(last().positionSec).toBeGreaterThan(1.9);
  });

  it('a different song stops the old one', () => {
    ctl.setAnalysis(twinkle);
    ctl.play();
    ctl.setAnalysis(upload);
    expect(last()).toMatchObject({ playing: false, loaded: false, songId: 'upload-1' });
    ctl.play();
    expect(last().playing).toBe(false);
  });
});

describe('play, pause and toggle', () => {
  beforeEach(() => ctl.setAnalysis(twinkle));

  it('play and pause arrive as commands and are published at once', () => {
    const before = published.length;
    ctl.command('playback.play');
    expect(published.length).toBe(before + 1);
    expect(last().playing).toBe(true);
    expect(out.calls).toContain('wake');
    ctl.command('playback.pause');
    expect(published.length).toBe(before + 2);
    expect(last().playing).toBe(false);
  });

  it('toggle flips between playing and paused; unknown commands do nothing', () => {
    ctl.command('playback.toggle');
    expect(last().playing).toBe(true);
    ctl.command('playback.toggle');
    expect(last().playing).toBe(false);
    const n = published.length;
    ctl.command('create.layer.add');
    ctl.command('playback.tempo');
    expect(published.length).toBe(n);
  });

  it('publishes about 15 times a second while playing, with the position moving, and stops when paused', () => {
    ctl.play();
    published.length = 0;
    vi.advanceTimersByTime(2000);
    expect(published.length).toBeGreaterThanOrEqual(28);
    expect(published.length).toBeLessThanOrEqual(31);
    expect(last().positionSec).toBeCloseTo(2, 1);
    for (let i = 1; i < published.length; i++) expect(published[i].positionSec).toBeGreaterThanOrEqual(published[i - 1].positionSec);
    ctl.pause();
    published.length = 0;
    vi.advanceTimersByTime(1000);
    expect(published).toHaveLength(0);
  });

  it('pausing keeps the place, playing again carries on from it', () => {
    ctl.play();
    vi.advanceTimersByTime(3000);
    ctl.pause();
    const at = last().positionSec;
    expect(at).toBeCloseTo(3, 1);
    vi.advanceTimersByTime(5000);
    ctl.play();
    expect(last().positionSec).toBeCloseTo(at, 1);
    vi.advanceTimersByTime(1000);
    expect(last().positionSec).toBeCloseTo(at + 1, 1);
  });

  it('playing twice does not double up', () => {
    ctl.play();
    ctl.play();
    expect(out.calls.filter((c) => c === 'play')).toHaveLength(1);
    published.length = 0;
    vi.advanceTimersByTime(1000);
    expect(published.length).toBeLessThanOrEqual(16);
  });

  it('goes back to paused, with a friendly message, if the browser will not start sound', async () => {
    out.wakeFails = true;
    ctl.play();
    await vi.advanceTimersByTimeAsync(10);
    expect(last().playing).toBe(false);
    expect(statuses[statuses.length - 1]).toEqual(['error', expect.stringContaining('Click the page')]);
  });

  it('seek moves the position and publishes', () => {
    ctl.seek(12.5);
    expect(last().positionSec).toBeCloseTo(12.5, 3);
    ctl.seek(999);
    expect(last().positionSec).toBeCloseTo(28.8, 1);
    ctl.seek(-4);
    expect(last().positionSec).toBe(0);
  });
});

describe('the end of the song', () => {
  it('stops and rewinds when a song that is not looping ends', () => {
    ctl.setAnalysis(twinkle);
    ctl.play();
    vi.advanceTimersByTime(1000);
    out.finish();
    expect(last()).toMatchObject({ playing: false, positionSec: 0 });
    expect(out.calls).toContain('seek 0');
    published.length = 0;
    vi.advanceTimersByTime(1000);
    expect(published).toHaveLength(0);
    ctl.play(); // and it can be played again
    expect(last().playing).toBe(true);
  });
});

describe('controls', () => {
  beforeEach(() => ctl.setAnalysis(twinkle));

  it('tempo, pitch and volume change while playing without restarting or jumping', () => {
    ctl.play();
    vi.advanceTimersByTime(2000);
    const loads = out.calls.filter((c) => c === 'load').length;
    const seeks = out.calls.filter((c) => c.startsWith('seek')).length;
    ctl.applyControls({ 'playback.tempo': 1.5, 'playback.pitch': -3, 'playback.volume': 0.4 });
    expect(out.tempo).toBe(1.5);
    expect(out.pitch).toBe(-3);
    expect(out.volume).toBe(0.4);
    expect(last()).toMatchObject({ playing: true, tempo: 1.5, pitch: -3, volume: 0.4 });
    expect(last().positionSec).toBeCloseTo(2, 1);
    vi.advanceTimersByTime(2000);
    expect(ctl.state().positionSec).toBeCloseTo(2 + 2 * 1.5, 1); // the position moves at the new speed
    expect(out.calls.filter((c) => c === 'load')).toHaveLength(loads);
    expect(out.calls.filter((c) => c.startsWith('seek'))).toHaveLength(seeks);
  });

  it('reports bpm as the song tempo times the speed', () => {
    ctl.applyControls({ 'playback.tempo': 0.5 });
    expect(last().bpm).toBe(50);
    ctl.applyControls({ 'playback.tempo': 1.5 });
    expect(last().bpm).toBe(150);
  });

  it('reports where we are in the beat', () => {
    ctl.seek(0.9); // beats are 0.6 s apart, so this is halfway between two
    expect(last().beatPhase).toBeCloseTo(0.5, 3);
    ctl.seek(1.2);
    expect(last().beatPhase).toBeCloseTo(0, 3);
  });

  it('loop with no section loops the whole song; with a section it wraps inside it; off plays through', () => {
    ctl.applyControls({ 'playback.loop': true });
    expect(out.loop?.[0]).toBe(0);
    expect(out.loop?.[1]).toBeCloseTo(28.8, 1);
    expect(last().loop).toBe(true);
    ctl.applyControls({ 'playback.loop': true, 'playback.loop_section': [4.8, 9.6] });
    expect(out.loop).toEqual([4.8, 9.6]);
    expect(last().loopSection).toEqual([4.8, 9.6]);
    ctl.applyControls({ 'playback.loop': false, 'playback.loop_section': [4.8, 9.6] });
    expect(out.loop).toBeNull();
  });

  it('settings made before a song is loaded are used when it loads', () => {
    const early = new FakeOutput();
    const c = new PlaybackController({ output: early, publish: () => {}, report: () => {} });
    c.applyControls({ 'playback.tempo': 0.7, 'playback.pitch': 5, 'playback.loop': true });
    c.setAnalysis(twinkle);
    expect(early.tempo).toBe(0.7);
    expect(early.pitch).toBe(5);
    expect(early.loop?.[0]).toBe(0);
  });

  it('ignores controls it does not own and repeats of the same values', () => {
    ctl.applyControls({ 'playback.tempo': 1.2 });
    const n = published.length;
    ctl.applyControls({ 'playback.tempo': 1.2, 'create.instrument': 'synth' });
    ctl.applyControls({ 'playback.tempo': 1.2, 'visual.intensity': 0.9 });
    expect(published.length).toBe(n);
  });

  it('ignores nonsense values', () => {
    ctl.applyControls({ 'playback.tempo': 'fast', 'playback.loop_section': [1] as unknown as [number, number] });
    expect(last()).toMatchObject({ tempo: 1, loopSection: null });
  });
});

describe('stopping', () => {
  it('dispose stops the timer and the output', () => {
    ctl.setAnalysis(twinkle);
    ctl.play();
    ctl.dispose();
    published.length = 0;
    vi.advanceTimersByTime(1000);
    expect(published).toHaveLength(0);
    expect(out.calls).toContain('dispose');
  });
});
