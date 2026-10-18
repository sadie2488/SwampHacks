// Where each record sits in the menu: on a rising diagonal, the chosen one bigger and flatter (facing you).
// Numbers from the Overture mockup's arrangement (discSize 540, spacing 1.15, rise .38, row angle 6 deg, tilts 52/22).

export interface RecordPlace {
  /** Centre of the record, in pixels from the top-left of the window. */
  x: number;
  y: number;
  /** Size of the record before scaling, in pixels. */
  size: number;
  scale: number;
  /** How far it lies back (degrees). */
  tilt: number;
  /** Turn of the whole row (degrees). */
  turn: number;
  opacity: number;
  z: number;
}

const ROW = { x: 0.53, y: 0.52, spacing: 1.15, rise: 0.38, angleDeg: 6, tilt: 52, chosenTilt: 22 };

/** The record's size: as in the mockup on a big screen, smaller so it always fits a short or narrow window. */
export function recordSize(w: number, h: number): number {
  return Math.round(Math.max(160, Math.min(540, h * 0.6, (w * 0.78) / 1.25)));
}

/** Where the record `offset` places away from the chosen one sits (offset 0 = the chosen record). */
export function recordPlace(offset: number, w: number, h: number): RecordPlace {
  const size = recordSize(w, h);
  const sp = size * ROW.spacing;
  const near = Math.max(0, 1 - Math.abs(offset));
  const ra = (ROW.angleDeg * Math.PI) / 180;
  const ox = offset * sp;
  const oy = -offset * sp * ROW.rise;
  const narrow = w < 700;
  return {
    x: w * (narrow ? 0.5 : ROW.x) + ox * Math.cos(ra) - oy * Math.sin(ra),
    y: h * (narrow ? 0.47 : ROW.y) + ox * Math.sin(ra) + oy * Math.cos(ra),
    size,
    scale: 0.8 + 0.45 * near,
    tilt: ROW.tilt + (ROW.chosenTilt - ROW.tilt) * near,
    turn: -14 + ROW.angleDeg,
    opacity: Math.max(0.15, 1 - Math.abs(offset) * 0.35),
    z: 10 - Math.round(Math.abs(offset)),
  };
}

/** Where the two giant lines go around the chosen record: a small step off its centre, alternating sides. */
export function bigWordPlaces(index: number, w: number, h: number) {
  const p = recordPlace(0, w, h);
  const width = p.size * p.scale;
  const height = width * Math.cos((p.tilt * Math.PI) / 180);
  const side = index % 2 === 0 ? 1 : -1;
  const off = width * 0.12;
  return {
    side,
    back: { x: p.x - side * off, y: p.y - height * 0.38 },
    front: { x: p.x + side * off, y: p.y + height * 0.26 },
    /** The hole's radius on screen (the record is 220 units across, the hole 14). */
    hole: (width * 14) / 220,
    centre: { x: p.x, y: p.y },
  };
}

/** Font size for a giant line: as big as the design allows, smaller for long lines so they fit the window. */
export function bigWordSize(text: string, w: number): number {
  const max = Math.min(300, Math.max(80, w * 0.15));
  const fit = ((w * 0.8) / Math.max(1, text.length * 0.52)) * 1;
  return Math.round(Math.min(max, fit));
}
