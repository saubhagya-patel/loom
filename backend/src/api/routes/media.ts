import { Router } from 'express'
import { withSession } from '../../auth/session.ts'
import { transcodeToDrive } from '../../media/transcode.ts'
import type { Users } from '../../store/users.ts'
import { AppError } from '../errors.ts'

// HEIC stills are single-digit megabytes. 32 MiB rejects abuse without rejecting real photos
// (docs/plan.md §2.7).
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024

/**
 * The client hands us a resumable session URI it created with its own Drive token, and we PUT
 * into it. That makes this endpoint a thing that writes to a URL someone else chose — so the
 * URL has to be checked, or Loom is an open relay that will stream an authenticated user's
 * bytes anywhere on the internet.
 */
function isDriveUploadUri(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname === 'www.googleapis.com' &&
      url.pathname.startsWith('/upload/drive/v3/files')
    )
  } catch {
    return false
  }
}

export function mediaRoutes(users: Users): Router {
  const router = Router()

  router.post('/transcode-stream', withSession(users), async (req, res) => {
    // Checked from Content-Length BEFORE busboy sees a byte. Rejecting mid-stream means having
    // already accepted the bytes you are objecting to.
    const declared = Number(req.get('content-length') ?? '')
    if (!Number.isFinite(declared) || declared <= 0) {
      throw new AppError(411, 'length_required', 'a content length is required')
    }
    if (declared > MAX_UPLOAD_BYTES) {
      throw new AppError(413, 'too_large', 'that photo is too large to convert here')
    }

    // A header rather than a form field: it is available before the body is parsed, so the
    // check above and this one both happen before a byte is read, with no dependence on the
    // client ordering its multipart parts helpfully.
    const sessionUri = req.get('x-loom-session-uri') ?? ''
    if (!isDriveUploadUri(sessionUri)) {
      throw new AppError(400, 'invalid_request', 'a drive upload session is required')
    }

    const driveFileId = await transcodeToDrive(req, sessionUri, MAX_UPLOAD_BYTES)

    // TRD §8.4's shape. The id is fine in a response — the client needs it to verify — but it
    // never reaches a log line (§2.8).
    res.json({ status: 'success', driveFileId })
  })

  return router
}
