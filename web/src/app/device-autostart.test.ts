import { afterEach, describe, expect, it, vi } from 'vitest';
import { alreadyAllowed, mayAutostart } from './device-autostart';

describe('camera and microphone autostart', () => {
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
    expect(await alreadyAllowed('camera')).toBe(true);
    query.mockResolvedValueOnce({ state: 'prompt' });
    expect(await alreadyAllowed('camera')).toBe(false);
    query.mockRejectedValueOnce(new TypeError('camera is not a permission name'));
    expect(await alreadyAllowed('camera')).toBe(false);
    query.mockResolvedValueOnce({ state: 'granted' });
    expect(await alreadyAllowed('microphone')).toBe(true);
    expect(query).toHaveBeenLastCalledWith({ name: 'microphone' });
    vi.stubGlobal('navigator', {});
    expect(await alreadyAllowed('camera')).toBe(false);
  });
});
