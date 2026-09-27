import { Router } from 'express'
import { sessionUser, withSession } from '../../auth/session.ts'
import type { Users } from '../../store/users.ts'

export function userRoutes(users: Users): Router {
  const router = Router()

  // TRD §8.3 specifies an `Authorization: Bearer <SESSION_JWT>` here. It reads the session
  // cookie instead — see docs/plan.md §2.3 and the comment in auth/session.ts.
  router.get('/config', withSession(users), (_req, res) => {
    const user = sessionUser(res)
    res.json({ appFolderId: user.appFolderId, email: user.email })
  })

  return router
}
