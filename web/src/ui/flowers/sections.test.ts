import { describe, expect, it } from 'vitest';
import { collectFlowers, SECTION_FLOWERS, SECTIONS, STATES } from './sections';

const placeholders = {
  './sections/learn/open.svg': 'p-open',
  './sections/learn/open-fill.svg': 'p-open-fill',
  './sections/learn/half.svg': 'p-half',
  './sections/learn/half-fill.svg': 'p-half-fill',
};

describe('section flowers', () => {
  it('has a line picture for every section and state (the placeholders)', () => {
    for (const s of SECTIONS) for (const st of STATES) expect(SECTION_FLOWERS[s][st].line).toBeTruthy();
  });

  it('uses the placeholders when nothing is drawn', () => {
    const f = collectFlowers(placeholders, {});
    expect(f.learn.open).toEqual({ line: 'p-open', fill: 'p-open-fill' });
  });

  it('lets a dropped-in drawing win, with or without its own fill', () => {
    const f = collectFlowers(placeholders, {
      './drawn/learn-forgetmenot-open.png': 'd-open',
      './drawn/learn-forgetmenot-open-fill.png': 'd-open-fill',
      './drawn/learn-forgetmenot-half.png': 'd-half',
    });
    expect(f.learn.open).toEqual({ line: 'd-open', fill: 'd-open-fill' });
    // her line without a fill file: the placeholder fill must not show under it
    expect(f.learn.half).toEqual({ line: 'd-half' });
  });

  it('accepts flower names with dashes and any case, and ignores unknown names', () => {
    const f = collectFlowers({}, {
      './drawn/Play-Bird-of-Paradise-OPEN.png': 'bop',
      './drawn/kitchen-rose-open.png': 'nope',
      './drawn/lab-iris-wide.png': 'nope',
    });
    expect(f.play.open.line).toBe('bop');
    expect(JSON.stringify(f)).not.toContain('nope');
  });
});
