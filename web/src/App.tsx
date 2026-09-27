import { useEffect, useState } from 'react'
import './App.css'

// Phase 0's only view, and it is throwaway: Phase 1 replaces it with the landing
// page. It exists because it is the one thing exercising both halves of the
// stack — if this renders a status, the Vite proxy reaches the Node server.
type Health = {
  status: 'ok' | 'degraded'
  checks: { database: 'ok' | 'unavailable' }
}

type Probe = { state: 'loading' } | { state: 'ready'; health: Health } | { state: 'unreachable' }

const POLL_MS = 3_000

export default function App() {
  const [probe, setProbe] = useState<Probe>({ state: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    const poll = async (): Promise<void> => {
      try {
        const res = await fetch('/healthz', { signal: controller.signal })
        // 503 is a real answer from a reachable server, not a failure to reach it.
        setProbe({ state: 'ready', health: (await res.json()) as Health })
      } catch {
        if (!controller.signal.aborted) setProbe({ state: 'unreachable' })
      }
    }

    void poll()
    const timer = setInterval(() => void poll(), POLL_MS)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [])

  return (
    <main className="probe">
      <h1>loom</h1>
      <p className="tagline">Phase 0 scaffold — backend reachability check</p>

      {probe.state === 'loading' && <p className="pending">checking…</p>}

      {probe.state === 'unreachable' && (
        <p className="bad">
          server unreachable — is <code>npm run dev</code> running?
        </p>
      )}

      {probe.state === 'ready' && (
        <dl className={probe.health.status === 'ok' ? 'good' : 'bad'}>
          <dt>server</dt>
          <dd>{probe.health.status}</dd>
          <dt>database</dt>
          <dd>{probe.health.checks.database}</dd>
        </dl>
      )}
    </main>
  )
}
