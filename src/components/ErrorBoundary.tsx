import { Component } from 'react'
import { Link } from 'react-router-dom'
import hoyaLogo from '@/assets/hoya-logo.svg'
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
        <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6">
          <div className="flex flex-col items-center gap-8 max-w-lg w-full">
            <img src={hoyaLogo} alt="HOYA" className="h-10 w-auto" />
            <div className="flex flex-col items-center gap-2">
              <h1 className="text-2xl font-light text-hoya-dark tracking-wide">
                Something went wrong
              </h1>
              <p className="text-hoya-muted text-sm max-w-md text-center">
                {this.state.error}
              </p>
            </div>
            {import.meta.env.DEV && this.state.stack && (
              <pre className="text-hoya-muted/80 text-xs max-w-md overflow-auto max-h-40 text-left w-full bg-secondary rounded-xl p-4">
                {this.state.stack}
              </pre>
            )}
            <Button asChild>
              <Link to="/">Back to Home</Link>
            </Button>
          </div>
        </div>
      )

    return this.props.children
  }
}
