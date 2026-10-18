// @vitest-environment jsdom
// apiFetch adds the login token only when there is one, and only for this site's own addresses.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, isSignedIn, setTokenProvider } from './api-fetch';
import { saveTrack } from '@/modules/create/api';
import { hasExpired, looksSigned, pickToken } from './auth-token';

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** A made-up signed-looking token (not a real one) that expires `secs` seconds from now. */
const jwt = (secs: number, extra = 'a') => `${b64({ alg: 'RS256' })}.${b64({ exp: Math.floor(Date.now() / 1000) + secs, x: extra })}.sig_${extra}`;

let fetchMock: ReturnType<typeof vi.fn>;
const headerOf = (call = 0) => new Headers((fetchMock.mock.calls[call][1] as RequestInit | undefined)?.headers).get('Authorization');

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(new Response('{}')));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  setTokenProvider(null);
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('passes the call through untouched when nobody is logged in', async () => {
    const init = { method: 'POST', body: 'x' };
    await apiFetch('/api/songs', init);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/songs');
    expect(fetchMock.mock.calls[0][1]).toBe(init);
    expect(isSignedIn()).toBe(false);
  });

  it('adds the Bearer header when a token exists, keeping the caller\'s other settings', async () => {
    setTokenProvider(async () => 'tok-1');
    await apiFetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(headerOf()).toBe('Bearer tok-1');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    expect(isSignedIn()).toBe(true);
  });

  it('works with no init at all', async () => {
    setTokenProvider(async () => 'tok-2');
    await apiFetch('/api/health');
    expect(headerOf()).toBe('Bearer tok-2');
  });

  it('sends no header when the token source has nothing, or fails', async () => {
    setTokenProvider(async () => null);
    await apiFetch('/api/a');
    setTokenProvider(async () => {
      throw new Error('login hiccup');
    });
    await apiFetch('/api/b');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headerOf(0)).toBeNull();
    expect(headerOf(1)).toBeNull();
  });

  it('stops adding it after logging out', async () => {
    setTokenProvider(async () => 'tok-3');
    await apiFetch('/api/a');
    setTokenProvider(null);
    await apiFetch('/api/b');
    expect(headerOf(0)).toBe('Bearer tok-3');
    expect(headerOf(1)).toBeNull();
  });

  it('keeps an Authorization header the caller already set', async () => {
    setTokenProvider(async () => 'tok-4');
    await apiFetch('/api/a', { headers: { Authorization: 'Basic abc' } });
    expect(headerOf()).toBe('Basic abc');
  });

  it('never sends the token to another site', async () => {
    const get = vi.fn(async () => 'tok-5');
    setTokenProvider(get);
    await apiFetch('https://other.example/api/a');
    await apiFetch('//other.example/api/b');
    expect(get).not.toHaveBeenCalled();
    expect(headerOf(0)).toBeNull();
    expect(headerOf(1)).toBeNull();
    await apiFetch(`${window.location.origin}/api/c`);
    expect(headerOf(2)).toBe('Bearer tok-5');
  });

  it('passes the server\'s answer back', async () => {
    fetchMock.mockResolvedValueOnce(new Response('hello', { status: 201 }));
    const res = await apiFetch('/api/x');
    expect(res.status).toBe(201);
    expect(await res.text()).toBe('hello');
  });
});

