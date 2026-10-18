// What the background listens to on the bus: the song's loudness (songLevels, 8 bands, about 30 a second while it
// plays), where the beat is (transport), and the camera picture (cameraStream, shared with the vision module: this
// only SHOWS the same stream; tracking keeps running in its own worker).
import { bus, type SongLevels, type TransportState } from '@/bus';
import { beatKick, phaseNow } from './motion';

export interface MusicInput {
  playing: boolean;
  /** Smoothed loudness, low bands and high bands, 0 to 1. */
  level: number;
  low: number;
  high: number;
  /** 1 on the beat, falling to 0 before the next one. */
  pulse(now: number): number;
  /** Ease the smoothed values toward the latest levels (call once per drawn frame). */
  step(dt: number): void;
  stop(): void;
}

export function listenToMusic(onChange: () => void): MusicInput {
  let transport: TransportState | undefined;
  let transportAt = 0;
  let latest: SongLevels | null = null;
  let latestAt = 0;
  const m: MusicInput = {
    playing: false,
    level: 0,
    low: 0,
    high: 0,
    pulse(now) {
      if (!transport?.playing || !transport.bpm) return 0;
      return beatKick(phaseNow(transport.beatPhase ?? 0, transport.bpm, now - transportAt));
    },
    step(dt) {
      const fresh = latest && performance.now() - latestAt < 400 && m.playing;
      const k = 1 - Math.exp(-dt * 12);
      const b = latest?.bands ?? [];
      m.level += ((fresh ? latest!.level : 0) - m.level) * k;
      m.low += ((fresh ? ((b[0] ?? 0) + (b[1] ?? 0)) / 2 : 0) - m.low) * k;
      m.high += ((fresh ? ((b[5] ?? 0) + (b[6] ?? 0) + (b[7] ?? 0)) / 3 : 0) - m.high) * k;
    },
    stop() {},
  };
  const offT = bus.on(
    'transport',
    (t) => {
      const was = m.playing;
      transport = t;
      transportAt = performance.now();
      m.playing = !!t.playing;
      if (was !== m.playing) onChange();
    },
    { replay: true },
  );
  const offL = bus.on('songLevels', (lv) => {
    latest = lv;
    latestAt = performance.now();
  });
  m.stop = () => {
    offT();
    offL();
  };
  return m;
}

/** A hidden video element showing the shared camera stream; `onFrame` runs for each new camera frame. */
export function listenToCamera(onVideo: (video: HTMLVideoElement | null) => void, onFrame: () => void): () => void {
  let video: HTMLVideoElement | null = null;
  let timer = 0;
  const watch = (v: HTMLVideoElement) => {
    const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback;
    if (typeof rvfc !== 'function') {
      // older browsers: assume a new picture about 20 times a second
      timer = window.setInterval(() => video === v && onFrame(), 50);
      return;
    }
    const tick = () => {
      if (video !== v) return;
      onFrame();
      rvfc.call(v, tick);
    };
    rvfc.call(v, tick);
  };
  const off = bus.on(
    'cameraStream',
    (stream) => {
      window.clearInterval(timer);
      if (video) {
        video.srcObject = null;
        video = null;
      }
      if (stream) {
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.srcObject = stream;
        v.play().catch(() => {});
        video = v;
        watch(v);
      }
      onVideo(video);
    },
    { replay: true },
  );
  return () => {
    off();
    window.clearInterval(timer);
    if (video) video.srcObject = null;
    video = null;
  };
}
