import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadConfig } from '../../../src/config/config.ts'

const VALID_URL = 'mysql://loom:loom@127.0.0.1:3307/loom'

test('applies defaults when only the required values are present', () => {
  const cfg = loadConfig({ DATABASE_URL: VALID_URL })

  assert.equal(cfg.databaseUrl, VALID_URL)
  assert.equal(cfg.host, '127.0.0.1')
  assert.equal(cfg.port, 8080)
  assert.equal(cfg.logLevel, 'info')
  assert.equal(cfg.logFormat, 'text')
  assert.equal(cfg.shutdownTimeoutMs, 10_000)
})

test('every value can be overridden', () => {
  const cfg = loadConfig({
    DATABASE_URL: VALID_URL,
    LOOM_HOST: '0.0.0.0',
    LOOM_PORT: '9999',
    LOOM_LOG_LEVEL: 'debug',
    LOOM_LOG_FORMAT: 'json',
    LOOM_SHUTDOWN_TIMEOUT_MS: '250',
  })

  assert.equal(cfg.host, '0.0.0.0')
  assert.equal(cfg.port, 9999)
  assert.equal(cfg.logLevel, 'debug')
  assert.equal(cfg.logFormat, 'json')
  assert.equal(cfg.shutdownTimeoutMs, 250)
})

test('a missing DATABASE_URL is an error that names the variable', () => {
  assert.throws(() => loadConfig({}), /DATABASE_URL/)
})

test('DATABASE_URL must be a URL', () => {
  assert.throws(() => loadConfig({ DATABASE_URL: 'not-a-url' }), /DATABASE_URL/)
})

test('DATABASE_URL must use the mysql:// scheme', () => {
  assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/loom' }), /mysql/)
})

// docs/plan.md §2.8: the connection string carries a password, and a startup
// failure is the most likely thing to be pasted into a chat or an issue.
test('a configuration error never echoes the database password', () => {
  assert.throws(
    () => loadConfig({ DATABASE_URL: 'postgres://loom:sup3rs3cr3t@127.0.0.1:5432/loom' }),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.doesNotMatch(err.message, /sup3rs3cr3t/)
      return true
    },
  )
})

test('an unknown log level is an error', () => {
  assert.throws(() => loadConfig({ DATABASE_URL: VALID_URL, LOOM_LOG_LEVEL: 'chatty' }), /LOG_LEVEL/)
})

test('an unknown log format is an error', () => {
  assert.throws(
    () => loadConfig({ DATABASE_URL: VALID_URL, LOOM_LOG_FORMAT: 'yaml' }),
    /LOG_FORMAT/,
  )
})

test('a non-numeric port is an error', () => {
  assert.throws(() => loadConfig({ DATABASE_URL: VALID_URL, LOOM_PORT: 'eighty' }), /LOOM_PORT/)
})

test('a port outside 1-65535 is an error', () => {
  assert.throws(() => loadConfig({ DATABASE_URL: VALID_URL, LOOM_PORT: '70000' }), /LOOM_PORT/)
})

test('a non-numeric shutdown timeout is an error', () => {
  assert.throws(
    () => loadConfig({ DATABASE_URL: VALID_URL, LOOM_SHUTDOWN_TIMEOUT_MS: 'soon' }),
    /SHUTDOWN_TIMEOUT_MS/,
  )
})

test('a zero or negative shutdown timeout is an error', () => {
  for (const value of ['0', '-1']) {
    assert.throws(
      () => loadConfig({ DATABASE_URL: VALID_URL, LOOM_SHUTDOWN_TIMEOUT_MS: value }),
      /SHUTDOWN_TIMEOUT_MS/,
      `expected ${value} to be rejected`,
    )
  }
})

// The point of validating with a schema rather than a chain of ifs: an operator
// with three things wrong fixes them in one pass instead of three restarts.
test('reports every problem at once, not just the first', () => {
  try {
    loadConfig({
      LOOM_PORT: 'eighty',
      LOOM_LOG_LEVEL: 'chatty',
      LOOM_SHUTDOWN_TIMEOUT_MS: '-1',
    })
    assert.fail('expected loadConfig to throw')
  } catch (err) {
    assert.ok(err instanceof Error)
    for (const name of [
      'DATABASE_URL',
      'LOOM_PORT',
      'LOOM_LOG_LEVEL',
      'LOOM_SHUTDOWN_TIMEOUT_MS',
    ]) {
      assert.match(err.message, new RegExp(name), `expected ${name} in the report`)
    }
  }
})
