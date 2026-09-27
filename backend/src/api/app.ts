import cookieParser from 'cookie-parser'
import express, { type Express, type RequestHandler } from 'express'
import helmet from 'helmet'
import type { Logger } from 'pino'
import type { GoogleAuth } from '../auth/google.ts'
import type { Config } from '../config/config.ts'
import type { Drive } from '../drive/drive.ts'
import type { Pinger } from '../store/store.ts'
import type { Users } from '../store/users.ts'
import { AppError, errorHandler, notFound } from './errors.ts'
import { healthHandler } from './health.ts'
import { authRoutes } from './routes/auth.ts'
import { mediaRoutes } from './routes/media.ts'
import { userRoutes } from './routes/user.ts'

// Method, path, status and duration — and deliberately nothing else. A filename
// must never reach a log line, which is also why no Loom endpoint takes one in a
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

// `localhost` and `127.0.0.1` are the same dev server but two different origins — to
// browsers, and to Google (agent-cache/knowledge.md). vite pins 127.0.0.1 while typing
// "localhost:5173" is the more natural thing to do, so when the configured origin is
// loopback its sibling is accepted too. A non-loopback origin gets no siblings: a real
// deployment allows exactly what it was configured with.
function allowedOrigins(webOrigin: string): Set<string> {
  const allowed = new Set([webOrigin])
  const url = new URL(webOrigin) // already validated as a URL by config.ts
  const sibling =
    url.hostname === '127.0.0.1' ? 'localhost' : url.hostname === 'localhost' ? '127.0.0.1' : null
  if (sibling) {
    url.hostname = sibling
    allowed.add(url.origin)
  }
  return allowed
}

// Half of the V1 CSRF answer; SameSite=Lax on the session cookie is the other half
// (docs/plan.md §2.3). A browser always sends Origin on a cross-site POST, so a mismatch is
// decisive. Its *absence* is not an attack signal — same-origin requests and non-browser
// clients both omit it — so only a present-and-wrong Origin is rejected.
function requireOrigin(cfg: Config, logger: Logger): RequestHandler {
  const allowed = allowedOrigins(cfg.webOrigin)
  return (req, _res, next) => {
    if (req.method !== 'POST') {
      next()
      return
    }
    const origin = req.get('origin')
    if (origin !== undefined && !allowed.has(origin)) {
      // An Origin is neither media nor a credential, and a rejection that does not say what
      // it saw costs a debugging session — this one already did.
      logger.warn({ origin, allowed: [...allowed] }, 'rejected a post from an unknown origin')
      next(new AppError(403, 'bad_origin', 'origin not allowed'))
      return
    }
    next()
  }
}

export type AppDeps = {
  logger: Logger
  db: Pinger
  healthTimeoutMs: number
  cfg: Config
  users: Users
  googleAuth: GoogleAuth
  drive: Drive
}

export function createApp({
  logger,
  db,
  healthTimeoutMs,
  cfg,
  users,
  googleAuth,
  drive,
}: AppDeps): Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(helmet())
  app.use(cookieParser(cfg.sessionSecret))
  app.use(requestLogger(logger))
  // Ahead of the body parser on purpose: a POST from a foreign origin is refused before we
  // spend anything reading or parsing what it sent.
  app.use(requireOrigin(cfg, logger))
  app.use(express.json())

  app.get('/healthz', healthHandler(logger, db, healthTimeoutMs))
  app.use('/api/auth', authRoutes({ cfg, users, googleAuth, drive }))
  app.use('/api/user', userRoutes(users))
  app.use('/api/media', mediaRoutes(users))

  app.use(notFound())
  app.use(errorHandler(logger))
  return app
}