describe('pickToken', () => {
  const none = async () => undefined;

  it('uses a signed access token when there is one', async () => {
    const access = jwt(600, 'access');
    expect(await pickToken({ accessToken: async () => access, idToken: async () => ({ __raw: jwt(600, 'id') }) })).toBe(access);
  });

  it('uses the ID token when the access token is opaque (no audience)', async () => {
    const id = jwt(600, 'id');
    expect(await pickToken({ accessToken: async () => 'Zm9v_opaque-access-token', idToken: async () => ({ __raw: id }) })).toBe(id);
  });

  it('uses the ID token when there is no stored access token or looking it up fails', async () => {
    const id = jwt(600, 'id');
    expect(await pickToken({ accessToken: none, idToken: async () => ({ __raw: id }) })).toBe(id);
    expect(
      await pickToken({
        accessToken: async () => {
          throw new Error('login_required');
        },
        idToken: async () => ({ __raw: id }),
      }),
    ).toBe(id);
  });

  it('returns null when nothing is usable: no tokens, expired tokens, encrypted tokens, errors', async () => {
    expect(await pickToken({ accessToken: none, idToken: none })).toBeNull();
    expect(await pickToken({ accessToken: none, idToken: async () => ({ __raw: jwt(-30) }) })).toBeNull();
    expect(await pickToken({ accessToken: async () => jwt(-30), idToken: async () => ({ __raw: 'a.b.c.d.e' }) })).toBeNull();
    expect(
      await pickToken({
        accessToken: none,
        idToken: async () => {
          throw new Error('boom');
        },
      }),
    ).toBeNull();
  });

  it('does not ask Auth0 for new tokens while a stored one is still good', async () => {
    const refresh = vi.fn(async () => jwt(600, 'new'));
    const id = jwt(600, 'id');
    expect(await pickToken({ accessToken: none, idToken: async () => ({ __raw: id }), refresh })).toBe(id);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('asks Auth0 for new tokens when the stored ones ran out, then uses the renewed ID token', async () => {
    let stored = jwt(-30, 'old');
    const refresh = vi.fn(async () => {
      stored = jwt(600, 'renewed'); // Auth0 stores the new ID token as part of the refresh
      return 'Zm9v_opaque-access-token';
    });
    expect(await pickToken({ accessToken: none, idToken: async () => ({ __raw: stored }), refresh })).toBe(stored);
    expect(stored).toContain('.sig_renewed');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('uses a renewed signed access token straight away', async () => {
    const access = jwt(600, 'access');
    expect(await pickToken({ accessToken: none, idToken: none, refresh: async () => access })).toBe(access);
  });

  it('throws when the refresh fails (the login has ended)', async () => {
    const refresh = async () => {
      throw new Error('login_required');
    };
    await expect(pickToken({ accessToken: none, idToken: async () => ({ __raw: jwt(-30) }), refresh })).rejects.toThrow('login_required');
  });
});

describe('Create saves through apiFetch', () => {
  const track = { name: 'My track', tempo_bpm: 100, layers: [] };
  const created = () => Promise.resolve(new Response(JSON.stringify({ id: 'abc', name: 'My track', created_at: '' }), { status: 201 }));

  it('sends the Authorization header when a token exists', async () => {
    fetchMock.mockImplementation(created);
    setTokenProvider(async () => 'tok-create');
    expect(await saveTrack(track, { fetchFn: apiFetch })).toMatchObject({ ok: true, id: 'abc', local: false });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/creations');
    expect(headerOf()).toBe('Bearer tok-create');
    expect(new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers).get('Content-Type')).toBe('application/json');
  });

  it('still saves, with no header, when nobody is logged in', async () => {
    fetchMock.mockImplementation(created);
    expect(await saveTrack(track, { fetchFn: apiFetch })).toMatchObject({ ok: true, id: 'abc', local: false });
    expect(headerOf()).toBeNull();
  });
});

describe('token shape helpers', () => {
  it('knows signed tokens from opaque ones', () => {
    expect(looksSigned(jwt(60))).toBe(true);
    expect(looksSigned('opaque')).toBe(false);
    expect(looksSigned('a.b.c.d.e')).toBe(false);
    expect(looksSigned(undefined)).toBe(false);
  });

  it('reads the expiry', () => {
    expect(hasExpired(jwt(60))).toBe(false);
    expect(hasExpired(jwt(-60))).toBe(true);
    expect(hasExpired('a.b.c')).toBe(true);
  });
});
