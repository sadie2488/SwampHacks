// Keeps the address bar tidy around the Auth0 round trip. Auth0 sends people back to `/?code=...&state=...`.

const AUTH_PARAMS = ['code', 'state', 'error', 'error_description', 'connect_code'];

function tidy(url: URL): string {
  for (const name of AUTH_PARAMS) url.searchParams.delete(name);
  return url.pathname + url.search + url.hash;
}

/** True when the address carries the answer from Auth0. */
export function hasLoginAnswer(search: string = window.location.search): boolean {
  const p = new URLSearchParams(search);
  return (p.has('code') || p.has('error')) && p.has('state');
}

/** Where to come back to after logging in: this page, with its other settings (like ?fake=1). */
export function currentReturnTo(): string {
  return tidy(new URL(window.location.href));
}

/** A return address from the saved login state, only if it stays on this site. Otherwise null. */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin ? tidy(url) : null;
  } catch {
    return null;
  }
}

/** Remove the Auth0 answer from the address bar without reloading, keeping everything else. */
export function cleanAddressBar(): void {
  if (!hasLoginAnswer()) return;
  window.history.replaceState(window.history.state, document.title, currentReturnTo());
}

/** What to show in the address bar after a successful login. */
export function onLoginCallback(appState?: { returnTo?: unknown }): void {
  window.history.replaceState({}, document.title, safeReturnTo(appState?.returnTo) ?? currentReturnTo());
}
