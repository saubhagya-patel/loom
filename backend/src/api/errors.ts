import type { ErrorRequestHandler, RequestHandler } from 'express'
import type { Logger } from 'pino'

// Thrown by handlers that know what went wrong and what the client may be told.
// Phase 1's validation failures and Google's error responses land here.
export class AppError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AppError'
    this.status = status
    this.code = code
  }
}

export function notFound(): RequestHandler {
  return (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'not found' } })
  }
}

// The client gets a code and a safe message; the cause goes to the log only.
//
// docs/plan.md §2.8 applies from here on: once Drive is involved, an error can
// carry a filename or a resumable session URI in its message or its request URL,
// so errors crossing that boundary must be sanitized before they arrive here.
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    logger.error({ err, method: req.method, path: req.path }, 'unhandled error')
    if (res.headersSent) return

    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } })
      return
    }

    // express.json() and friends throw http-errors carrying their own status and an
    // `expose` flag. Without this a malformed JSON body answers 500 — blaming us for the
    // client's mistake, and hiding real 500s among the noise. The message stays ours: theirs
    // quotes the offending input, which is exactly what must not be echoed (docs/plan.md §2.8).
    const status: unknown = (err as { status?: unknown }).status
    const expose: unknown = (err as { expose?: unknown }).expose
    if (typeof status === 'number' && status >= 400 && status < 500 && expose === true) {
      res.status(status).json({ error: { code: 'invalid_request', message: 'malformed request' } })
      return
    }

    res.status(500).json({ error: { code: 'internal', message: 'internal server error' } })
  }
}
