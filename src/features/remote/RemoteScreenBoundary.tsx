import { Component, type ErrorInfo, type ReactNode } from "react";

const isDevRuntime = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

/** Last-resort render protection; normal snapshot failures use decoder states. */
export class RemoteScreenBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isDevRuntime) console.warn("[remote render]", error.name, info.componentStack);
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="player player-status" role="alert">
          <h2>We couldn't display the game</h2>
          <p>Please try again. If this continues, ask your Storyteller for help.</p>
          <button className="btn" onClick={() => this.setState({ failed: false })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
