import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import hoyaLogo from '@/assets/hoya-logo.svg'
import { Button } from '@/components/ui/button'

export default function Home() {
  return (
    <div className="min-h-screen relative flex flex-col items-center justify-between bg-white overflow-hidden py-14 px-6">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 45%, rgba(0,85,196,0.06) 0%, rgba(0,85,196,0) 70%)',
        }}
      />

      <img
        src={hoyaLogo}
        alt="HOYA"
        className="relative h-9 w-auto animate-in fade-in duration-700"
      />

      <div className="relative flex flex-col items-center gap-10 max-w-md w-full animate-in fade-in slide-in-from-bottom-2 duration-700 delay-100 fill-mode-both">
        <div className="flex flex-col items-center gap-5">
          <div className="h-px w-10 bg-hoya-blue" />
          <p className="text-[11px] text-hoya-muted tracking-[0.32em] uppercase font-medium">
            Lens experience simulator
          </p>
          <h1 className="text-3xl sm:text-4xl font-light text-hoya-dark tracking-wide text-center leading-tight max-w-xs">
            See the world through Hoya
          </h1>
        </div>

        <Button size="lg" className="h-12 px-7 group shadow-md" asChild>
          <Link to="/scenes/biking">
            Get Started
            <ArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </Button>
      </div>

      <p className="relative text-[10px] text-hoya-muted/70 tracking-[0.25em] uppercase">
        Hoya Vision Care
      </p>
    </div>
  )
}
