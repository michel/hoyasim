import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/hoyasim/',
  server: {
    allowedHosts: true,
    headers: {
      'Cache-Control': 'no-store',
    },
  },
  plugins: [
    // Strip validators from dev responses and conditional headers from
    // requests so the browser cannot reuse cached bodies via 304s.
    {
      name: 'force-no-cache',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          delete req.headers['if-none-match']
          delete req.headers['if-modified-since']
          const blocked = new Set(['etag', 'last-modified'])
          const origSetHeader = res.setHeader.bind(res)
          res.setHeader = (name: string, value) => {
            if (blocked.has(name.toLowerCase())) return res
            return origSetHeader(name, value)
          }
          next()
        })
      },
    },
    react(),
    tailwindcss(),
    VitePWA({
      // Emits a SW that unregisters itself and clears caches on activation,
      // so any previously installed worker stops serving cached assets.
      // Nothing is precached: the ~35 MB splat blew past workbox's 2 MB limit.
      selfDestroying: true,
      injectRegister: false,
      manifest: {
        name: 'hoyasim',
        short_name: 'hoyasim',
        description: 'hoyasim Progressive Web App',
        theme_color: '#ffffff',
        orientation: 'landscape',
        display: 'fullscreen',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
