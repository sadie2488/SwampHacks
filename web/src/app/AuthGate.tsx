// Wraps the whole app and finds out, once, whether login is set up. It renders the app straight away and never
// changes the tree around it, so nothing below it (the song view, the modules) is ever rebuilt when the answer arrives.
// The Auth0 provider itself lives in LoginIsland, around the login controls only (see LoginButton for why).
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getAuthConfig, type AuthConfig } from './auth-config';

export type AuthState = { status: 'checking' | 'off' } | { status: 'on'; config: AuthConfig };

const AuthContext = createContext<AuthState>({ status: 'off' });

/** Whether login is set up. Without an AuthGate above, it is "off". */
export function useAuthState(): AuthState {
  return useContext(AuthContext);
}

export function AuthGate({ children, load = getAuthConfig }: { children: ReactNode; load?: () => Promise<AuthConfig | null> }) {
  const [state, setState] = useState<AuthState>({ status: 'checking' });

  useEffect(() => {
    let alive = true;
    load().then(
      (config) => alive && setState(config ? { status: 'on', config } : { status: 'off' }),
      () => alive && setState({ status: 'off' }),
    );
    return () => {
      alive = false;
    };
  }, [load]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
