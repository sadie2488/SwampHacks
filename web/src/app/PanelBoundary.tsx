import { Component, type ReactNode } from 'react';

/** Keeps one broken panel from blanking the whole page. */
export class PanelBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[app] the ${this.props.name} panel crashed`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <p className="error" role="alert">
        Sorry, the {this.props.name} part ran into a problem. Try another tab and come back, or reload the page.
      </p>
    );
  }
}
