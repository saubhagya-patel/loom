import './bigint-json.ts'
import { createApp } from './api/app.ts'
import { createGoogleAuth } from './auth/google.ts'
import { loadConfig } from './config/config.ts'
import { createDrive } from './drive/drive.ts'
import { createLogger } from './logger.ts'
import { createStore } from './store/store.ts'
import { createUsers } from './store/users.ts'
import { withTimeout } from './timeout.ts'

const STARTUP_TIMEOUT_MS = 10_000
const HEALTH_TIMEOUT_MS = 2_000

async function main(): Promise<void> {
  const cfg = loadConfig()
  const logger = createLogger(cfg)
  const store = createStore(cfg)

  // Fail at startup rather than on the first request.
  await withTimeout(store.ping(), STARTUP_TIMEOUT_MS, 'database connection')
  await store.verifySchema()
  logger.info('database connected')

  const app = createApp({
    logger,
    db: store,
    healthTimeoutMs: HEALTH_TIMEOUT_MS,
    cfg,
    users: createUsers(store.prisma, cfg.tokenKey),
    googleAuth: createGoogleAuth(cfg, logger),
    drive: createDrive(),
  })
  const server = app.listen(cfg.port, cfg.host, () => {
    logger.info({ host: cfg.host, port: cfg.port }, 'listening')
  })

  let shuttingDown = false
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, 'shutdown requested')

    const force = setTimeout(() => {
      logger.warn({ timeoutMs: cfg.shutdownTimeoutMs }, 'shutdown timed out, closing connections')
      server.closeAllConnections()
    }, cfg.shutdownTimeoutMs)

    server.close((err) => {
      clearTimeout(force)
      void (async () => {
        if (err) logger.error({ err }, 'closing the server failed')
        await store.close()
        logger.info('stopped cleanly')
        process.exit(err ? 1 : 0)
      })()
    })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

try {
  await main()
} catch (err) {
  // The logger may not exist yet — configuration is the first thing that can fail.
  console.error('loom failed to start:', err instanceof Error ? err.message : err)
  process.exit(1)
}
