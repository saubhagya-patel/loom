import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The Node server runs separately on :8080. Proxying keeps the browser on one
// origin in development, so there is no CORS to configure, no base URL in the
// frontend code, and the session cookie in Phase 1 is same-site by construction
// (docs/plan.md §2.3).
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind IPv4 explicitly: 'localhost' resolves to ::1 on macOS, so a test
    // against 127.0.0.1 would find nothing listening.
    host: '127.0.0.1',
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true },
      '/healthz': { target: 'http://127.0.0.1:8080', changeOrigin: true },
    },
  },
})
