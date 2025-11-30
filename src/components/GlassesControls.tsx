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
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-3 z-10 glass-dark rounded-full px-2 py-2 shadow-2xl">
      <Button variant="glass" onClick={onSwapLeft}>
        Swap Left
      </Button>
      <Button variant="glass" onClick={onSwapRight}>
        Swap Right
      </Button>
    </div>
  )
}
