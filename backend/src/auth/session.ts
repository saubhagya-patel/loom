import type { Request, RequestHandler, Response } from 'express'
import { AppError } from '../api/errors.ts'
import type { Config } from '../config/config.ts'
import type { User, Users } from '../store/users.ts'

const COOKIE = 'loom_session'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

// One session mechanism, and it is this cookie. TRD §8.3 also describes an
// `Authorization: Bearer <SESSION_JWT>`, but a token the frontend can put in a header is a
// token its JavaScript can read, which is the exact thing httpOnly exists to prevent
// (docs/plan.md §2.3). Bearer tokens still appear all over the client — only ever aimed at
// googleapis.com, carrying Google's access token, never ours.
export function setSessionCookie(res: Response, userId: string, cfg: Config): void {
  res.cookie(COOKIE, userId, {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    secure: cfg.cookieSecure,
    maxAge: MAX_AGE_MS,
    path: '/',
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE, { path: '/' })
}

// Signed cookies land in req.signedCookies; an unsigned or tampered value is dropped by
// cookie-parser before it reaches here rather than arriving as a forgeable string.
function sessionIdOf(req: Request): string | null {
  // @types/express types signedCookies as `any`; narrow it once, here.
  const cookies = req.signedCookies as Record<string, unknown> | undefined
  const raw = cookies?.[COOKIE]
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

export function withSession(users: Users): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      try {
        const id = sessionIdOf(req)
        if (!id) throw new AppError(401, 'unauthenticated', 'sign in required')

        const user = await users.get(id)
        // A valid signature naming a user who no longer exists is still unauthenticated —
        // and the stale cookie goes, so the client stops retrying with it.
        if (!user) {
          clearSessionCookie(res)
          throw new AppError(401, 'unauthenticated', 'sign in required')
        }

        res.locals.user = user
        next()
      } catch (err) {
        next(err)
      }
    })()
  }
}

// Reading the user through a function rather than augmenting Express's Request keeps the
// "did withSession actually run" question answerable at the call site instead of trusting a
// type that claims a property is always there.
export function sessionUser(res: Response): User {
  const user: unknown = res.locals.user
  if (!user) throw new AppError(401, 'unauthenticated', 'sign in required')
  return user as User
}
