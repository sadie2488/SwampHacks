// Login settings. The server says which Auth0 tenant to use; login stays off unless both public values are there.

export type AuthConfig = { domain: string; clientId: string };
type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export const CONFIG_URL = '/api/config';
export const CONFIG_TIMEOUT_MS = 5000;

const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:\d{1,5})?$/;
const CLIENT_ID = /^[A-Za-z0-9_.~-]{1,256}$/;

/** `{"auth0": {"domain": "...", "client_id": "..."}}` -> the two values, or null when login is not fully set up. */
export function parseAuthConfig(body: unknown): AuthConfig | null {
  const auth0 = (body as { auth0?: unknown } | null)?.auth0;
  if (auth0 === null || typeof auth0 !== 'object') return null;
  const { domain, client_id: clientId } = auth0 as { domain?: unknown; client_id?: unknown };
  if (typeof domain !== 'string' || typeof clientId !== 'string') return null;
  // People paste the address with https:// and a trailing slash; accept that, but only a plain host name.
  const host = domain.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const id = clientId.trim();
  if (!HOST.test(host) || !CLIENT_ID.test(id)) return null;
  return { domain: host, clientId: id };
}

/** Asks the server once. Any failure (no server, slow answer, odd answer) means "login off", quietly. */
export async function fetchAuthConfig(opts: { fetchFn?: FetchFn; timeoutMs?: number } = {}): Promise<AuthConfig | null> {
  const fetchFn: FetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  const control = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A fetch that ignores the abort signal must not be able to keep login "loading" forever.
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      control.abort();
      resolve(null);
    }, opts.timeoutMs ?? CONFIG_TIMEOUT_MS);
  });
  const attempt = (async () => {
    try {
      const res = await fetchFn(CONFIG_URL, { signal: control.signal, headers: { Accept: 'application/json' } });
      return res.ok ? parseAuthConfig(await res.json()) : null;
    } catch {
      return null;
    }
  })();
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

let asked: Promise<AuthConfig | null> | null = null;

/** The same answer for the whole page life: the server is asked only once. */
export function getAuthConfig(): Promise<AuthConfig | null> {
  asked ??= fetchAuthConfig();
  return asked;
}

/** Forget the stored answer (tests only). */
export function resetAuthConfig(): void {
  asked = null;
}
