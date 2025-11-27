import { Button } from '@/components/ui/button'
import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold">hoyasim</h1>
      <Button asChild>
        <Link to="/scenes/demo">Get Started</Link>
      </Button>
    </div>
  )
}
