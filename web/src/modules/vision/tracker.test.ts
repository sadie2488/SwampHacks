import { describe, expect, it } from 'vitest';
import { signalCatalog } from '@/contracts/catalogs';
import { GestureTracker, HAND, THRESHOLDS, palmCenter, type HandObs, type Pt, type Side, type SignalOut } from './gestures';
import { makeFace, makeHand, type FaceSpec, type HandSpec } from './synthetic';

const FRAME = 1000 / 15; // the camera runs at about 15 pictures a second

const hand = (side: Side, spec: HandSpec = {}, score = 0.95): HandObs => ({ side, score, points: makeHand({ wrist: { x: side === 'right' ? 0.7 : 0.3, y: 0.85 }, ...spec }) });

interface Look {
  hands?: HandObs[];
  face?: Pt[] | null;
}

/** Feeds a tracker a scripted timeline, one picture every 1/15 s, and keeps everything it says. */
class Rig {
  tracker = new GestureTracker();
  t = 0;
  out: SignalOut[] = [];
  constructor(private readonly step = FRAME) {}
  frames(n: number, make: (i: number) => Look = () => ({})): this {
    for (let i = 0; i < n; i++) {
      const look = make(i);
      this.out.push(...this.tracker.update({ t_ms: this.t, hands: look.hands ?? [], face: look.face }));
      this.t += this.step;
    }
    return this;
  }
  /** [state, time] for each start/end of a moment. */
  edges(id: string): Array<[string | undefined, number]> {
    return this.out.filter((s) => s.id === id && s.kind === 'moment').map((s) => [s.state, Math.round(s.t_ms)]);
  }
  states(id: string): Array<string | undefined> {
    return this.edges(id).map(([s]) => s);
  }
  sliders(id: string): SignalOut[] {
    return this.out.filter((s) => s.id === id && s.kind === 'slider');
  }
}

const right = (spec?: HandSpec): Look => ({ hands: [hand('right', spec)] });

describe('holding a fist', () => {
  it('a fist held for one second starts once and ends once after it opens', () => {
    const rig = new Rig();
    rig.frames(15, () => right({ curl: 0 })); // 0 - 1 s open
    rig.frames(15, () => right({ curl: 1, thumb: 'tucked' })); // 1 - 2 s fist
    rig.frames(15, () => right({ curl: 0 })); // 2 - 3 s open
    const edges = rig.edges('vision.hand.right.fist');
    expect(edges.map(([s]) => s)).toEqual(['start', 'end']);
    expect(edges[0][1]).toBeGreaterThanOrEqual(1000);
    expect(edges[0][1]).toBeLessThanOrEqual(1200);
    expect(edges[1][1]).toBeGreaterThanOrEqual(2000);
    expect(edges[1][1]).toBeLessThanOrEqual(2300);
  });

  it('open palm switches on while the hand is open, off for the fist, and on again', () => {
    const rig = new Rig();
    rig.frames(15, () => right({ curl: 0 }));
    rig.frames(15, () => right({ curl: 1, thumb: 'tucked' }));
    rig.frames(15, () => right({ curl: 0 }));
    expect(rig.states('vision.hand.right.open_palm')).toEqual(['start', 'end', 'start']);
  });

  it('a fist does not also count as a pinch, even though the thumb is next to the index finger', () => {
    const rig = new Rig();
    rig.frames(15, () => right({ curl: 0 })).frames(30, () => right({ curl: 1, thumb: 'tucked' })).frames(15, () => right({ curl: 0 }));
    expect(rig.edges('vision.hand.right.pinch')).toEqual([]);
  });

  it('only the hand that did it reports it', () => {
    const rig = new Rig();
    rig.frames(30, () => ({ hands: [hand('right', { curl: 1, thumb: 'tucked' }), hand('left', { curl: 0 })] }));
    expect(rig.states('vision.hand.right.fist')).toEqual(['start']);
    expect(rig.edges('vision.hand.left.fist')).toEqual([]);
    expect(rig.states('vision.hand.left.open_palm')).toEqual(['start']);
  });

  it('does not flicker: a fist that flashes on every other picture never starts', () => {
    const rig = new Rig();
    rig.frames(30, (i) => right(i % 2 ? { curl: 1, thumb: 'tucked' } : { curl: 0 }));
    expect(rig.edges('vision.hand.right.fist')).toEqual([]);
  });

  it('does not flicker: one lost picture in the middle of a held fist does not end it', () => {
    const rig = new Rig();
    rig.frames(15, () => right({ curl: 1, thumb: 'tucked' }));
    rig.frames(1, () => ({})); // the camera lost the hand for a moment
    rig.frames(15, () => right({ curl: 1, thumb: 'tucked' }));
    expect(rig.states('vision.hand.right.fist')).toEqual(['start']);
  });

  it('a hand that really leaves ends the fist (after a short grace period)', () => {
    const rig = new Rig();
    rig.frames(15, () => right({ curl: 1, thumb: 'tucked' }));
    const left = rig.t;
    rig.frames(15, () => ({}));
    const edges = rig.edges('vision.hand.right.fist');
    expect(edges.map(([s]) => s)).toEqual(['start', 'end']);
    expect(edges[1][1] - left).toBeGreaterThanOrEqual(300);
    expect(edges[1][1] - left).toBeLessThanOrEqual(500);
  });

  it('wobbling between "nearly a fist" and "a fist" neither ends nor restarts it (the grey zone holds the old answer)', () => {
    const rig = new Rig();
    rig.frames(10, () => right({ curl: 1, thumb: 'tucked' }));
    rig.frames(20, (i) => right({ curl: i % 2 ? 0.4 : 0.55, thumb: 'tucked' }));
    expect(rig.states('vision.hand.right.fist')).toEqual(['start']);
    // and coming up from a loose hand into the grey zone does not start one
    const rig2 = new Rig();
    rig2.frames(10, () => right({ curl: 0.1 })).frames(20, () => right({ curl: 0.4 }));
    expect(rig2.edges('vision.hand.right.fist')).toEqual([]);
  });

  it('reset() ends anything still held, once, and forgets it', () => {
    const rig = new Rig();
    rig.frames(15, () => right({ curl: 1, thumb: 'tucked' }));
    const ended = rig.tracker.reset(5000);
    expect(ended.map((s) => [s.id, s.state, s.t_ms])).toEqual([['vision.hand.right.fist', 'end', 5000]]);
    expect(rig.tracker.reset(5100)).toEqual([]);
  });
});

