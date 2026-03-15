import { Component } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

interface Props {
  children: React.ReactNode
}

interface State {
  error: string | null
  stack: string | undefined
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: undefined }

  static getDerivedStateFromError(error: Error) {
    return { error: error.message, stack: error.stack }
  }

  render() {
    if (this.state.error)
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900/50 to-slate-900">
          <div className="glass rounded-3xl px-12 py-10 flex flex-col items-center gap-6 shadow-2xl max-w-lg">
            <h1 className="text-2xl font-light text-white">
              Something went wrong
            </h1>
            <p className="text-white/60 text-sm max-w-md text-center">
              {this.state.error}
            </p>
            {import.meta.env.DEV && this.state.stack && (
              <pre className="text-white/40 text-xs max-w-md overflow-auto max-h-40 text-left w-full">
                {this.state.stack}
              </pre>
            )}
            <Button variant="glass" asChild>
              <Link to="/">Back to Home</Link>
            </Button>
          </div>
        </div>
      )

    return this.props.children
  }
}
