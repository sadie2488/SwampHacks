// Login settings: only a complete, plain answer from the server turns login on. Everything else means "off".
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAuthConfig, getAuthConfig, parseAuthConfig, resetAuthConfig } from './auth-config';

const answer = (body: unknown, init: ResponseInit = {}) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, ...init }));
const good = { auth0: { domain: 'tenant.example.test', client_id: 'test-client-id' } };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetAuthConfig();
});

describe('parseAuthConfig', () => {
  it('accepts a domain and a client id', () => {
    expect(parseAuthConfig(good)).toEqual({ domain: 'tenant.example.test', clientId: 'test-client-id' });
  });

  it('tidies a pasted address (https:// and a trailing slash) and spaces', () => {
    expect(parseAuthConfig({ auth0: { domain: ' https://tenant.example.test/ ', client_id: ' test-client-id ' } })).toEqual({
      domain: 'tenant.example.test',
      clientId: 'test-client-id',
    });
  });

  it.each([
    ['null body', null],
    ['not an object', 'nope'],
    ['no auth0 key', {}],
    ['auth0 null', { auth0: null }],
    ['both null', { auth0: { domain: null, client_id: null } }],
    ['domain missing', { auth0: { client_id: 'abc' } }],
    ['client id missing', { auth0: { domain: 'a.auth0.com' } }],
    ['domain blank', { auth0: { domain: '   ', client_id: 'abc' } }],
    ['client id blank', { auth0: { domain: 'a.auth0.com', client_id: '' } }],
    ['numbers', { auth0: { domain: 5, client_id: 6 } }],
    ['domain with a path', { auth0: { domain: 'a.auth0.com/evil', client_id: 'abc' } }],
    ['domain with spaces', { auth0: { domain: 'a b.auth0.com', client_id: 'abc' } }],
    ['client id with spaces', { auth0: { domain: 'a.auth0.com', client_id: 'a b' } }],
    ['arrays', { auth0: ['a.auth0.com', 'abc'] }],
  ])('turns login off for %s', (_name, body) => {
    expect(parseAuthConfig(body)).toBeNull();
  });
});

describe('fetchAuthConfig', () => {
  it('asks the config address and returns the settings', async () => {
    const fetchFn = vi.fn((_url: string, _init?: RequestInit) => answer(good));
    expect(await fetchAuthConfig({ fetchFn })).toEqual({ domain: 'tenant.example.test', clientId: 'test-client-id' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe('/api/config');
  });

  it('is off when both values are null or blank', async () => {
    expect(await fetchAuthConfig({ fetchFn: () => answer({ auth0: { domain: null, client_id: null } }) })).toBeNull();
    expect(await fetchAuthConfig({ fetchFn: () => answer({ auth0: { domain: '', client_id: ' ' } }) })).toBeNull();
  });

  it('is off, without throwing, when the server cannot be reached', async () => {
    expect(await fetchAuthConfig({ fetchFn: () => Promise.reject(new TypeError('Failed to fetch')) })).toBeNull();
  });

  it('is off for an error status and for an answer that is not JSON', async () => {
    expect(await fetchAuthConfig({ fetchFn: () => answer(good, { status: 500 }) })).toBeNull();
    expect(await fetchAuthConfig({ fetchFn: () => Promise.resolve(new Response('<html>', { status: 200 })) })).toBeNull();
  });

  it('gives up after 5 seconds even if the request ignores the abort signal', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchFn = vi.fn((_u: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {}); // never answers
    });
    let result: unknown = 'pending';
    void fetchAuthConfig({ fetchFn }).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(4999);
    expect(result).toBe('pending');
    await vi.advanceTimersByTimeAsync(2);
    expect(result).toBeNull();
    expect(signal?.aborted).toBe(true);
  });

  it('ignores an answer that arrives after the time is up', async () => {
    vi.useFakeTimers();
    let reply: (r: Response) => void = () => {};
    const fetchFn = () => new Promise<Response>((resolve) => (reply = resolve));
    let result: unknown = 'pending';
    void fetchAuthConfig({ fetchFn }).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(5001);
    reply(new Response(JSON.stringify(good)));
    await vi.advanceTimersByTimeAsync(10);
    expect(result).toBeNull();
  });
});

describe('getAuthConfig', () => {
  it('asks the server only once per page', async () => {
    const fetchMock = vi.fn(() => answer(good));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([getAuthConfig(), getAuthConfig()]);
    await getAuthConfig();
    expect(a).toEqual(b);
    expect(a?.domain).toBe('tenant.example.test');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
