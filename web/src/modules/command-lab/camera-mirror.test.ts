// @vitest-environment node
/// <reference types="node" />
// Guards the mirror convention of the camera panel by reading the stylesheet itself.
// The video must be flipped with CSS (the stream is unflipped); the overlay canvas and its wrapper must not be,
// because the vision module publishes the landmarks already mirrored. Flipping both draws the hands on the wrong side.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./command-lab.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

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

describe('camera panel mirroring (command-lab.css)', () => {
  it('flips the video with scaleX(-1)', () => {
    expect(bodyOf('.lab-camera video')).toMatch(/transform:\s*scaleX\(-1\)/);
  });

  it('does not flip the overlay canvas: its points are already mirrored', () => {
    expect(bodyOf('.lab-camera canvas')).not.toMatch(/scaleX/);
    expect(bodyOf('.lab-camera canvas')).not.toMatch(/transform/);
  });

  it('does not flip the wrapper that holds both (that would flip the canvas too)', () => {
    expect(bodyOf('.lab-camera')).not.toMatch(/scaleX/);
    expect(bodyOf('.lab-camera')).not.toMatch(/transform/);
  });

  it('has no other rule that mirrors anything inside the camera panel', () => {
    const flippers = rules.filter((r) => /scaleX/.test(r.body)).flatMap((r) => r.selectors);
    expect(flippers).toEqual(['.lab-camera video']);
  });
});
