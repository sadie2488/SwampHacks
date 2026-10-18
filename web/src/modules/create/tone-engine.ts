// The real sound engine for Create mode, built on Tone.js and the app's shared audio context.
// Layout of the Tone.Transport timeline (4/4):
//   bar 0       count-in clicks (only when a take is starting)
//   bar 1 ...   the loop itself, `bars` long; the transport jumps back to bar 1 when it reaches the end
// Every layer is a looping Tone.Part kept in phase with the bar its take started on (loop-grid.ts), so all layers
// stay in time however late a part is built. When the clock starts from the top, every part is rebuilt from bar 1.
import * as Tone from 'tone';
import { getAudioContext, resumeAudio } from '@/bus';
import type { Note } from '@/contracts';
import type { LoopEngine, LoopHooks } from './engine';
import { createEffect, createInstrument, type InstrumentVoice } from './instruments';
import type { Layer } from './layers';
import { barToTicks, LOOP_TOP_BAR, partStart } from './loop-grid';
import { takeMetronome } from './metronome';
import { BEATS_PER_BAR, type EffectId, type InstrumentId } from './music';

/** How far ahead of the clock a part built while the loop runs is started. */
const PART_START_MARGIN_SEC = 0.05;

let toneBound = false;
/** Tone makes its own context unless told otherwise; the app has one shared context, so Tone must use that. Done once. */
function bindToneToSharedContext() {
  if (toneBound) return;
  const shared = getAudioContext();
  // another module may already have pointed Tone at the shared context; wrapping it a second time would split the clocks
  if ((Tone.getContext().rawContext as unknown) !== shared) Tone.setContext(shared);
  toneBound = true;
}

interface PartEvent {
  time: string;
  pitch: number;
  beats: number;
  velocity: number;
}

interface Voice {
  id: string;
  instrumentId: InstrumentId;
  instrument: InstrumentVoice;
  pitchShift: Tone.PitchShift;
  effectId: EffectId;
  effect: Tone.ToneAudioNode | null;
  gain: Tone.Gain;
  part: Tone.Part<PartEvent> | null;
  /** What the part was built from, to know when it has to be rebuilt. */
  builtFrom: { notes: readonly Note[]; loopBeats: number; bpm: number; startBar: number } | null;
}

export function createToneEngine(): LoopEngine {
  return new ToneLoopEngine();
}

class ToneLoopEngine implements LoopEngine {
  private ready = false;
  private master!: Tone.Gain;
  private limiter!: Tone.Limiter;
  private click!: Tone.Synth;
  private voices = new Map<string, Voice>();
  private want: { layers: readonly Layer[]; bpm: number; bars: number } = { layers: [], bpm: 100, bars: 2 };
  private masterVolume = 0.8;
  private markIds: number[] = [];

