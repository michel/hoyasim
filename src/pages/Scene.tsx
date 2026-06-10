import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LandscapeGuard } from '@/components/LandscapeGuard'
import PlayCanvasView from '@/components/PlayCanvasView'

export default function Scene() {
  return (
    <ErrorBoundary>
      <LandscapeGuard>
        <div className="fixed inset-0">
          <PlayCanvasView />
        </div>
      </LandscapeGuard>
    </ErrorBoundary>
  )
}
