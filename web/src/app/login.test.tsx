// @vitest-environment jsdom
// The login control in a fake page. The Auth0 library is replaced by a stand-in whose state each test sets;
// the server answer is a fake `fetch`. Nothing here talks to Auth0 or to a server.
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, isSignedIn } from './api-fetch';
import { fetchAuthConfig, type AuthConfig } from './auth-config';
import { AuthGate } from './AuthGate';
import { LoginButton } from './LoginButton';

type Props = { domain: string; clientId: string; cacheLocation?: string; authorizationParams?: { redirect_uri?: string }; onRedirectCallback?: (a?: { returnTo?: unknown }) => void };

const auth0 = vi.hoisted(() => ({
  providerProps: [] as Props[],
  providerThrows: false,
  state: {} as Record<string, unknown>,
}));

vi.mock('@auth0/auth0-react', async () => {
  const { createElement, Fragment } = await import('react');
  return {
    Auth0Provider: (props: Props & { children: unknown }) => {
      if (auth0.providerThrows) throw new Error('provider failed to start');
      auth0.providerProps.push(props);
      return createElement(Fragment, null, props.children as never);
    },
    useAuth0: () => auth0.state,
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONFIG: AuthConfig = { domain: 'tenant.example.test', clientId: 'test-client-id' };
const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const idToken = (extra: string) => `${b64({ alg: 'RS256' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 600, extra })}.sig`;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const settle = (ms = 5) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
async function until(check: () => unknown, what: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await settle();
  }
  throw new Error(`timed out waiting for ${what}`);
}

function setAuth0(patch: Record<string, unknown>) {
  Object.assign(auth0.state, patch);
}
const freshAuth0 = () => {
  auth0.providerProps = [];
  auth0.providerThrows = false;
  auth0.state = {
    isLoading: false,
    isAuthenticated: false,
    user: undefined,
    error: undefined,
    loginWithRedirect: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    getAccessTokenSilently: vi.fn(async () => undefined),
    getIdTokenClaims: vi.fn(async () => undefined),
  };
};

const tree = (load: () => Promise<AuthConfig | null>) => (
  <AuthGate load={load}>
    <div data-testid="app-child" />
    <LoginButton />
  </AuthGate>
);
const show = (load: () => Promise<AuthConfig | null> = async () => CONFIG) => act(async () => root.render(tree(load)));
const configFrom = (body: unknown, status = 200) => () => fetchAuthConfig({ fetchFn: () => Promise.resolve(new Response(JSON.stringify(body), { status })) });

beforeEach(() => {
  freshAuth0();
  window.history.replaceState({}, '', '/');
  fetchMock = vi.fn(() => Promise.resolve(new Response('{}')));
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
});

describe('login is hidden unless it is set up', () => {
  it.each([
    ['null values', configFrom({ auth0: { domain: null, client_id: null } })],
    ['blank values', configFrom({ auth0: { domain: '  ', client_id: '' } })],
    ['only a domain', configFrom({ auth0: { domain: 'tenant.example.test', client_id: null } })],
    ['only a client id', configFrom({ auth0: { domain: null, client_id: 'test-client-id' } })],
    ['a server error', configFrom({ detail: 'broken' }, 500)],
    ['no server', () => fetchAuthConfig({ fetchFn: () => Promise.reject(new TypeError('Failed to fetch')) })],
  ])('shows nothing for %s', async (_name, load) => {
    await show(load);
    await settle(30);
    expect($('app-child')).not.toBeNull();
    expect($('btn-login')).toBeNull();
    expect($('btn-logout')).toBeNull();
    expect($('login-user')).toBeNull();
    expect(container.querySelector('.login-box')).toBeNull();
    expect(auth0.providerProps).toHaveLength(0);
    expect(isSignedIn()).toBe(false);
  });

  it('shows nothing, and starts no Auth0 code, when the server is too slow (5 seconds)', async () => {
    vi.useFakeTimers();
    const load = () => fetchAuthConfig({ fetchFn: () => new Promise<Response>(() => {}) });
    await show(load);
    await act(async () => void (await vi.advanceTimersByTimeAsync(4000)));
    expect($('btn-login')).toBeNull();
    await act(async () => void (await vi.advanceTimersByTimeAsync(1500)));
    vi.useRealTimers();
    await settle(30);
    expect($('app-child')).not.toBeNull();
    expect(container.querySelector('.login-box')).toBeNull();
    expect(auth0.providerProps).toHaveLength(0);
  });

  it('shows nothing while the answer is still on its way', async () => {
    await show(() => new Promise<AuthConfig | null>(() => {}));
    await settle(30);
    expect(container.querySelector('.login-box')).toBeNull();
    expect($('app-child')).not.toBeNull();
  });

  it('shows nothing when there is no AuthGate at all (existing tests and pages keep working)', async () => {
    await act(async () => root.render(<LoginButton />));
    await settle(30);
    expect(container.innerHTML).toBe('');
  });
});

describe('login when it is set up', () => {
  it('hands the public values to Auth0 and shows "Log in" when signed out', async () => {
    await show();
    await until(() => $('btn-login'), 'the Log in button');
    expect($('btn-login')?.textContent).toBe('Log in');
    expect($('btn-logout')).toBeNull();
    expect($('login-user')).toBeNull();
    const props = auth0.providerProps[0];
    expect(props.domain).toBe('tenant.example.test');
    expect(props.clientId).toBe('test-client-id');
    expect(props.authorizationParams?.redirect_uri).toBe(window.location.origin);
    expect(props.cacheLocation).toBe('localstorage');
  });

  it('keeps the login in memory when the browser blocks storage', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    await show();
    await until(() => $('btn-login'), 'the Log in button');
    expect(auth0.providerProps[0].cacheLocation).toBe('memory');
  });

  it('starts the login, remembering this page and its settings (like ?fake=1)', async () => {
    window.history.replaceState({}, '', '/?fake=1');
    await show();
    await until(() => $('btn-login'), 'the Log in button');
    await act(async () => void $('btn-login')!.click());
    expect(auth0.state.loginWithRedirect).toHaveBeenCalledWith({ appState: { returnTo: '/?fake=1' } });
  });

  it('says in plain words when login cannot start', async () => {
    setAuth0({ loginWithRedirect: vi.fn(async () => Promise.reject(new Error('crypto is missing'))) });
    await show();
    await until(() => $('btn-login'), 'the Log in button');
    await act(async () => void $('btn-login')!.click());
    const message = $('login-error')?.textContent ?? '';
    expect(message).toMatch(/could not start/i);
    expect(message).not.toMatch(/crypto/);
    expect($('btn-login')).not.toBeNull();
  });

  it('explains when the page is not secure (login cannot work there)', async () => {
    vi.stubGlobal('isSecureContext', false);
    setAuth0({ loginWithRedirect: vi.fn(async () => Promise.reject(new Error('crypto is missing'))) });
    await show();
    await until(() => $('btn-login'), 'the Log in button');
    await act(async () => void $('btn-login')!.click());
    expect($('login-error')?.textContent).toMatch(/secure page/i);
  });

  it('shows a quiet "checking" note while Auth0 is still working', async () => {
    setAuth0({ isLoading: true });
    await show();
    await until(() => $('login-status'), 'the checking note');
    expect($('btn-login')).toBeNull();
    expect($('btn-logout')).toBeNull();
  });
});

describe('signed in', () => {
  beforeEach(() => {
    setAuth0({ isAuthenticated: true, user: { name: 'Sam Rivera', email: 'sam@example.test' } });
  });

  it('greets the person and offers "Log out"', async () => {
    await show();
    await until(() => $('login-user'), 'the greeting');
    expect($('login-user')?.textContent).toBe('Hi Sam Rivera');
    expect($('btn-logout')?.textContent).toBe('Log out');
    expect($('btn-login')).toBeNull();
  });

  it('falls back to the nickname, the email, then a generic greeting; long names are cut short', async () => {
    setAuth0({ user: { nickname: 'sam' } });
    await show();
    await until(() => $('login-user'), 'the greeting');
    expect($('login-user')?.textContent).toBe('Hi sam');
    setAuth0({ user: { email: 'sam@example.test' } });
    await show();
    expect($('login-user')?.textContent).toBe('Hi sam@example.test');
    setAuth0({ user: {} });
    await show();
    expect($('login-user')?.textContent).toBe('Hi there');
    setAuth0({ user: { name: 'x'.repeat(100) } });
    await show();
    expect($('login-user')?.textContent?.length).toBeLessThan(50);
  });

  it('logs out and comes back to this site', async () => {
    await show();
    await until(() => $('btn-logout'), 'the Log out button');
    await act(async () => void $('btn-logout')!.click());
    expect(auth0.state.logout).toHaveBeenCalledWith({ logoutParams: { returnTo: window.location.origin } });
  });

  it('lets apiFetch add the ID token (the access token here has no audience, so it is not a signed one)', async () => {
    const id = idToken('one');
    setAuth0({ getAccessTokenSilently: vi.fn(async () => 'opaque-access-token'), getIdTokenClaims: vi.fn(async () => ({ __raw: id })) });
    await show();
    await until(() => isSignedIn(), 'the token source');
    await apiFetch('/api/sessions');
    const headers = new Headers((fetchMock.mock.calls.at(-1)![1] as RequestInit).headers);
    expect(headers.get('Authorization')).toBe(`Bearer ${id}`);
    // it only reads what the login already stored; it never asks Auth0 over the network
    expect(auth0.state.getAccessTokenSilently).toHaveBeenCalledWith({ cacheMode: 'cache-only' });
  });

  it('uses a signed access token when the login has one', async () => {
    const access = idToken('access');
    setAuth0({ getAccessTokenSilently: vi.fn(async () => access), getIdTokenClaims: vi.fn(async () => ({ __raw: idToken('id') })) });
    await show();
    await until(() => isSignedIn(), 'the token source');
    await apiFetch('/api/sessions');
    expect(new Headers((fetchMock.mock.calls.at(-1)![1] as RequestInit).headers).get('Authorization')).toBe(`Bearer ${access}`);
  });

  it('stops adding the token as soon as the person is signed out', async () => {
    setAuth0({ getIdTokenClaims: vi.fn(async () => ({ __raw: idToken('one') })) });
    await show();
    await until(() => isSignedIn(), 'the token source');
    setAuth0({ isAuthenticated: false, user: undefined });
    await show();
    await until(() => $('btn-login'), 'the Log in button');
    expect(isSignedIn()).toBe(false);
    await apiFetch('/api/sessions');
    expect((fetchMock.mock.calls.at(-1)![1] as RequestInit | undefined)?.headers).toBeUndefined();
  });

  it('stops adding the token when the page part is removed', async () => {
    setAuth0({ getIdTokenClaims: vi.fn(async () => ({ __raw: idToken('one') })) });
    await show();
    await until(() => isSignedIn(), 'the token source');
    await act(async () => root.render(<div />));
    expect(isSignedIn()).toBe(false);
  });
});

describe('coming back from Auth0', () => {
  it('after a good login, restores the saved page and removes ?code and ?state from the address bar', async () => {
    window.history.replaceState({}, '', '/?code=abc&state=xyz');
    await show();
    await until(() => auth0.providerProps.length > 0, 'the provider');
    auth0.providerProps[0].onRedirectCallback?.({ returnTo: '/?fake=1' });
    expect(window.location.pathname + window.location.search).toBe('/?fake=1');
  });

  it('without a saved page, keeps the other settings and drops only the answer from Auth0', async () => {
    window.history.replaceState({}, '', '/?fake=1&code=abc&state=xyz#top');
    await show();
    await until(() => auth0.providerProps.length > 0, 'the provider');
    auth0.providerProps[0].onRedirectCallback?.({});
    expect(window.location.search).toBe('?fake=1');
    expect(window.location.hash).toBe('#top');
  });

  it.each(['//other.example/steal', 'https://other.example/', '\\\\other.example', 42, undefined])('ignores a saved page that leaves this site (%s)', async (returnTo) => {
    window.history.replaceState({}, '', '/?code=abc&state=xyz');
    await show();
    await until(() => auth0.providerProps.length > 0, 'the provider');
    auth0.providerProps[0].onRedirectCallback?.({ returnTo });
    expect(window.location.origin).toBe('http://localhost:3000');
    expect(window.location.search).toBe('');
  });

  it('after a refused login, cleans the address bar and says so in plain words', async () => {
    window.history.replaceState({}, '', '/?fake=1&error=access_denied&error_description=User%20said%20no&state=xyz');
    setAuth0({ error: Object.assign(new Error('User said no'), { error: 'access_denied' }) });
    await show();
    await until(() => $('login-error'), 'the message');
    expect($('login-error')?.textContent).toMatch(/cancelled or not allowed/i);
    expect($('login-error')?.textContent).not.toMatch(/User said no/);
    expect(window.location.search).toBe('?fake=1');
    expect($('btn-login')).not.toBeNull();
  });

  it('after any other login failure, also cleans up and offers to try again', async () => {
    window.history.replaceState({}, '', '/?code=abc&state=stale');
    setAuth0({ error: new Error('Invalid state') });
    await show();
    await until(() => $('login-error'), 'the message');
    expect($('login-error')?.textContent).toMatch(/did not work/i);
    expect($('login-error')?.textContent).not.toMatch(/Invalid state/);
    expect(window.location.search).toBe('');
    expect($('btn-login')).not.toBeNull();
  });

  it('leaves an unrelated ?code= alone when there is no login answer (no state)', async () => {
    window.history.replaceState({}, '', '/?code=mine');
    setAuth0({ error: new Error('something') });
    await show();
    await until(() => $('login-error'), 'the message');
    expect(window.location.search).toBe('?code=mine');
  });
});

describe('the rest of the page', () => {
  it('is not rebuilt when the login answer arrives (a mount counter stays at 1)', async () => {
    let mounts = 0;
    let unmounts = 0;
    function Child() {
      useEffect(() => {
        mounts++;
        return () => void unmounts++;
      }, []);
      return <div data-testid="app-child" />;
    }
    let answer: (c: AuthConfig | null) => void = () => {};
    const load = () => new Promise<AuthConfig | null>((resolve) => (answer = resolve));
    const withChild = (
      <AuthGate load={load}>
        <Child />
        <LoginButton />
      </AuthGate>
    );
    await act(async () => root.render(withChild));
    const before = $('app-child');
    expect(mounts).toBe(1);
    expect($('btn-login')).toBeNull();

    await act(async () => answer(CONFIG));
    await until(() => $('btn-login'), 'the Log in button');

    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
    expect($('app-child')).toBe(before); // the very same page element, not a new one
  });

  it('is not rebuilt either when the answer is "no login"', async () => {
    let mounts = 0;
    function Child() {
      useEffect(() => void mounts++, []);
      return <div data-testid="app-child" />;
    }
    let answer: (c: AuthConfig | null) => void = () => {};
    const load = () => new Promise<AuthConfig | null>((resolve) => (answer = resolve));
    await act(async () => root.render(<AuthGate load={load}><Child /><LoginButton /></AuthGate>));
    await act(async () => answer(null));
    await settle(30);
    expect(mounts).toBe(1);
    expect(container.querySelector('.login-box')).toBeNull();
  });

  it('survives the login code crashing: a message appears and the rest stays', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    auth0.providerThrows = true;
    await show();
    await until(() => $('login-unavailable'), 'the message');
    expect($('login-unavailable')?.textContent).toMatch(/not available right now/i);
    expect($('app-child')).not.toBeNull();
  });
});
