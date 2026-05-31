import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  // Optional adapter rendered when the children throw. Receives the error
  // and a `reset()` callback so the fallback UI can retry the children.
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

// Class component because React still has no hook for componentDidCatch.
// Kept intentionally small \u2014 it is the seam between any view and the
// "renderer crashed" recovery path. Two adapters justify the seam: the
// default GraphView and the TripleTable fallback (see views/EntityExplorer).
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Surfacing to the console keeps stack traces accessible without
    // shipping a telemetry dependency.
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return (
        <div className="error-boundary">
          <h3>Something went wrong</h3>
          <p>{this.state.error.message}</p>
          <button type="button" onClick={this.reset}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
