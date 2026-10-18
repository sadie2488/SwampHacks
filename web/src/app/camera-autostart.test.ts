import { afterEach, describe, expect, it, vi } from 'vitest';
import { cameraAlreadyAllowed, mayAutostart } from './camera-autostart';

describe('camera autostart', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('never starts in automated test browsers or on the entrance', () => {
    expect(mayAutostart({ webdriver: true, screen: 'menu' })).toBe(false);
    expect(mayAutostart({ webdriver: false, screen: 'entrance' })).toBe(false);
    expect(mayAutostart({ webdriver: false, screen: 'menu' })).toBe(true);
    expect(mayAutostart({ webdriver: false, screen: 'mode' })).toBe(true);
  });

  it('trusts only an explicit "granted"', async () => {
    const query = vi.fn();
    vi.stubGlobal('navigator', { permissions: { query } });
    query.mockResolvedValueOnce({ state: 'granted' });
    expect(await cameraAlreadyAllowed()).toBe(true);
    query.mockResolvedValueOnce({ state: 'prompt' });
    expect(await cameraAlreadyAllowed()).toBe(false);
    query.mockRejectedValueOnce(new TypeError('camera is not a permission name'));
    expect(await cameraAlreadyAllowed()).toBe(false);
    vi.stubGlobal('navigator', {});
    expect(await cameraAlreadyAllowed()).toBe(false);
  });
});
