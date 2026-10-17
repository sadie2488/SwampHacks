// Everything that touches Auth0. Loaded only when the server says login is set up (see LoginButton).
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import { useEffect, useState } from 'react';
import { cleanAddressBar, currentReturnTo, onLoginCallback } from './address-bar';
import { setTokenProvider } from './api-fetch';
import type { AuthConfig } from './auth-config';
import { pickToken } from './auth-token';

const MAX_NAME_CHARS = 40;

/** Keep the login saved across reloads when the browser lets us; if storage is blocked, keep it in memory instead. */
function storageWorks(): boolean {
  try {
    const probe = '__login_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function nameOf(user: { name?: string; nickname?: string; email?: string } | undefined): string {
  const name = (user?.name || user?.nickname || user?.email || 'there').trim();
  return name.length > MAX_NAME_CHARS ? `${name.slice(0, MAX_NAME_CHARS - 1)}…` : name;
}

/** Plain words for a login that did not work. The technical details are never shown. */
function problemWords(error: unknown): string {
  const code = (error as { error?: unknown } | null)?.error;
  return code === 'access_denied'
    ? 'Login was cancelled or not allowed. You can keep using the app without it.'
    : 'Login did not work. You can keep using the app without it, or try again.';
}

function LoginControls() {
  const { isLoading, isAuthenticated, user, error, loginWithRedirect, logout, getAccessTokenSilently, getIdTokenClaims } = useAuth0();
  const [problem, setProblem] = useState<string | null>(null);

  // While logged in, let apiFetch attach a token to requests. Both lookups only read what the login already stored.
  useEffect(() => {
    if (!isAuthenticated) return;
    setTokenProvider(() =>
      pickToken({
        accessToken: () => getAccessTokenSilently({ cacheMode: 'cache-only' }),
        idToken: () => getIdTokenClaims(),
      }),
    );
    return () => setTokenProvider(null);
  }, [isAuthenticated, getAccessTokenSilently, getIdTokenClaims]);

  // A login that failed on the way back (for example, "not allowed") leaves its answer in the address: remove it.
  useEffect(() => {
    if (error) cleanAddressBar();
  }, [error]);

  const logIn = async () => {
    setProblem(null);
    try {
      await loginWithRedirect({ appState: { returnTo: currentReturnTo() } });
    } catch {
      setProblem(
        window.isSecureContext === false
          ? 'Login only works on a secure page (https, or localhost). Open the app at http://localhost:5173.'
          : 'Login could not start. Please try again.',
      );
    }
  };

  const logOut = async () => {
    setProblem(null);
    try {
      await logout({ logoutParams: { returnTo: window.location.origin } });
    } catch {
      setProblem('Log out did not work. Please try again.');
    }
  };

  if (isLoading) {
    return (
      <span className="login-box" role="status" data-testid="login-status">
        Checking your login...
      </span>
    );
  }

  const message = problem ?? (error ? problemWords(error) : null);
  return (
    <div className="login-box">
      {isAuthenticated ? (
        <>
          <span data-testid="login-user">Hi {nameOf(user)}</span>
          <button type="button" data-testid="btn-logout" onClick={logOut}>
            Log out
          </button>
        </>
      ) : (
        <button type="button" data-testid="btn-login" onClick={logIn}>
          Log in
        </button>
      )}
      {message && (
        <span className="login-problem" role="alert" data-testid="login-error">
          {message}
        </span>
      )}
    </div>
  );
}

export function LoginIsland({ config }: { config: AuthConfig }) {
  const [cacheLocation] = useState<'localstorage' | 'memory'>(() => (storageWorks() ? 'localstorage' : 'memory'));
  return (
    <Auth0Provider
      domain={config.domain}
      clientId={config.clientId}
      authorizationParams={{ redirect_uri: window.location.origin }}
      cacheLocation={cacheLocation}
      onRedirectCallback={onLoginCallback}
    >
      <LoginControls />
    </Auth0Provider>
  );
}