describe('pinch, raised hand', () => {
  it('pinch starts when the thumb and index finger meet and ends when they part', () => {
    const rig = new Rig();
    rig.frames(10, () => right({ curl: 0.1 }));
    rig.frames(10, () => right({ curl: [0.45, 0.1, 0.1, 0.1], thumb: 'pinch' }));
    rig.frames(10, () => right({ curl: 0.1 }));
    expect(rig.states('vision.hand.right.pinch')).toEqual(['start', 'end']);
    expect(rig.edges('vision.hand.right.fist')).toEqual([]);
  });

  it('raised starts when the hand goes above the head and holds until it comes well down', () => {
    const face = makeFace({ center: { x: 0.5, y: 0.45 } }); // forehead line near 0.31
    const at = (wristY: number): Look => ({ hands: [hand('right', { curl: 0, wrist: { x: 0.7, y: wristY } })], face });
    const rig = new Rig();
    rig.frames(10, () => at(0.8)); // down
    rig.frames(10, () => at(0.3)); // up (palm near y = 0.21)
    rig.frames(10, () => at(0.43)); // palm near y = 0.34: just under the line, in the grey zone, still raised
    rig.frames(10, () => at(0.75)); // down again
    const edges = rig.edges('vision.hand.right.raised');
    expect(edges.map(([s]) => s)).toEqual(['start', 'end']);
    expect(edges[0][1]).toBeGreaterThanOrEqual(10 * FRAME);
    expect(edges[0][1]).toBeLessThanOrEqual(10 * FRAME + 200);
    expect(edges[1][1]).toBeGreaterThanOrEqual(30 * FRAME);
  });

  it('works without a face too (uses the top third of the picture)', () => {
    const rig = new Rig();
    rig.frames(10, () => right({ curl: 0, wrist: { x: 0.7, y: 0.25 } }));
    expect(rig.states('vision.hand.right.raised')).toEqual(['start']);
  });
});

