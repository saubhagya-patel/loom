import { pino, type Logger } from 'pino'
import pretty from 'pino-pretty'
import type { Config } from './config/config.ts'

export type { Logger }

// A backstop, not the defence. docs/plan.md §2.8 is satisfied by not putting these values
// into a log call in the first place — errors crossing the Google boundary are wrapped in a
// sanitized AppError before they reach the logger (auth/google.ts, drive/drive.ts). This
// list is what catches the case someone forgets, and the Phase 0 Task 9 spike is why it
// matters: a resumable session URI is a bearer credential, so a `Location` reaching a log
// line is a leaked write capability into someone's Drive, not merely an untidy log.
//
// Kept deliberately narrow. Redacting broadly — `*.code`, say — would also blank AppError's
// own `code`, and a log that hides why a request failed gets replaced by one that does not.
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers.location',
  '*.authorization',
  '*.accessToken',
  '*.access_token',
  '*.refreshToken',
  '*.refresh_token',
  '*.sessionUri',
  '*.session_uri',
  '*.idToken',
  '*.id_token',
]

// pino-pretty as a stream rather than a transport: a transport runs in a worker
// thread, which both holds the process open at shutdown and can truncate the
// final log lines.
//
// Whatever is logged through this must obey docs/plan.md §2.8 — no filename,
// Drive id, folder id, size, MIME type, EXIF field or resumable session URI, on
// any path including error handlers.
export function createLogger(cfg: Config): Logger {
  const options = {
    level: cfg.logLevel,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  }
  if (cfg.logFormat === 'json') return pino(options)
  return pino(options, pretty({ colorize: true }))
}
