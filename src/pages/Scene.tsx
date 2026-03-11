import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { GlassesControls } from '@/components/GlassesControls'
import { LandscapeGuard } from '@/components/LandscapeGuard'
import ThreeView from '@/components/ThreeView'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { sceneNames, scenes } from '@/config/scenes'

export default function Scene() {
  const { scene } = useParams<{ scene: string }>()
  const navigate = useNavigate()
  const sceneConfig = scene ? scenes[scene] : null
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
        <div className="absolute top-4 right-4 z-30">
          <Select
            value={scene}
            onValueChange={(value) => navigate(`/scenes/${value}`)}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sceneNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {glassesControls && (
          <GlassesControls
            onSwapLeft={glassesControls.swapLeft}
            onSwapRight={glassesControls.swapRight}
          />
        )}
      </div>
    </LandscapeGuard>
  )
}
