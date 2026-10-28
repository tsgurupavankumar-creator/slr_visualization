import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

type Props = { children: ReactNode; resetKey: string };
type State = { error: Error | null };

/** Keeps one view that fails to draw from taking the whole page down with it. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("A view failed to render", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="view-error" role="alert">
        <strong>This view could not be drawn.</strong>
        <p>{this.state.error.message || "An unexpected error occurred."} The rest of the studio still works: change the step or tab, or edit the grammar and generate again.</p>
        <button className="button button-secondary" type="button" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
