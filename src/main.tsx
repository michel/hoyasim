import { registerSW } from 'virtual:pwa-register'
import { Loader2 } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'

// injectRegister is false in vite.config.ts, so this is the only thing that
// registers the self-destructing worker that evicts legacy PWA caches.
registerSW({ immediate: true })

const Home = lazy(() => import('./pages/Home'))
const Scene = lazy(() => import('./pages/Scene'))

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

// StrictMode is intentionally absent: its dev-time double-mount of effects
// tears down the WebGL/PlayCanvas context while the first boot is still in
// flight, producing ARRAY_BUFFER null errors and a doubled scene.
createRoot(rootElement).render(
  // Deploy path is owned by vite.config.ts (base); BASE_URL keeps the router in
  // sync with it. Trailing slash stripped so the bare /hoyasim URL matches too.
  <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
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
