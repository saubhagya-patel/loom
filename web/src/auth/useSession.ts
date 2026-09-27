import { useCallback, useEffect, useRef, useState } from 'react'
import { requestAuthCode } from './gis.ts'
import { setAccessToken } from './token.ts'

export type Account = { email: string; appFolderId: string | null }

export type SessionState =
  | { status: 'loading' }
  | { status: 'signed-out'; error?: string }
  | { status: 'signed-in'; account: Account }

// Google's access tokens last an hour. Refreshing at 55 minutes keeps one in hand before the
// old one dies — a long upload must not fail because the token aged out mid-file
// (docs/plan.md §2.4). TRD §8 fixes the response bodies and neither carries an expiry, so
// this is a constant rather than something read from the server.
const REFRESH_AFTER_MS = 55 * 60 * 1000

async function refreshAccessToken(): Promise<boolean> {
  const res = await fetch('/api/auth/refresh', { method: 'POST' })
  if (!res.ok) return false
  const body = (await res.json()) as { accessToken: string }
  setAccessToken(body.accessToken)
  return true
}

export function useSession(): SessionState & {
  signIn: () => Promise<void>
  signOut: () => Promise<void>
} {
  const [state, setState] = useState<SessionState>({ status: 'loading' })
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  // An interval rather than a self-rescheduling timeout: the period is fixed, so recursion
  // would only buy a callback that has to capture itself before it exists.
  const startRefreshLoop = useCallback(() => {
    if (timer.current) clearInterval(timer.current)
    timer.current = setInterval(() => {
      void (async () => {
        // A failure here means the refresh token is gone — revoked, or expired because the
        // OAuth consent screen is still in "Testing", which kills them after 7 days
        // (agent-cache/knowledge.md). Either way the honest state is signed out.
        if (await refreshAccessToken()) return
        if (timer.current) clearInterval(timer.current)
        setAccessToken(null)
        setState({ status: 'signed-out', error: 'your session expired, please sign in again' })
      })()
    }, REFRESH_AFTER_MS)
  }, [])

  // On load the cookie may still be valid while the access token is definitely gone, since
  // it only ever lived in memory. Ask who we are, then mint a token.
  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/user/config')
      if (!res.ok) {
        setState({ status: 'signed-out' })
        return
      }
      const account = (await res.json()) as Account
      if (await refreshAccessToken()) {
        setState({ status: 'signed-in', account })
        startRefreshLoop()
      } else {
        setState({ status: 'signed-out' })
      }
    })()

    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [startRefreshLoop])

  const signIn = useCallback(async () => {
    try {
      const code = await requestAuthCode(__GOOGLE_CLIENT_ID__)
      const res = await fetch('/api/auth/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } }
        setState({ status: 'signed-out', error: body.error?.message ?? 'sign-in failed' })
        return
      }
      const body = (await res.json()) as { accessToken: string; user: Account }
      setAccessToken(body.accessToken)
      setState({ status: 'signed-in', account: body.user })
      startRefreshLoop()
    } catch (err) {
      setState({ status: 'signed-out', error: err instanceof Error ? err.message : 'sign-in failed' })
    }
  }, [startRefreshLoop])

  const signOut = useCallback(async () => {
    // The session cookie is httpOnly, so only the server can drop it. Clearing local state
    // alone leaves the cookie in place and the next reload signs straight back in.
    try {
      await fetch('/api/auth/signout', { method: 'POST' })
    } catch {
      // Offline, say. Still drop the local token — a cookie we failed to clear is a worse
      // outcome than a stale one, but keeping the access token in memory is worse than both.
    }
    setAccessToken(null)
    if (timer.current) clearInterval(timer.current)
    setState({ status: 'signed-out' })
  }, [])

  return { ...state, signIn, signOut }
}
