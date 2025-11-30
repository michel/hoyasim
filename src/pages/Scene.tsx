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

export interface SceneModel {
  path: string
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: number | [number, number, number]
}

export interface SceneConfig {
  image: string
  models: SceneModel[]
}

const base = import.meta.env.BASE_URL

const scenes: Record<string, SceneConfig> = {
  biking: {
    image: `${base}assets/scenes/biking2k.exr`,
    models: [
      {
        path: `${base}assets/scenes/low_poly_bicycle.glb`,
        position: [0, -0.9, 0],
        rotation: [0, 1.25, 0],
      },
    ],
  },
  office: {
    image: `${base}assets/scenes/office_1k.hdr`,
    models: [
      {
        path: `${base}assets/scenes/desk.glb`,
        position: [1.15, -1.1, 0],
        rotation: [0, -1.6, 0],
      },
    ],
  },
}

const sceneNames = Object.keys(scenes)

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
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <h1 className="text-4xl font-bold">Scene not found</h1>
        <Button asChild variant="outline">
          <Link to="/">Back to Home</Link>
        </Button>
      </div>
    )
  }

  return (
    <LandscapeGuard>
      <div className="fixed inset-0">
        <ThreeView
          image={sceneConfig.image}
          models={sceneConfig.models}
          gyroActive={gyroActive}
          onGyroActiveChange={setGyroActive}
          onGlassesReady={setGlassesControls}
        />
        <div className="absolute top-4 right-4 z-30">
          <Select
            value={scene}
            onValueChange={(value) => navigate(`/scenes/${value}`)}
          >
            <SelectTrigger className="w-32 bg-black/50 text-white border-white/20">
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
