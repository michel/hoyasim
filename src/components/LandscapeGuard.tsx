import { useEffect, useState } from 'react'

function RotatePhoneIcon() {
  return (
    <svg
      width="120"
      height="120"
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="mb-6"
    >
      <title>Rotate phone to landscape</title>
      {/* Phone in portrait position */}
      <rect
        x="35"
        y="25"
        width="30"
        height="50"
        rx="4"
        stroke="white"
        strokeWidth="3"
        fill="none"
      />
      <circle cx="50" cy="68" r="3" fill="white" />

      {/* Rotation arrow */}
      <path
        d="M75 50 C 90 50, 95 65, 85 80"
        stroke="white"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M80 75 L85 82 L92 77"
        stroke="white"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PortraitWarning() {
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center text-white">
      <RotatePhoneIcon />
      <p className="text-lg font-medium">Please rotate your device</p>
    </div>
  )
}

export function LandscapeGuard({ children }: { children: React.ReactNode }) {
  const [isPortrait, setIsPortrait] = useState(
    () => window.innerWidth < window.innerHeight,
  )

  useEffect(() => {
    const checkOrientation = () =>
      setIsPortrait(window.innerWidth < window.innerHeight)

    window.addEventListener('resize', checkOrientation)
    return () => window.removeEventListener('resize', checkOrientation)
  }, [])

  if (isPortrait) return <PortraitWarning />
  return <>{children}</>
}
