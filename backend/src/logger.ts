import { pino, type Logger } from 'pino'
import pretty from 'pino-pretty'
import type { Config } from './config/config.ts'

export type { Logger }

// pino-pretty as a stream rather than a transport: a transport runs in a worker
// thread, which both holds the process open at shutdown and can truncate the
// final log lines.
//
// Whatever is logged through this must obey docs/plan.md §2.8 — no filename,
// Drive id, folder id, size, MIME type, EXIF field or resumable session URI, on
// any path including error handlers.
export function createLogger(cfg: Config): Logger {
  if (cfg.logFormat === 'json') return pino({ level: cfg.logLevel })
  return pino({ level: cfg.logLevel }, pretty({ colorize: true }))
}
