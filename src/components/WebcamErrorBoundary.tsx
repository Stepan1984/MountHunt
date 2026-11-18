import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  fallback: ReactNode
  children: ReactNode
}

type State = { hasError: boolean }

/** Keeps resort detail usable if a player throws. */
export class WebcamErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('Webcam player error', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}
