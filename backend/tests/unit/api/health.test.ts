import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { test } from 'node:test'
import express, { type Express } from 'express'
import { pino, type Logger } from 'pino'
import { createApp } from '../../../src/api/app.ts'
import { errorHandler, notFound } from '../../../src/api/errors.ts'
import type { Pinger } from '../../../src/store/store.ts'

type LogLine = Record<string, unknown>

// A real pino logger writing into memory, so these tests assert on the log
// output the server actually produces rather than on a stub's call arguments.
function captureLogger(): { logger: Logger; lines: () => LogLine[] } {
  const chunks: string[] = []
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString())
      callback()
    },
  })
  return {
    logger: pino({ level: 'debug' }, stream),
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as LogLine),
  }
}

async function withServer(app: Express, fn: (base: string) => Promise<void>): Promise<void> {
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  const address = server.address()
  assert.ok(address !== null && typeof address === 'object', 'expected a TCP address')
  try {
    await fn(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

const OK: Pinger = { ping: () => Promise.resolve() }

// The message deliberately carries a host and credentials: a health check that
// echoed its cause would leak exactly this, and only an assertion against real
// secret-shaped text can catch it.
const LEAKY_FAILURE = 'connect ECONNREFUSED 127.0.0.1:3307 (user=luma password=luma)'
const FAILING: Pinger = { ping: () => Promise.reject(new Error(LEAKY_FAILURE)) }
const HANGING: Pinger = { ping: () => new Promise<void>(() => {}) }

test('healthy database answers 200 with ok checks', async () => {
  const { logger } = captureLogger()
  const app = createApp({ logger, db: OK, healthTimeoutMs: 1_000 })

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/healthz`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /application\/json/)
    assert.deepEqual(await res.json(), { status: 'ok', checks: { database: 'ok' } })
  })
})

test('a failing ping answers 503 and never returns the cause', async () => {
  const { logger, lines } = captureLogger()
  const app = createApp({ logger, db: FAILING, healthTimeoutMs: 1_000 })

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/healthz`)
    assert.equal(res.status, 503)

    const body = await res.text()
    assert.deepEqual(JSON.parse(body), {
      status: 'degraded',
      checks: { database: 'unavailable' },
    })
    // The point of the test: none of the cause reaches the client.
    assert.doesNotMatch(body, /ECONNREFUSED/)
    assert.doesNotMatch(body, /password/)
    assert.doesNotMatch(body, /3307/)
  })

  // ...and all of it reaches the log.
  const logged = lines().find((line) => line['msg'] === 'health check failed')
  assert.ok(logged, 'expected the failure to be logged')
  assert.match(JSON.stringify(logged), /ECONNREFUSED/)
})

test('a hanging ping answers 503 without waiting for it', async () => {
  const { logger } = captureLogger()
  const app = createApp({ logger, db: HANGING, healthTimeoutMs: 50 })

  await withServer(app, async (base) => {
    const started = Date.now()
    const res = await fetch(`${base}/healthz`)
    const elapsed = Date.now() - started

    assert.equal(res.status, 503)
    assert.deepEqual(await res.json(), {
      status: 'degraded',
      checks: { database: 'unavailable' },
    })
    assert.ok(elapsed < 2_000, `expected a fast 503, took ${elapsed}ms`)
  })
})

test('an unknown path answers 404 in the error envelope', async () => {
  const { logger } = captureLogger()
  const app = createApp({ logger, db: OK, healthTimeoutMs: 1_000 })

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/nope`)
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: { code: 'not_found', message: 'not found' } })
  })
})

test('a throwing handler answers 500, logs the cause and returns none of it', async () => {
  const { logger, lines } = captureLogger()
  const app = express()
  app.get('/boom', () => {
    throw new Error(LEAKY_FAILURE)
  })
  app.use(notFound())
  app.use(errorHandler(logger))

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/boom`)
    assert.equal(res.status, 500)

    const body = await res.text()
    assert.deepEqual(JSON.parse(body), {
      error: { code: 'internal', message: 'internal server error' },
    })
    assert.doesNotMatch(body, /ECONNREFUSED/)
    assert.doesNotMatch(body, /password/)
  })

  const logged = lines().find((line) => line['msg'] === 'unhandled error')
  assert.ok(logged, 'expected the error to be logged')
  assert.match(JSON.stringify(logged), /ECONNREFUSED/)
})

test('an async rejection reaches the error middleware without a wrapper', async () => {
  const { logger } = captureLogger()
  const app = express()
  // Express 5 forwards a rejected async handler on its own; Express 4 would not.
  app.get('/boom', async () => {
    await Promise.resolve()
    throw new Error('async failure')
  })
  app.use(notFound())
  app.use(errorHandler(logger))

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/boom`)
    assert.equal(res.status, 500)
  })
})

// docs/plan.md §2.8: request logging is method / path / status / duration and
// nothing else. This asserts the *absence* of extra fields, because that is the
// direction a privacy leak travels.
test('request logging carries no fields beyond method, path, status and duration', async () => {
  const { logger, lines } = captureLogger()
  const app = createApp({ logger, db: OK, healthTimeoutMs: 1_000 })

  await withServer(app, async (base) => {
    await fetch(`${base}/healthz`)
  })

  const request = lines().find((line) => line['msg'] === 'request')
  assert.ok(request, 'expected a request log line')
  assert.deepEqual(
    Object.keys(request)
      .filter((k) => !['level', 'time', 'pid', 'hostname', 'msg'].includes(k))
      .sort(),
    ['method', 'ms', 'path', 'status'],
  )
})
