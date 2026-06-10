import * as pc from 'playcanvas'
import { useEffect, useState } from 'react'
import hoyaLogo from '@/assets/hoya-logo.svg'

function RotateDeviceIllustration() {
  return (
    <div className="relative h-44 w-44 flex items-center justify-center">
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{
          animation: 'pulse-arc 2.8s ease-in-out infinite',
          transformOrigin: 'center',
        }}
      >
        <path
          d="M 50 100 A 50 50 0 0 1 150 100"
          stroke="#0055c4"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="2 6"
          opacity="0.55"
        />
        <path
          d="M 145 100 L 150 100 L 150 95"
          stroke="#0055c4"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <svg
        width="84"
        height="120"
        viewBox="0 0 84 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{
          animation: 'rotate-device 2.8s ease-in-out infinite',
          transformOrigin: 'center',
        }}
      >
        <rect
          x="2"
          y="2"
          width="80"
          height="116"
          rx="12"
          stroke="#2c2c37"
          strokeWidth="3"
          fill="white"
        />
        <rect
          x="8"
          y="14"
          width="68"
          height="92"
          rx="4"
          fill="#0055c4"
          opacity="0.08"
        />
        <rect x="34" y="7" width="16" height="3" rx="1.5" fill="#2c2c37" />
        <circle cx="42" cy="112" r="2" fill="#2c2c37" />
      </svg>
    </div>
  )
}

function PortraitWarning() {
  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-between py-12 px-6">
      <img src={hoyaLogo} alt="HOYA" className="h-7 w-auto" />
      <div className="flex flex-col items-center gap-10 -mt-4">
        <RotateDeviceIllustration />
        <div className="flex flex-col items-center gap-2 text-center max-w-xs">
          <h2 className="text-2xl font-light text-hoya-dark tracking-wide">
            Rotate your device
          </h2>
          <p className="text-sm text-hoya-muted leading-relaxed">
            This simulator is designed for landscape mode
          </p>
        </div>
      </div>
      <span className="h-7" aria-hidden="true" />
    </div>
  )
}

export function LandscapeGuard({ children }: { children: React.ReactNode }) {
  const [isPortrait, setIsPortrait] = useState(() => {
    if (!pc.platform.touch) return false
    return window.matchMedia('(orientation: portrait)').matches
  })

  useEffect(() => {
    if (!pc.platform.touch) return
    const mql = window.matchMedia('(orientation: portrait)')
    const onChange = (e: MediaQueryListEvent) => setIsPortrait(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  if (isPortrait) return <PortraitWarning />
  return <>{children}</>
}
