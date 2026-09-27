import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The OAuth client id is public by design — it ships inside the bundle either way — but it
// should still have exactly one home. Rather than copy it into a web/.env that can drift, or
// add a fifth endpoint to serve it (TRD §8 specifies four, and docs/process.md §3 says the
// discipline is keeping it four), read it out of the backend's own .env at config time.
function googleClientId(): string {
  const fromEnv = process.env['LOOM_GOOGLE_CLIENT_ID']
  if (fromEnv) return unquote(fromEnv)
  try {
    const env = readFileSync(new URL('../backend/.env', import.meta.url), 'utf8')
    return unquote(/^LOOM_GOOGLE_CLIENT_ID=(.*)$/m.exec(env)?.[1] ?? '')
  } catch {
    return ''
  }
}

// node --env-file strips surrounding quotes; reading the file ourselves does not, and
// .env.example quotes DATABASE_URL, so a quoted value here is the expected shape rather than
// a mistake. Without this the browser sends Google a client id wrapped in literal quote
// characters and gets `invalid_client`, which reads as a missing OAuth client rather than a
// malformed request.
function unquote(value: string): string {
  const trimmed = value.trim()
  const quote = trimmed[0]
  return (quote === '"' || quote === "'") && trimmed.endsWith(quote)
    ? trimmed.slice(1, -1)
    : trimmed
}

// The Node server runs separately on :8080. Proxying keeps the browser on one
// origin in development, so there is no CORS to configure, no base URL in the
// frontend code, and the session cookie in Phase 1 is same-site by construction
// (docs/plan.md §2.3).
// Overridable so the e2e run can point at its own API port (8099) while a
// development server holds 8080.
const target = process.env['LOOM_API_TARGET'] ?? 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [react()],
  // ES workers can code-split. Without this the worker's dynamic import of libheif is inlined
  // into the worker chunk, so an iPhone — which decodes HEIC natively and never reaches the
  // fallback — would still download ~2 MB of WASM the moment it converted anything.
  worker: { format: 'es' },
  define: {
    // Empty when unset; the landing page says so rather than failing inside Google's script.
    __GOOGLE_CLIENT_ID__: JSON.stringify(googleClientId()),
  },
  server: {
    // Bind IPv4 explicitly: 'localhost' resolves to ::1 on macOS, so a test
    // against 127.0.0.1 would find nothing listening.
    host: '127.0.0.1',
    proxy: {
      '/api': { target, changeOrigin: true },
      '/healthz': { target, changeOrigin: true },
    },
  },
})
