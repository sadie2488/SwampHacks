// Picks the token the server can check. It never logs or stores a token.

/** A signed token has three dot-separated parts. Auth0's opaque tokens (and encrypted ones with five parts) do not. */
export function looksSigned(token: unknown): token is string {
  return typeof token === 'string' && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token);
}

/** True when the token's own expiry time has passed (or cannot be read). */
export function hasExpired(token: string, now: number = Date.now()): boolean {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const exp = (JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4))) as { exp?: unknown }).exp;
    return typeof exp !== 'number' || exp * 1000 <= now;
  } catch {
    return true;
  }
}

export type TokenSources = {
  /** The access token already stored by the login (never asks Auth0), if any. */
  accessToken: () => Promise<unknown>;
  /** The login's ID token details, if any (`__raw` is the signed token). */
  idToken: () => Promise<{ __raw?: unknown } | undefined | null>;
  /**
   * Ask Auth0 for new tokens because the stored ones are missing or out of date (stored tokens are never renewed by
   * themselves). Returns the new access token and updates the stored ID token. Throws when the login has ended.
   */
  refresh?: () => Promise<unknown>;
};

/** The stored token the server can check, if one is still good. Never throws. */
async function storedToken(sources: TokenSources, now: number): Promise<string | null> {
  try {
    const access = await sources.accessToken();
    if (looksSigned(access) && !hasExpired(access, now)) return access;
  } catch {
    // no access token: try the ID token
  }
  try {
    const raw = (await sources.idToken())?.__raw;
    if (looksSigned(raw) && !hasExpired(raw, now)) return raw;
  } catch {
    // nothing usable
  }
  return null;
}

/**
 * The access token if it is a signed one, otherwise the ID token. Without an "audience" Auth0 hands out an
 * opaque access token that only its own /userinfo address understands, so the ID token is what normally gets used.
 * When neither stored token is still good, asks Auth0 for new ones once (if `refresh` is given).
 * Returns null when there is nothing the server could accept; the request then goes out anonymously.
 * Throws only when that refresh fails, which means the login has ended and the person must log in again.
 */
export async function pickToken(sources: TokenSources, now: number = Date.now()): Promise<string | null> {
  const stored = await storedToken(sources, now);
  if (stored || !sources.refresh) return stored;
  const fresh = await sources.refresh();
  if (looksSigned(fresh) && !hasExpired(fresh, now)) return fresh;
  return storedToken(sources, now); // the refresh also renewed the stored ID token
}
