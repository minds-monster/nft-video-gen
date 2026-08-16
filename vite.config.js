import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Minds Builder API only sends access-control-allow-origin for *.hellominds.ai
// origins, so the browser blocks direct calls from localhost. We proxy them through
// the dev server instead: Vite makes the request from Node, where CORS does not apply.
// See src/services/mindsProxy.js for the matching client-side fetch rewrite.
export const MINDS_PROXY_PREFIX = '/__minds'
const MINDS_API_ORIGIN = 'https://api.build.hellominds.ai'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      [MINDS_PROXY_PREFIX]: {
        target: MINDS_API_ORIGIN,
        changeOrigin: true,
        rewrite: (path) => path.replace(new RegExp(`^${MINDS_PROXY_PREFIX}`), ''),
        // The API streams replies over SSE (/v1/messaging/events); don't buffer.
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => proxyReq.setHeader('accept-encoding', 'identity'))
        },
      },
    },
  },
})
