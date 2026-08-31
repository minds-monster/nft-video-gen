import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
  build: {
    rollupOptions: {
      output: {
        // three.js is ~1MB and only the storyboard's 3D frames need it. Splitting it out means
        // a visitor who never opens a storyboard never downloads a renderer — the viewport
        // modules are behind React.lazy for the same reason, and the two work together: lazy
        // decides WHEN it loads, this decides that it is its own file rather than being inlined
        // into the main bundle.
        //
        // Function form, not the object form: Vite 8 bundles with rolldown, which accepts only a
        // function here and fails the build outright on the object shorthand.
        manualChunks: (id) =>
          /node_modules\/(three|@react-three)/.test(id) ? 'three' : undefined,
      },
    },
  },
  server: {
    proxy: {
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
