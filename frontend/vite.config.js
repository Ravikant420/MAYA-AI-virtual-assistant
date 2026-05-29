import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
 base: './',
  plugins: [react()],

  server: {
    port: 5173,         // Electron main.js expects localhost:5173 in dev mode
    strictPort: true,   // fail fast if 5173 is taken instead of picking a random port
    proxy: {
      '/api': {
        target:       'http://127.0.0.1:8000',
        changeOrigin: true,
        secure:       false,
        rewrite:      (path) => path.replace(/^\/api/, ''),
        configure: (proxy) => {
          proxy.on('error',    (err)      => console.log('[proxy error]', err.message))
          proxy.on('proxyReq', (_, req)   => console.log('[proxy →]', req.method, req.url))
        }
      },
      // Also proxy WebSocket for voice
      '/ws': {
        target:  'ws://127.0.0.1:8000',
        ws:      true,
        rewrite: (path) => path
      }
    }
  },

  build: {
    outDir:    '../dist/frontend',   // Electron loads from dist/frontend/index.html
    emptyOutDir: true,
  }
})
