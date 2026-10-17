// @vitest-environment node
/// <reference types="node" />
// Guards the mirror rule of the "see yourself" preview by reading the stylesheet itself.
// The video must be flipped with CSS (the camera stream is unflipped). The overlay canvas and the frame that holds both
// must not be: the vision module publishes the landmarks already mirrored, so a second flip draws the hands on the wrong side.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every rule in the stylesheet as { selectors, body }, with comments already removed. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
  body: m[2],
}));

/** The declarations of all rules that name exactly this selector (alone or in a list). */
const bodyOf = (selector: string) =>
  rules
    .filter((r) => r.selectors.includes(selector))
    .map((r) => r.body)
    .join(';');

describe('camera preview mirroring (styles.css)', () => {
  it('flips the video with scaleX(-1)', () => {
    expect(bodyOf('.camera-preview-video')).toMatch(/transform:\s*scaleX\(-1\)/);
  });

  it('does not flip the overlay canvas: its points are already mirrored', () => {
    expect(bodyOf('.camera-preview-overlay')).not.toMatch(/scaleX/);
    expect(bodyOf('.camera-preview-overlay')).not.toMatch(/transform/);
  });

  it('does not flip the frame or the wrapper that hold both (that would flip the canvas too)', () => {
    for (const selector of ['.camera-preview-frame', '.camera-preview']) {
      expect(bodyOf(selector), selector).not.toMatch(/scaleX/);
      expect(bodyOf(selector), selector).not.toMatch(/transform/);
    }
  });

  it('has no other rule in the app stylesheet that mirrors anything', () => {
    const flippers = rules.filter((r) => /scale[XY]?\(\s*-/.test(r.body)).flatMap((r) => r.selectors);
    expect(flippers).toEqual(['.camera-preview-video']);
  });

  it('keeps the preview small: at most 320px wide, with a thin border', () => {
    expect(bodyOf('.camera-preview')).toMatch(/max-width:\s*320px/);
    expect(bodyOf('.camera-preview-frame')).toMatch(/border:\s*1px solid/);
  });
});