describe('thumbs-up', () => {
  const left = (spec: HandSpec): Look => ({ hands: [hand('left', spec)] });
  /** A left thumbs-up whose thumb tip is `rise` hand-sizes above its middle joint (the helper's hand size is 0.12). */
  const thumbAt = (rise: number): Look => {
    const look = left({ curl: 1, thumb: 'up' });
    const pts = look.hands![0].points;
    pts[HAND.THUMB_TIP] = { x: pts[HAND.THUMB_IP].x, y: pts[HAND.THUMB_IP].y - rise * 0.12, z: 0 };
    return look;
  };

  it('starts at thumbUpOn, stays on in the gap, ends below thumbUpOff, and needs thumbUpOn again to restart', () => {
    const rig = new Rig();
    rig.frames(10, () => left({ curl: 1, thumb: 'tucked' })); // plain fist
    rig.frames(10, () => thumbAt(THRESHOLDS.thumbUpOn + 0.02)); // thumb up
    rig.frames(10, () => thumbAt((THRESHOLDS.thumbUpOn + THRESHOLDS.thumbUpOff) / 2)); // sags a little: still on
    rig.frames(10, () => thumbAt(THRESHOLDS.thumbUpOff - 0.03)); // thumb down: off
    rig.frames(10, () => thumbAt((THRESHOLDS.thumbUpOn + THRESHOLDS.thumbUpOff) / 2)); // back in the gap: stays off
    const edges = rig.edges('vision.hand.left.thumbs_up');
    expect(edges.map(([s]) => s)).toEqual(['start', 'end']);
    expect(edges[0][1]).toBeGreaterThanOrEqual(10 * FRAME);
    expect(edges[1][1]).toBeGreaterThanOrEqual(30 * FRAME);
    expect(rig.edges('vision.hand.left.open_palm')).toEqual([]);
  });

  it('a plain fist (thumb tucked) never starts a thumbs-up', () => {
    const rig = new Rig();
    rig.frames(30, () => left({ curl: 1, thumb: 'tucked' }));
    expect(rig.states('vision.hand.left.fist')).toEqual(['start']);
    expect(rig.edges('vision.hand.left.thumbs_up')).toEqual([]);
  });
});

describe('drum hit', () => {
  const wristAt = (y: number): Look => right({ curl: 0.2, wrist: { x: 0.7, y } });

  it('a quick downward move gives exactly one hit', () => {
    const rig = new Rig();
    rig.frames(8, () => wristAt(0.5));
    rig.frames(3, (i) => wristAt(0.5 + 0.06 * (i + 1))); // 0.06 per picture is about 7.5 hand-sizes a second
    rig.frames(8, () => wristAt(0.68));
    expect(rig.states('vision.hand.right.drum_hit')).toEqual(['start']);
    expect(rig.edges('vision.hand.left.drum_hit')).toEqual([]);
  });

  it('two hits a second apart give two hits', () => {
    const rig = new Rig();
    rig.frames(8, () => wristAt(0.4));
    rig.frames(3, (i) => wristAt(0.4 + 0.06 * (i + 1)));
    rig.frames(15, () => wristAt(0.58)); // a second of rest
    rig.frames(3, (i) => wristAt(0.58 - 0.06 * (i + 1))); // lifting is not a hit
    rig.frames(15, () => wristAt(0.4));
    rig.frames(3, (i) => wristAt(0.4 + 0.06 * (i + 1)));
    rig.frames(3, () => wristAt(0.58));
    expect(rig.states('vision.hand.right.drum_hit')).toEqual(['start', 'start']);
  });

  it('slowly lowering a hand is not a hit', () => {
    const rig = new Rig();
    rig.frames(40, (i) => wristAt(0.3 + 0.01 * i));
    expect(rig.edges('vision.hand.right.drum_hit')).toEqual([]);
  });

  it('jitter of the wrist is not a hit', () => {
    const rig = new Rig();
    rig.frames(40, (i) => wristAt(0.5 + (i % 2 ? 0.004 : -0.004)));
    expect(rig.edges('vision.hand.right.drum_hit')).toEqual([]);
  });
});

