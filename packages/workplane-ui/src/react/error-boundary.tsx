import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  blockId: string;
  fallback: (error: Error) => ReactNode;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * One block failing must not erase or crash the document. Every block is
 * wrapped, so a bad spec, a broken renderer, or a thrown hook degrades to a
 * labelled error card while everything around it stays usable.
 */
export class BlockErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Ids and messages only. Block content may be confidential.
    console.error(`[workplane] block "${this.props.blockId}" failed to render`, error.message, info.componentStack);
  }

  override componentDidUpdate(previous: Props): void {
    if (previous.blockId !== this.props.blockId && this.state.error) {
      this.setState({ error: null });
    }
  }

  override render(): ReactNode {
    if (this.state.error) return this.props.fallback(this.state.error);
    return this.props.children;
  }
}
