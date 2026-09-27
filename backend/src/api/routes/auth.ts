import { Router } from 'express'
import * as z from 'zod'
import type { GoogleAuth } from '../../auth/google.ts'
import { setSessionCookie, sessionUser, withSession } from '../../auth/session.ts'
import type { Config } from '../../config/config.ts'
import type { Drive } from '../../drive/drive.ts'
import type { Users } from '../../store/users.ts'
import { AppError } from '../errors.ts'

const exchangeBody = z.object({ code: z.string().min(1) })

export type AuthRouteDeps = {
  cfg: Config
  users: Users
  googleAuth: GoogleAuth
  drive: Drive
}

export function authRoutes({ cfg, users, googleAuth, drive }: AuthRouteDeps): Router {
  const router = Router()

  router.post('/exchange', async (req, res) => {
    const parsed = exchangeBody.safeParse(req.body)
    if (!parsed.success) throw new AppError(400, 'invalid_request', 'a code is required')

    // The redirect_uri Google wants in popup mode is the calling page's origin, so it comes
    // from the request rather than from config — requireOrigin has already vetted it, and
    // localhost vs 127.0.0.1 would otherwise mismatch.
    const pageOrigin = req.get('origin') ?? cfg.webOrigin
    const google = await googleAuth.exchangeCode(parsed.data.code, pageOrigin)

    // Read the existing row before writing, so we know whether a folder already belongs to
    // this user — this is what stops a second sign-in creating a second folder.
    const existing = await users.get(google.sub)

    // The user row lands first: setAppFolderId below needs something to update, and storing
    // the refresh token is the part we least want to lose if the Drive call then fails.
    await users.upsert({ id: google.sub, email: google.email, ...(google.refreshToken ? { refreshToken: google.refreshToken } : {}) })

    const appFolderId = await drive.ensureAppFolder(google.accessToken, existing?.appFolderId ?? null)
    if (appFolderId !== existing?.appFolderId) {
      await users.setAppFolderId(google.sub, appFolderId)
    }

    setSessionCookie(res, google.sub, cfg)

    // The access token is returned and never stored: it lives in the browser's memory for an
    // hour and nowhere else (docs/plan.md §2.4).
    res.json({ accessToken: google.accessToken, user: { email: google.email, appFolderId } })
  })

  router.post('/refresh', withSession(users), async (_req, res) => {
    const user = sessionUser(res)
    const refreshToken = await users.refreshTokenOf(user.id)
    if (!refreshToken) throw new AppError(401, 'unauthenticated', 'sign in required')

    const tokens = await googleAuth.refresh(refreshToken)

    // Google can rotate the refresh token. When it does, store the new one; when it does
    // not, `refreshToken` is undefined here and the repository leaves the stored value alone.
    if (tokens.refreshToken) {
      await users.upsert({ id: user.id, email: user.email, refreshToken: tokens.refreshToken })
    }
    res.json({ accessToken: tokens.accessToken })
  })

  return router
}
