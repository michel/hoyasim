import { Button } from '@/components/ui/button'

interface GlassesControlsProps {
  onSwapLeft: () => void
  onSwapRight: () => void
}

export function GlassesControls({
  onSwapLeft,
  onSwapRight,
}: GlassesControlsProps) {
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-4 z-10">
      <Button
        variant="outline"
        className="bg-black/50 text-white border-white/20 hover:bg-black/70"
        onClick={onSwapLeft}
      >
        Swap Left
      </Button>
      <Button
        variant="outline"
        className="bg-black/50 text-white border-white/20 hover:bg-black/70"
        onClick={onSwapRight}
      >
        Swap Right
      </Button>
    </div>
  )
}
