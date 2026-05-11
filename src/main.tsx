import { registerSW } from 'virtual:pwa-register'
import { Loader2 } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'

registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return
    setInterval(() => {
      if (!document.hidden) registration.update()
    }, 5 * 60_000)
  },
  onNeedRefresh() {
    window.location.reload()
  },
})

const Home = lazy(() => import('./pages/Home'))
const Scene = lazy(() => import('./pages/Scene'))

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

// StrictMode is intentionally absent: its dev-time double-mount of effects
// tears down the WebGL/PlayCanvas context while the first boot is still in
// flight, producing ARRAY_BUFFER null errors and a doubled scene.
createRoot(rootElement).render(
  <BrowserRouter basename="/hoyasim">
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-gray-600" />
        </div>
      }
    >
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/scenes/:scene" element={<Scene />} />
      </Routes>
    </Suspense>
  </BrowserRouter>,
)
