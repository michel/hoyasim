import { Loader2 } from 'lucide-react'
import { useRef } from 'react'
import type * as THREE from 'three'
import { Button } from '@/components/ui/button'
import type { SceneModel } from '@/config/scenes'
import { useAssetLoader } from '@/hooks/useAssetLoader'
import { useDeviceOrientation } from '@/hooks/useDeviceOrientation'
import { usePointerControls } from '@/hooks/usePointerControls'
import { useThreeScene } from '@/hooks/useThreeScene'

interface ThreeViewProps {
  image: string
  models?: SceneModel[]
  gyroActive: boolean
  onGyroActiveChange: (active: boolean) => void
  onReady?: (ref: {
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    renderer: THREE.WebGLRenderer
  }) => void
  onGlassesReady?: (controls: {
    swapLeft: () => void
    swapRight: () => void
  }) => void
}

export default function ThreeView({
  image,
  models,
  gyroActive,
  onGyroActiveChange,
  onGlassesReady,
}: ThreeViewProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const lonRef = useRef(0)
  const latRef = useRef(0)
  const gyroActiveRef = useRef(gyroActive)
  gyroActiveRef.current = gyroActive

  const sceneRefs = useThreeScene(mountRef)

  usePointerControls(
    sceneRefs?.renderer.domElement ?? null,
    lonRef,
    latRef,
    gyroActive,
  )

  const { showEnableButton, enableMotionControls } = useDeviceOrientation(
    sceneRefs?.camera ?? null,
    gyroActive,
    onGyroActiveChange,
  )

  const { loading, error } = useAssetLoader(
    sceneRefs?.scene ?? null,
    sceneRefs?.camera ?? null,
    sceneRefs?.renderer ?? null,
    sceneRefs?.sphereMaterial ?? null,
    image,
    models,
    gyroActiveRef,
    lonRef,
    latRef,
    onGlassesReady,
  )

  return (
    <div
      ref={mountRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        top: 0,
        left: 0,
      }}
    >
      {loading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-slate-950 via-slate-900 to-zinc-900">
          <div className="glass rounded-3xl p-8 flex flex-col items-center gap-4 shadow-2xl">
            <Loader2 className="h-10 w-10 animate-spin text-white/80" />
            <div className="text-white/90 text-lg font-light">
              Loading scene...
            </div>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-slate-950 via-slate-900 to-zinc-900">
          <div className="glass rounded-3xl p-8 flex flex-col items-center gap-4 shadow-2xl">
            <div className="text-red-400 text-lg font-light">{error}</div>
          </div>
        </div>
      )}
      {showEnableButton && !gyroActive && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
          <Button variant="glass" size="lg" onClick={enableMotionControls}>
            Tap to Enable Motion Controls
          </Button>
        </div>
      )}
    </div>
  )
}
