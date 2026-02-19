import { Component, ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

/**
 * Error Boundary component to catch and display errors gracefully
 * Fixes #33: Prevents Cmd+R crashes from breaking the entire page
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-white flex items-center justify-center">
          <div className="text-center max-w-md p-8">
            <div className="text-6xl mb-4">😵</div>
            <h1 className="text-2xl font-semibold text-gray-900 mb-2">Something went wrong</h1>
            <p className="text-gray-600 mb-6">
              The page encountered an error. This can happen during a refresh.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Refresh Page
              </button>
              <Link
                to="/"
                className="px-4 py-2 bg-[#042f84] text-white rounded-lg hover:bg-[#03246a]"
                onClick={() => this.setState({ hasError: false })}
              >
                Go to Dashboard
              </Link>
            </div>
            {this.state.error && (
              <details className="mt-6 text-left text-sm text-gray-500">
                <summary className="cursor-pointer hover:text-gray-700">Technical details</summary>
                <pre className="mt-2 p-3 bg-gray-100 rounded text-xs overflow-auto">
                  {this.state.error.message}
                </pre>
              </details>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