describe('head: tilt and nod', () => {
  const faceAt = (y: number, spec: FaceSpec = {}): Look => ({ face: makeFace({ center: { x: 0.5, y }, ...spec }) });

  it('tilt reports 0.5 upright, and the angle in degrees as raw', () => {
    const rig = new Rig();
    rig.frames(3, () => faceAt(0.4));
    rig.frames(3, () => faceAt(0.4, { tiltDeg: 20 }));
    const tilts = rig.sliders('vision.head.tilt');
    expect(tilts[0].value).toBeCloseTo(0.5, 3);
    expect(tilts[0].raw).toBeCloseTo(0, 1);
    expect(tilts[tilts.length - 1].value).toBeCloseTo(65 / 90, 2);
    expect(tilts[tilts.length - 1].raw).toBeCloseTo(20, 1);
    expect(tilts[0].confidence).toBeGreaterThan(0);
  });

  const NOD = [0.01, 0.03, 0.045, 0.04, 0.02, 0.005, 0, 0, 0, 0];

  it('a quick dip and return of the head is one nod', () => {
    const rig = new Rig();
    rig.frames(10, (i) => faceAt(0.4 + (i % 2 ? 0.001 : -0.001)));
    rig.frames(NOD.length, (i) => faceAt(0.4 + NOD[i]));
    rig.frames(10, () => faceAt(0.4));
    expect(rig.states('vision.head.nod')).toEqual(['start']);
  });

  it('two nods a couple of seconds apart are two nods', () => {
    const rig = new Rig();
    rig.frames(10, () => faceAt(0.4));
    rig.frames(NOD.length, (i) => faceAt(0.4 + NOD[i]));
    rig.frames(30, () => faceAt(0.4));
    rig.frames(NOD.length, (i) => faceAt(0.4 + NOD[i]));
    rig.frames(10, () => faceAt(0.4));
    expect(rig.states('vision.head.nod')).toEqual(['start', 'start']);
  });

  it('a slow lean toward the screen and back is not a nod', () => {
    const rig = new Rig();
    rig.frames(45, (i) => faceAt(0.4 + 0.1 * (i / 45)));
    rig.frames(45, (i) => faceAt(0.5 - 0.1 * (i / 45)));
    expect(rig.edges('vision.head.nod')).toEqual([]);
  });

  it('shaking the head from side to side is not a nod', () => {
    const rig = new Rig();
    rig.frames(45, (i) => ({ face: makeFace({ center: { x: 0.5 + 0.04 * Math.sin(i), y: 0.4 }, tiltDeg: 0 }) }));
    expect(rig.edges('vision.head.nod')).toEqual([]);
  });

  it('talking or small movements are not nods', () => {
    const rig = new Rig();
    rig.frames(60, (i) => faceAt(0.4 + 0.004 * Math.sin(i * 1.7)));
    expect(rig.edges('vision.head.nod')).toEqual([]);
  });
});

describe('sliders', () => {
  it('hand height and x follow the hand, using the user\'s left and right', () => {
    const rig = new Rig();
    rig.frames(5, () => ({ hands: [hand('right', { curl: 0, wrist: { x: 0.8, y: 0.6 } }), hand('left', { curl: 0, wrist: { x: 0.2, y: 0.9 } })] }));
    const r = rig.sliders('vision.hand.right.height').at(-1)!;
    const l = rig.sliders('vision.hand.left.height').at(-1)!;
    const rp = palmCenter(makeHand({ wrist: { x: 0.8, y: 0.6 } }));
    expect(r.value).toBeCloseTo(1 - rp.y, 2);
    expect(r.value).toBeGreaterThan(l.value!);
    expect(rig.sliders('vision.hand.right.x').at(-1)!.value).toBeGreaterThan(0.7);
    expect(rig.sliders('vision.hand.left.x').at(-1)!.value).toBeLessThan(0.3);
    expect(r.confidence).toBeCloseTo(0.95, 2);
  });

  it('two-hand distance is only sent when both hands are visible', () => {
    const rig = new Rig();
    rig.frames(5, () => right());
    expect(rig.sliders('vision.hands.distance')).toEqual([]);
    rig.frames(5, () => ({ hands: [hand('right', { wrist: { x: 0.7, y: 0.8 } }), hand('left', { wrist: { x: 0.3, y: 0.8 } })] }));
    const d = rig.sliders('vision.hands.distance').at(-1)!;
    expect(d.value).toBeCloseTo(0.5, 2); // 0.4 of the picture width, where 0.8 counts as far apart
    expect(d.raw).toBeCloseTo(0.4, 2);
  });

  it('nothing is sent about a hand that is not there', () => {
    const rig = new Rig();
    rig.frames(10, () => ({}));
    expect(rig.out).toEqual([]);
  });

  it('sliders are sent at most about 15 times a second, even if pictures arrive faster', () => {
    const rig = new Rig(1000 / 30);
    rig.frames(60, () => ({ hands: [hand('right')], face: makeFace() })); // 2 seconds at 30 pictures a second
    expect(rig.sliders('vision.hand.right.height').length).toBeLessThanOrEqual(31);
    expect(rig.sliders('vision.hand.right.height').length).toBeGreaterThanOrEqual(25);
    expect(rig.sliders('vision.head.tilt').length).toBeLessThanOrEqual(31);
  });

  it('values stay between 0 and 1', () => {
    const rig = new Rig();
    rig.frames(5, () => ({ hands: [hand('right', { wrist: { x: 0.99, y: 1.2 } }), hand('left', { wrist: { x: 0.01, y: -0.3 } })], face: makeFace({ tiltDeg: 80 }) }));
    for (const s of rig.out.filter((o) => o.kind === 'slider')) {
      expect(s.value).toBeGreaterThanOrEqual(0);
      expect(s.value).toBeLessThanOrEqual(1);
    }
  });
});

