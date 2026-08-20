import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Minds Builder API only sends access-control-allow-origin for *.hellominds.ai
// origins, so the browser blocks direct calls from localhost. We proxy them through
// the dev server instead: Vite makes the request from Node, where CORS does not apply.
// See src/services/mindsProxy.js for the matching client-side fetch rewrite.
export const MINDS_PROXY_PREFIX = '/__minds'
const MINDS_API_ORIGIN = 'https://api.build.hellominds.ai'

// The agent swarm (worker/) runs on `wrangler dev`, not on this server, because it needs
// KV and secrets that Vite has no notion of. Proxying /api to it means the client fetches
// the same relative paths in dev and in production, where the Worker and the built SPA are
// one deploy (see the `assets` block in wrangler.jsonc).
//
// Note the contrast with the Minds proxy above, which only exists in dev — the deployed
// site still has that CORS problem. This one is real in both.
//
// Keep this in sync with the `dev.port` in wrangler.jsonc. Wrangler's default 8787 is
// commonly held by a stale workerd, so we pin both sides to an explicit non-default port.
const WORKER_PORT = 8789
const WORKER_ORIGIN = `http://127.0.0.1:${WORKER_PORT}`

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
      '/api': {
        target: WORKER_ORIGIN,
        changeOrigin: true,
        // The Screenwriter streams, and a buffered proxy would hold the whole treatment
        // back and deliver it in one lump — which is the entire point of streaming it.
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => proxyReq.setHeader('accept-encoding', 'identity'))
          proxy.on('error', () => {
            console.warn('\n  /api is unreachable — is `npm run dev:worker` running?\n')
          })
        },
      },
    },
  },
})
