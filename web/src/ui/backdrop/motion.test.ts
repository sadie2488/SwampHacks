import { describe, expect, it } from 'vitest';
import { beatKick, frameDue, MAX_FPS, phaseNow, sceneWanted } from './motion';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

describe('sceneWanted', () => {
  it('draws the scene in a normal browser', () => {
    expect(sceneWanted('', CHROME)).toBe(true);
    expect(sceneWanted('?fake=1', CHROME)).toBe(true);
  });

  it('can be switched off from the address', () => {
    expect(sceneWanted('?scene=off', CHROME)).toBe(false);
    expect(sceneWanted('?fake=1&scene=OFF', CHROME)).toBe(false);
    expect(sceneWanted('?scene=0', CHROME)).toBe(false);
    expect(sceneWanted('?scene=on', CHROME)).toBe(true);
  });

  it('stays off in the unit tests pretend browser', () => {
    expect(sceneWanted('', 'Mozilla/5.0 (win32) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/25.0.1')).toBe(false);
  });
});

describe('phaseNow', () => {
  it('moves the beat forward by the time since the last message', () => {
    // 120 bpm = 2 beats a second, so 125 ms is a quarter of a beat
    expect(phaseNow(0.5, 120, 125)).toBeCloseTo(0.75);
    expect(phaseNow(0.9, 120, 125)).toBeCloseTo(0.15);
  });

  it('keeps the phase as is when the tempo is unknown or time went backwards', () => {
    expect(phaseNow(0.3, 0, 500)).toBeCloseTo(0.3);
    expect(phaseNow(0.3, Number.NaN, 500)).toBeCloseTo(0.3);
    expect(phaseNow(0.3, 120, -50)).toBeCloseTo(0.3);
    expect(phaseNow(Number.NaN, 120, 50)).toBe(0);
  });
});

describe('beatKick', () => {
  it('is strongest on the beat and fades to nothing', () => {
    expect(beatKick(0)).toBe(1);
    expect(beatKick(0.5)).toBeCloseTo(0.125);
    expect(beatKick(1)).toBe(0);
    expect(beatKick(-3)).toBe(1);
    expect(beatKick(0.2)).toBeGreaterThan(beatKick(0.4));
  });
});

describe('frameDue', () => {
  it('limits drawing to about the given frame rate', () => {
    expect(frameDue(1000, 1000, MAX_FPS)).toBe(false);
    expect(frameDue(1020, 1000, MAX_FPS)).toBe(false);
    expect(frameDue(1032, 1000, MAX_FPS)).toBe(true);
  });
});
