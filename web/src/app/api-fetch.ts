// `apiFetch(path, init)` is `fetch` for this app's own server: it adds `Authorization: Bearer <token>` while someone is
// logged in, and does nothing special otherwise (no login, logged out, token expired, or login not set up at all).
//
//   import { apiFetch } from './api-fetch';
//   const res = await apiFetch('/api/sessions', { method: 'POST', body: JSON.stringify(data) });
//
// The token goes only to this site's own address, never to another site, and an Authorization header the caller
// already set is left alone. The login button registers the token source below; other code never touches tokens.

export type TokenProvider = () => Promise<string | null>;

let provider: TokenProvider | null = null;

/** Used by the login button when someone logs in (a function) or out (null). */
export function setTokenProvider(next: TokenProvider | null): void {
  provider = next;
}

/** True while someone is logged in. Handy for hiding things that only make sense when signed in. */
export function isSignedIn(): boolean {
  return provider !== null;
}

function isOwnSite(path: string): boolean {
  try {
    return new URL(path, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

async function currentToken(path: string): Promise<string | null> {
  const get = provider;
  if (!get || !isOwnSite(path)) return null;
  try {
    return await get();
  } catch {
    return null; // a login hiccup must never break a normal request
  }
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await currentToken(path);
  if (!token) return fetch(path, init);
  const headers = new Headers(init?.headers);
  if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  return fetch(path, { ...init, headers });
}
