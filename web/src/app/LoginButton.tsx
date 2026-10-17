// The login control for the header. Renders nothing at all unless login is set up.
//
// Why the Auth0 provider wraps only this button and not the whole app: adding a wrapper above existing children makes
// React rebuild them (the song view would reset, the modules would restart). Nothing else needs the provider: other
// code gets the token through `apiFetch`. The Auth0 code is also loaded only when login is on, as a separate file.
import { Component, lazy, Suspense, type ReactNode } from 'react';
import { useAuthState } from './AuthGate';
import './login.css';

const LoginIsland = lazy(() => import('./LoginIsland').then((m) => ({ default: m.LoginIsland })));

/** If the login code cannot load or crashes, say so in words and keep the rest of the page alive. */
class LoginBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[app] login could not start', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <p className="login-box login-problem" role="status" data-testid="login-unavailable">
        Login is not available right now. Everything else still works.
      </p>
    );
  }
}

export function LoginButton() {
  const auth = useAuthState();
  if (auth.status !== 'on') return null;
  return (
    <LoginBoundary>
      <Suspense fallback={null}>
        <LoginIsland config={auth.config} />
      </Suspense>
    </LoginBoundary>
  );
}