describe('everything in the signal catalog that vision promises', () => {
  const visionIds = signalCatalog.signals.filter((s) => s.source === 'vision').map((s) => s.id);

  it('both hands doing every gesture, plus a tilting, nodding head, produce every vision signal id and nothing else', () => {
    const rig = new Rig();
    const face = (y = 0.45, tiltDeg = 0) => makeFace({ center: { x: 0.5, y }, tiltDeg });
    const both = (spec: HandSpec): HandObs[] => [hand('right', spec), hand('left', spec)];
    const NOD = [0.01, 0.03, 0.045, 0.04, 0.02, 0.005, 0, 0];

    rig.frames(10, () => ({ hands: both({ curl: 0 }), face: face(0.45, 10) }));
    rig.frames(10, () => ({ hands: both({ curl: 1, thumb: 'tucked' }), face: face() }));
    // the catalog only has a left thumbs-up; the right hand holds a plain fist meanwhile
    rig.frames(10, () => ({ hands: [hand('right', { curl: 1, thumb: 'tucked' }), hand('left', { curl: 1, thumb: 'up' })], face: face() }));
    rig.frames(10, () => ({ hands: both({ curl: [0.45, 0.1, 0.1, 0.1], thumb: 'pinch' }), face: face() }));
    rig.frames(10, () => ({ hands: both({ curl: 0, wrist: { x: 0.7, y: 0.3 } }), face: face() }));
    rig.frames(6, () => ({ hands: both({ curl: 0.2, wrist: { x: 0.7, y: 0.5 } }), face: face() }));
    rig.frames(3, (i) => ({ hands: both({ curl: 0.2, wrist: { x: 0.7, y: 0.5 + 0.06 * (i + 1) } }), face: face() }));
    rig.frames(NOD.length, (i) => ({ hands: both({ curl: 0.2, wrist: { x: 0.7, y: 0.68 } }), face: face(0.45 + NOD[i]) }));
    rig.out.push(...rig.tracker.reset());

    // hand x differs per side in the helper; the drum hits above used x = 0.7 for both, which is fine for this check
    const emitted = new Set(rig.out.map((s) => s.id));
    expect([...emitted].sort()).toEqual([...visionIds].sort());

    const catalog = new Map(signalCatalog.signals.map((s) => [s.id, s]));
    for (const s of rig.out) {
      expect(s.kind).toBe(catalog.get(s.id)!.kind);
      expect(s.confidence).toBeGreaterThan(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
      if (s.kind === 'slider') expect(typeof s.value).toBe('number');
      else expect(['start', 'end']).toContain(s.state);
    }
    // only holdable moments ever send "end"
    for (const s of rig.out.filter((o) => o.state === 'end')) expect(catalog.get(s.id)!.holdable).toBe(true);
  });
});
