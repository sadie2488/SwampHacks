import { describe, expect, it } from 'vitest';
import { fitWholeSystems, systemTopFor } from './sheet-systems';

describe('the sheet band shows whole systems', () => {
  const tops = [20, 140, 260, 380];

  it('takes as many whole systems as fit', () => {
    expect(fitWholeSystems(tops, 300)).toBe(260);
    expect(fitWholeSystems(tops, 500)).toBe(380);
  });

  it('keeps at least one system even when the band is short (the 193 px case)', () => {
    expect(fitWholeSystems(tops, 193)).toBe(140);
    expect(fitWholeSystems(tops, 50)).toBe(140);
  });

  it('leaves the band alone when there is only one system or no room is known', () => {
    expect(fitWholeSystems([20], 300)).toBeNull();
    expect(fitWholeSystems(tops, 0)).toBeNull();
  });

  it('turns the page to the top of the system holding the cursor', () => {
    expect(systemTopFor(tops, 150)).toBe(140);
    expect(systemTopFor(tops, 20)).toBe(20);
    expect(systemTopFor(tops, 5)).toBe(0);
    expect(systemTopFor([], 150)).toBeNull();
  });
});
