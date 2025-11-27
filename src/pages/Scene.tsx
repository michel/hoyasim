import { useParams, Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export default function Scene() {
  const { scene } = useParams<{ scene: string }>()

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold">Scene: {scene}</h1>
      <Button asChild variant="outline">
        <Link to="/">Back to Home</Link>
      </Button>
    </div>
  )
}
