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
