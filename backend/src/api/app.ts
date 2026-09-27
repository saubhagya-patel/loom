import express, { type Express, type RequestHandler } from 'express'
import type { Logger } from 'pino'
import type { Pinger } from '../store/store.ts'
import { errorHandler, notFound } from './errors.ts'
import { healthHandler } from './health.ts'

// Method, path, status and duration — and deliberately nothing else. A filename
// must never reach a log line, which is also why no Luma endpoint takes one in a
// query string (docs/plan.md §2.8).
function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const start = process.hrtime.bigint()
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6
      logger.info({ method: req.method, path: req.path, status: res.statusCode, ms }, 'request')
    })
    next()
  }
}

export type AppDeps = {
  logger: Logger
  db: Pinger
  healthTimeoutMs: number
}

export function createApp({ logger, db, healthTimeoutMs }: AppDeps): Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json())
  app.use(requestLogger(logger))

  app.get('/healthz', healthHandler(logger, db, healthTimeoutMs))

  app.use(notFound())
  app.use(errorHandler(logger))
  return app
}
