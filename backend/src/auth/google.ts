import type { Logger } from 'pino'
import { AppError } from '../api/errors.ts'
import type { Config } from '../config/config.ts'

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

// The literal string the legacy gapi.auth2 flow expects in place of a real URI.
const POSTMESSAGE = 'postmessage'

export type GoogleTokens = { accessToken: string; refreshToken?: string; expiresInS: number }
export type GoogleIdentity = { sub: string; email: string }
export type GoogleAuth = {
  exchangeCode: (code: string, pageOrigin: string) => Promise<GoogleTokens & GoogleIdentity>
  refresh: (refreshToken: string) => Promise<GoogleTokens>
}

const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo'

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  id_token?: string
}

type PostResult = { ok: true; data: TokenResponse } | { ok: false; error: string }

// Google's error body is `{ error, error_description }`. We keep only the machine-readable
// code — `error_description` is free text from an upstream we do not control, and it is one
// of the ways a request detail ends up in a log line (docs/plan.md §2.8).
async function post(body: URLSearchParams): Promise<PostResult> {
  let res: Response
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  } catch {
    // A failed fetch's error carries the request URL and, on other paths, the body. None of
    // it crosses this boundary — see docs/plan.md §2.8.
    return { ok: false, error: 'unreachable' }
  }

  const json: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const code =
      json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string'
        ? (json as { error: string }).error
        : `http_${res.status}`
    return { ok: false, error: code }
  }
  return { ok: true, data: json as TokenResponse }
}

function toTokens(raw: TokenResponse): GoogleTokens {
  const tokens: GoogleTokens = { accessToken: raw.access_token, expiresInS: raw.expires_in }
  // Google issues a refresh token on first consent and usually not on re-authorisation.
  // Absence must stay `undefined` rather than becoming '' — the repository reads undefined
  // as "keep whatever is stored", which is what stops a second sign-in destroying a working
  // credential.
  if (raw.refresh_token) tokens.refreshToken = raw.refresh_token
  return tokens
}

function asIdentity(claims: { sub?: unknown; email?: unknown }): GoogleIdentity | null {
  return typeof claims.sub === 'string' && typeof claims.email === 'string'
    ? { sub: claims.sub, email: claims.email }
    : null
}

// The id_token arrives over TLS directly from Google's token endpoint, in response to a
// request carrying our client secret. That is the one documented case where the signature
// need not be re-verified, so this reads the claims rather than pulling in a JWKS client.
function identityFromIdToken(idToken: string | undefined): GoogleIdentity | null {
  const payload = idToken?.split('.')[1]
  if (!payload) return null
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return claims && typeof claims === 'object' ? asIdentity(claims) : null
  } catch {
    return null
  }
}

// Google does not always return an id_token from a code exchange — notably on a
// re-authorisation where consent already exists. Rather than fail a sign-in that is
// otherwise fine, ask the userinfo endpoint, which the same `openid email` grant covers.
async function identityFromUserinfo(accessToken: string): Promise<GoogleIdentity | null> {
  try {
    const res = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    return asIdentity((await res.json()) as { sub?: unknown; email?: unknown })
  } catch {
    return null
  }
}

async function resolveIdentity(raw: TokenResponse): Promise<GoogleIdentity> {
  const identity =
    identityFromIdToken(raw.id_token) ?? (await identityFromUserinfo(raw.access_token))
  if (!identity) {
    // Almost always means the authorization request carried no identity scope, so there is
    // no sub or email to be had — see the SCOPE comment in web/src/auth/gis.ts.
    throw new AppError(
      502,
      'google_bad_response',
      'google returned no identity; the sign-in scope must include openid and email',
    )
  }
  return identity
}

export function createGoogleAuth(cfg: Config, logger: Logger): GoogleAuth {
  // Which redirect_uri a popup-mode code exchange needs is genuinely contested: the current
  // GIS guide says the calling page's origin, while a large body of samples inherited from
  // gapi.auth2 says the literal 'postmessage' and reports nothing else works
  // (agent-cache/knowledge.md). Rather than guess in config, learn it once and remember.
  //
  // Same idea as the extranet-backend content cache — a value filled once, read freely after
  // — but held in this factory's closure rather than at module scope, so it still arrives as
  // a dependency and cannot be reached or mutated from elsewhere (docs/process.md §6).
  // What is learned is the *strategy*, not a literal URI. The page origin differs between
  // http://localhost:5173 and http://127.0.0.1:5173 — the same dev server, two origins — and
  // caching one of those strings would send the wrong one the moment the other is used.
  let learnedStrategy: 'origin' | 'postmessage' | null = null

  return {
    exchangeCode: async (code, pageOrigin) => {
      // GIS documents redirect_uri in popup mode as "the origin of the calling page", so the
      // candidate is the origin this request actually came from, not a configured constant.
      const forStrategy = (s: 'origin' | 'postmessage'): string =>
        s === 'origin' ? pageOrigin : POSTMESSAGE
      const strategies: ('origin' | 'postmessage')[] = learnedStrategy
        ? [learnedStrategy]
        : ['origin', 'postmessage']
      let lastError = 'unknown'

      for (const strategy of strategies) {
        const redirectUri = forStrategy(strategy)
        const result = await post(
          new URLSearchParams({
            code,
            client_id: cfg.google.clientId,
            client_secret: cfg.google.clientSecret,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
          }),
        )

        if (result.ok) {
          if (learnedStrategy !== strategy) {
            learnedStrategy = strategy
            // Configuration, not media, so it is allowed in a log — and it is the answer we
            // want to promote into knowledge.md and eventually hard-code.
            logger.info({ strategy, redirectUri }, 'learned google redirect_uri')
          }
          return { ...toTokens(result.data), ...(await resolveIdentity(result.data)) }
        }

        lastError = result.error
        // Only a mismatch justifies trying the other candidate. A wrong client secret has to
        // fail as a wrong client secret, not as two confusing attempts against two URIs.
        if (result.error !== 'redirect_uri_mismatch') break
      }

      throw new AppError(401, 'google_exchange_failed', `google rejected the sign-in: ${lastError}`)
    },

    refresh: async (refreshToken) => {
      const result = await post(
        new URLSearchParams({
          refresh_token: refreshToken,
          client_id: cfg.google.clientId,
          client_secret: cfg.google.clientSecret,
          grant_type: 'refresh_token',
        }),
      )
      if (!result.ok) {
        // invalid_grant here usually means the refresh token was revoked — or that the OAuth
        // consent screen is still in "Testing", which expires them after 7 days and looks
        // exactly like a bug in token-crypto.ts (agent-cache/knowledge.md).
        throw new AppError(401, 'google_refresh_failed', `google refused the refresh: ${result.error}`)
      }
      return toTokens(result.data)
    },
  }
}
