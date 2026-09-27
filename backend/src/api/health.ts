import type { RequestHandler } from 'express'
import type { Logger } from 'pino'
import type { Pinger } from '../store/store.ts'
import { withTimeout } from '../timeout.ts'

export function healthHandler(logger: Logger, db: Pinger, timeoutMs: number): RequestHandler {
  return async (_req, res) => {
    try {
      await withTimeout(db.ping(), timeoutMs, 'database ping')
      res.status(200).json({ status: 'ok', checks: { database: 'ok' } })
    } catch (err) {
      // Unauthenticated endpoint: the cause is logged, never returned. The
      // connection string carries credentials, so this is not a formality.
      logger.error({ err, check: 'database' }, 'health check failed')
      res.status(503).json({ status: 'degraded', checks: { database: 'unavailable' } })
    }
  }
}
