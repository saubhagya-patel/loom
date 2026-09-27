import type { Logger } from 'pino'
import { AppError } from '../api/errors.ts'
import type { Config } from '../config/config.ts'

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

// The literal string the legacy gapi.auth2 flow expects in place of a real URI.
const POSTMESSAGE = 'postmessage'

export type GoogleTokens = { accessToken: string; refreshToken?: string; expiresInS: number }
export type GoogleIdentity = { sub: string; email: string }
export type GoogleAuth = {
  exchangeCode: (code: string) => Promise<GoogleTokens & GoogleIdentity>
  refresh: (refreshToken: string) => Promise<GoogleTokens>
}

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

// The id_token arrives over TLS directly from Google's token endpoint, in response to a
// request carrying our client secret. That is the one documented case where the signature
// need not be re-verified, so this reads the claims rather than pulling in a JWKS client.
function identityFrom(idToken: string | undefined): GoogleIdentity {
  const payload = idToken?.split('.')[1]
  if (!payload) throw new AppError(502, 'google_bad_response', 'google returned no identity')

  let claims: { sub?: unknown; email?: unknown }
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as typeof claims
  } catch {
    throw new AppError(502, 'google_bad_response', 'google returned an unreadable identity')
  }

  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') {
    throw new AppError(502, 'google_bad_response', 'google identity is missing sub or email')
  }
  return { sub: claims.sub, email: claims.email }
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
  let learnedRedirectUri: string | null = null

  return {
    exchangeCode: async (code) => {
      // Once known, one candidate. Until then, the documented answer first.
      const candidates = learnedRedirectUri ? [learnedRedirectUri] : [cfg.webOrigin, POSTMESSAGE]
      let lastError = 'unknown'

      for (const redirectUri of candidates) {
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
          if (learnedRedirectUri !== redirectUri) {
            learnedRedirectUri = redirectUri
            // Configuration, not media, so it is allowed in a log — and it is the answer we
            // want to promote into knowledge.md and eventually hard-code.
            logger.info({ redirectUri }, 'learned google redirect_uri')
          }
          return { ...toTokens(result.data), ...identityFrom(result.data.id_token) }
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
