// @vitest-environment jsdom
// Smoke test with the REAL Auth0 library (nothing replaced) against a made-up tenant that is never contacted:
// the login control starts, shows "Log in", saves the page to come back to, and handles a bad answer from Auth0.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginIsland } from './LoginIsland';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONFIG = { domain: 'tenant.example.test', clientId: 'test-client-id' };

let container: HTMLDivElement;
let root: Root;
const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 5))));
async function until(check: () => unknown, what: string) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await settle();
  }
  throw new Error(`timed out waiting for ${what}`);
}

beforeEach(() => {
  // jsdom has no crypto.subtle; the browser always does
  vi.stubGlobal('crypto', webcrypto);
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('with the real Auth0 library', () => {
  it('starts signed out and shows "Log in"', async () => {
    await act(async () => root.render(<LoginIsland config={CONFIG} />));
    await until(() => $('btn-login'), 'the Log in button');
    expect($('btn-login')?.textContent).toBe('Log in');
    expect($('btn-logout')).toBeNull();
    expect($('login-error')).toBeNull();
  });

  it('"Log in" saves the page to come back to (the browser is then sent to Auth0)', async () => {
    // jsdom cannot really navigate; it reports "not implemented" to the console, which is expected here
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.history.replaceState({}, '', '/?fake=1');
    await act(async () => root.render(<LoginIsland config={CONFIG} />));
    await until(() => $('btn-login'), 'the Log in button');
    await act(async () => void $('btn-login')!.click());
    await until(() => document.cookie.includes('a0.spajs.txs') || Object.keys(window.sessionStorage).some((k) => k.includes('a0.spajs.txs')), 'the saved login');
    const saved = decodeURIComponent(document.cookie) + Object.values(window.sessionStorage).join('');
    expect(saved).toContain('"returnTo":"/?fake=1"');
    expect($('login-error')).toBeNull();
  });

  it('a bad answer from Auth0 (no matching login in progress) shows a plain message and cleans the address bar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.history.replaceState({}, '', '/?fake=1&code=abc&state=not-ours');
    await act(async () => root.render(<LoginIsland config={CONFIG} />));
    await until(() => $('login-error'), 'the message');
    expect($('login-error')?.textContent).toMatch(/did not work/i);
    expect($('btn-login')).not.toBeNull();
    expect(window.location.search).toBe('?fake=1');
  });
});
