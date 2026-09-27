// docs/plan.md §2.4: the Google access token lives in this module variable and nowhere else.
// Not localStorage, not sessionStorage, not IndexedDB, not a cookie. A reload throws it away
// and POST /api/auth/refresh mints a new one — the session cookie is what survives a reload,
// so the access token does not have to.
//
// This matters more here than in most apps, because direct-to-Drive upload (TRD §2) requires
// the browser to hold a real Google token. That is the mechanism, not a compromise; what
// bounds it is drive.file scope, a one-hour life, and never writing it down.
let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}

let inFlight: Promise<boolean> | null = null

// Collapsed into one in-flight request on purpose. A long upload can take a 401 on a chunk at
// the same moment the proactive 55-minute timer fires; two refreshes would race, and the loser
// would overwrite a good token with a staler one mid-upload.
export function refreshAccessToken(): Promise<boolean> {
  inFlight ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST' })
      if (!res.ok) return false
      const body = (await res.json()) as { accessToken: string }
      setAccessToken(body.accessToken)
      return true
    } catch {
      return false
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}
