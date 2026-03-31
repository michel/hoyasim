import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { GlassesControls } from '@/components/GlassesControls'
import { LandscapeGuard } from '@/components/LandscapeGuard'
import ThreeView from '@/components/ThreeView'
import { Button } from '@/components/ui/button'
import { scenes } from '@/config/scenes'

export default function Scene() {
  const { scene } = useParams<{ scene: string }>()
  const navigate = useNavigate()
  const isValidScene = scene !== undefined && scene in scenes
  const sceneConfig = isValidScene ? scenes[scene as keyof typeof scenes] : null

  useEffect(() => {
    if (!isValidScene) navigate('/scenes/biking', { replace: true })
  }, [isValidScene, navigate])
  const [glassesControls, setGlassesControls] = useState<{
    swapLeft: () => void
    swapRight: () => void
  } | null>(null)
  const [gyroActive, setGyroActive] = useState(false)

  if (!sceneConfig) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900/50 to-slate-900">
        <div className="glass rounded-3xl px-12 py-10 flex flex-col items-center gap-6 shadow-2xl">
          <h1 className="text-3xl font-light text-white">Scene not found</h1>
          <Button variant="glass" asChild>
            <Link to="/">Back to Home</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <LandscapeGuard>
        <div className="fixed inset-0">
          <ThreeView
            image={sceneConfig.image}
            models={sceneConfig.models}
            effects={sceneConfig.effects}
            gyroActive={gyroActive}
            onGyroActiveChange={setGyroActive}
            onGlassesReady={setGlassesControls}
          />
          {glassesControls && (
            <GlassesControls
              onSwapLeft={glassesControls.swapLeft}
              onSwapRight={glassesControls.swapRight}
            />
          )}
        </div>
      </LandscapeGuard>
    </ErrorBoundary>
  )
}
