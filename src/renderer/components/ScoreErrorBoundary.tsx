import { Component, type ReactNode } from 'react';
import { reportError } from '../errors/reportError';

// A score OSMD cannot draw used to unmount the whole app and leave a blank window
// (New World, 11/19). This keeps the header and tabs, and says what went wrong.
// Switching tabs remounts it (App keys it by view), so "Try again" is only for a retry in place.
export class ScoreErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[score] could not draw:', error);
    reportError('score draw', error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="mx-auto max-w-xl rounded border border-red-700 bg-red-950/40 p-4 text-sm text-red-200" data-testid="score-draw-error">
        <p>This score couldn&apos;t be drawn: {error.message}</p>
        <button title="Try drawing the score again."
          onClick={() => this.setState({ error: null })}
          className="mt-3 rounded bg-gray-700 px-3 py-1 text-gray-100 hover:bg-gray-600"
        >
          Try again
        </button>
      </div>
    );
  }
}
