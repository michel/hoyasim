import { useState } from 'react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LandscapeGuard } from '@/components/LandscapeGuard'
import PlayCanvasView from '@/components/PlayCanvasView'

export default function Scene() {
  const [gyroActive, setGyroActive] = useState(false)

  return (
    <ErrorBoundary>
      <LandscapeGuard>
        <div className="fixed inset-0">
          <PlayCanvasView
            gyroActive={gyroActive}
            onGyroActiveChange={setGyroActive}
          />
        </div>
      </LandscapeGuard>
    </ErrorBoundary>
  )
}
