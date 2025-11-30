import { Loader2 } from 'lucide-react'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'

const Home = lazy(() => import('./pages/Home'))
const Scene = lazy(() => import('./pages/Scene'))

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

createRoot(rootElement).render(
  <StrictMode>
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
    </BrowserRouter>
  </StrictMode>,
)
