import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900/50 to-slate-900">
      <div className="glass rounded-3xl px-12 py-10 flex flex-col items-center gap-6 shadow-2xl">
        <h1 className="text-4xl font-light text-white tracking-wide">hoyasim</h1>
        <Button variant="glass" size="lg" asChild>
          <Link to="/scenes/biking">Get Started</Link>
        </Button>
      </div>
    </div>
  )
}
