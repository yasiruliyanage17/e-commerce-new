import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
// NOTE: HTTPS is required so mobile browsers treat the LAN connection as a
// "secure context", which is mandatory for camera/getUserMedia() access on
// the QR scanner page. The basicSsl plugin generates a self-signed certificate.
// Mobile browsers will show a certificate warning on first visit — tap
// "Advanced → Proceed" to accept the self-signed cert.
export default defineConfig({
  plugins: [
    react(),
    basicSsl()
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // allowedHosts: 'all' lets mobile devices on the LAN connect by IP
    // without Vite rejecting the request with a 403.
    allowedHosts: 'all',
    // https: true is implied when basicSsl() plugin is active.
    // Do NOT set https: false here or it will override the plugin.

    // HMR must explicitly use port 5173 over HTTPS so the browser's
    // WebSocket connection doesn't fall back to ws:// (blocked on HTTPS).
    hmr: {
      clientPort: 5173,
    },

    // ── Docker on Windows fix ──────────────────────────────────────────────
    // inotify file-change events from the Windows host do NOT propagate into
    // the Linux container through a volume mount. Without polling, Vite never
    // detects edits and serves the old cached JS bundle → new routes are
    // missing → sellers get redirected to /admin/login because the old route
    // map is still active in the browser.
    // usePolling forces Vite to check for file changes every 300ms.
    watch: {
      usePolling: true,
      interval: 300,
    },

    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // secure: false is required because the frontend is now HTTPS
        // (self-signed cert). Without this, Vite refuses to forward
        // requests and the proxy silently fails → login loop.
        secure: false,
        // Explicitly pass all headers (including Authorization) through
        // the proxy. Without this, the Authorization header can be
        // dropped by changeOrigin rewriting on some Vite versions.
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Forward Authorization header explicitly
            if (req.headers['authorization']) {
              proxyReq.setHeader('authorization', req.headers['authorization']);
            }
          });
        },
      },
      '/bookkeeping-api': {
        target: 'http://bookkeeping-service:4020',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/bookkeeping-api/, '')
      }
    }
  }
})