  /** Build the shared nodes the first time sound is needed (after a click). */
  private ensure() {
    if (this.ready) return;
    bindToneToSharedContext();
    this.limiter = new Tone.Limiter(-2).toDestination();
    this.master = new Tone.Gain(this.masterVolume).connect(this.limiter);
    this.click = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 } }).connect(this.master);
    this.click.volume.value = -6;
    this.ready = true;
  }

  syncLayers(layers: readonly Layer[], bpm: number, bars: number): void {
    this.want = { layers, bpm, bars };
    if (this.ready) this.apply();
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.min(1, Math.max(0, volume));
    if (this.ready) this.master.gain.rampTo(this.masterVolume, 0.05);
  }

  startLoop(opts: { countIn: boolean }, hooks?: LoopHooks): void {
    this.ensure();
    // If the browser still has the audio paused this needs a click; it will not throw, the clock just waits
    void resumeAudio().catch(() => {});
    const transport = Tone.getTransport();
    const wasRunning = transport.state === 'started';
    if (!wasRunning) {
      transport.stop();
      this.silenceAll();
      // parts were placed on the old run's clock; build them again from the loop top
      for (const v of this.voices.values()) v.builtFrom = null;
    }
    this.clearMarks();
    this.apply();

    const positionBar = Number(String(transport.position).split(':')[0]) || 0;
    const countInBar = wasRunning ? Math.floor(positionBar) + 1 : 0;

    // The hooks change layer state, which touches Tone; do that after the transport callback.
    const later = (fn: () => void) => void setTimeout(fn, 0);
    if (opts.countIn) {
      for (let beat = 0; beat < BEATS_PER_BAR; beat++) {
        this.markIds.push(
          transport.schedule((time) => {
            this.clickAt(time, beat === 0);
            const at = this.heardAtMs(time);
            if (hooks?.onCountBeat) later(() => hooks.onCountBeat?.(beat, at));
          }, `${countInBar}:${beat}:0`),
        );
      }
    }
    if (hooks) {
      const goBar = countInBar + (opts.countIn ? 1 : 0);
      // a metronome through the take, so the person keeps time; stopLoop clears it with the other marks
      for (const tick of takeMetronome(goBar, this.want.bars)) {
        this.markIds.push(transport.schedule((time) => this.clickAt(time, tick.accent), tick.position));
      }
      this.markIds.push(
        transport.scheduleOnce((time) => {
          const at = this.heardAtMs(time);
          later(() => hooks.onGo(at, goBar));
        }, `${goBar}:0:0`),
      );
      // A take ends by itself after one pass of the default loop length (the controller then keeps it and stops
      // everything). The left-fist gesture or pressing Record again ends it early, which throws the take away.
      const passEndTicks = Math.round((goBar + this.want.bars) * BEATS_PER_BAR * transport.PPQ);
      this.markIds.push(
        transport.scheduleOnce((time) => {
          const at = this.heardAtMs(time);
          later(() => hooks.onPassEnd(at));
        }, `${passEndTicks - 1}i`),
      );
    }
    if (!wasRunning) transport.start('+0.05', opts.countIn ? '0:0:0' : '1m');
  }

  stopLoop(): void {
    if (!this.ready) return;
    Tone.getTransport().stop();
    this.clearMarks();
    this.silenceAll();
  }

  dispose(): void {
    if (!this.ready) return;
    this.stopLoop();
    for (const v of this.voices.values()) this.disposeVoice(v);
    this.voices.clear();
    this.click.dispose();
    this.master.dispose();
    this.limiter.dispose();
    this.ready = false;
  }

  // ---- internals ----

  /** Page-clock time (performance.now()) at which a sound scheduled for audio time `time` is heard. */
  private heardAtMs(time: number): number {
    const raw = Tone.getContext().rawContext as unknown as AudioContext;
    const latency = raw.outputLatency || raw.baseLatency || 0;
    return performance.now() + (time - raw.currentTime + latency) * 1000;
  }

  private clickAt(time: number, accent: boolean) {
    try {
      this.click.triggerAttackRelease(accent ? 2093 : 1568, 0.05, time);
    } catch {
      // two clicks at the same instant: ignore
    }
  }

  private clearMarks() {
    const transport = Tone.getTransport();
    for (const id of this.markIds) transport.clear(id);
    this.markIds = [];
  }

  private silenceAll() {
    for (const v of this.voices.values()) v.instrument.silence();
  }

  /** Bring the Tone side in line with `want`: add, change and remove voices, parts and the loop length. */
  private apply() {
    const { layers, bpm, bars } = this.want;
    const transport = Tone.getTransport();
    if (Math.abs(transport.bpm.value - bpm) > 1e-6) transport.bpm.value = bpm;
    transport.timeSignature = BEATS_PER_BAR;
    transport.loop = false;

    const seen = new Set<string>();
    for (const layer of layers) {
      seen.add(layer.id);
      let v = this.voices.get(layer.id);
      if (!v) {
        v = this.createVoice(layer);
        this.voices.set(layer.id, v);
      }
      if (v.instrumentId !== layer.instrument) {
        v.instrument.dispose();
        v.instrument = createInstrument(layer.instrument);
        v.instrumentId = layer.instrument;
        this.wire(v);
      }
      if (v.effectId !== layer.effects) {
        v.effect?.dispose();
        v.effect = createEffect(layer.effects);
        v.effectId = layer.effects;
        this.wire(v);
      }
      v.pitchShift.pitch = layer.pitchSemitones ?? 0;
      v.gain.gain.rampTo(layer.muted ? 0 : layer.volume, 0.03);
      const loopBeats = layer.loopBeats ?? bars * BEATS_PER_BAR;
      const startBar = layer.startBar ?? LOOP_TOP_BAR;
      const b = v.builtFrom;
      if (!b || b.notes !== layer.notes || b.loopBeats !== loopBeats || b.bpm !== bpm || b.startBar !== startBar) this.buildPart(v, layer.notes, loopBeats, bpm, startBar);
    }
    for (const [id, v] of this.voices) {
      if (seen.has(id)) continue;
      this.disposeVoice(v);
      this.voices.delete(id);
    }
  }

  private createVoice(layer: Layer): Voice {
    const v: Voice = {
      id: layer.id,
      instrumentId: layer.instrument,
      instrument: createInstrument(layer.instrument),
      pitchShift: new Tone.PitchShift({ pitch: layer.pitchSemitones ?? 0, windowSize: 0.05, wet: 1 }),
      effectId: layer.effects,
      effect: createEffect(layer.effects),
      gain: new Tone.Gain(layer.muted ? 0 : layer.volume).connect(this.master),
      part: null,
      builtFrom: null,
    };
    this.wire(v);
    return v;
  }

  /** instrument -> pitch shift -> (effect) -> volume -> master */
  private wire(v: Voice) {
    v.instrument.node.disconnect();
    v.pitchShift.disconnect();
    v.effect?.disconnect();
    v.instrument.node.connect(v.pitchShift);
    if (v.effect) {
      v.pitchShift.connect(v.effect);
      v.effect.connect(v.gain);
    } else {
      v.pitchShift.connect(v.gain);
    }
  }

  private buildPart(v: Voice, notes: readonly Note[], loopBeats: number, bpm: number, startBar: number) {
    v.part?.dispose();
    v.part = null;
    v.builtFrom = { notes, loopBeats, bpm, startBar };
    const transport = Tone.getTransport();
    const ppq = transport.PPQ;
    const events: PartEvent[] = [];
    for (const n of notes) {
      const onsetBeat = n.onset_beat ?? (n.onset_sec * bpm) / 60;
      if (onsetBeat < 0 || onsetBeat >= loopBeats) continue;
      events.push({ time: `${Math.round(onsetBeat * ppq)}i`, pitch: n.pitch, beats: n.duration_beat ?? (n.duration_sec * bpm) / 60, velocity: n.velocity ?? 0.8 });
    }
    if (events.length === 0) return;
    const loopTicks = Math.round(loopBeats * ppq);
    // join the loop part-way, in phase with the bar the take started on, instead of waiting for a later bar
    const at = partStart({
      anchorTicks: barToTicks(startBar, ppq),
      loopTicks,
      topTicks: barToTicks(LOOP_TOP_BAR, ppq),
      running: transport.state === 'started',
      nowTicks: transport.ticks,
      // the clock has already handled ticks up to about now; leave room for one more update of it
      marginTicks: Math.ceil(PART_START_MARGIN_SEC * (bpm / 60) * ppq),
    });
    const part = new Tone.Part<PartEvent>((time, ev) => {
      const secPerBeat = 60 / Tone.getTransport().bpm.value;
      v.instrument.play(ev.pitch, ev.beats * secPerBeat, time, ev.velocity);
    }, events);
    part.loop = true;
    part.loopStart = 0;
    part.loopEnd = `${loopTicks}i`;
    v.part = part.start(`${at.startTicks}i`, `${at.offsetTicks}i`);
  }

  private disposeVoice(v: Voice) {
    v.part?.dispose();
    v.instrument.dispose();
    v.pitchShift.dispose();
    v.effect?.dispose();
    v.gain.dispose();
  }
}
