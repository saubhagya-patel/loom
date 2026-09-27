import * as z from 'zod'

export type Config = {
  host: string
  port: number
  databaseUrl: string
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  logFormat: 'text' | 'json'
  shutdownTimeoutMs: number
}

// Keys are the environment variable names so Zod's issue paths name the
// variable an operator has to fix. Messages never quote the input value: a
// DATABASE_URL carries a password, and a startup failure is the thing most
// likely to be pasted somewhere public (docs/plan.md §2.8).
const schema = z.object({
  DATABASE_URL: z
    .url({ error: 'must be a mysql:// connection URL' })
    .refine((u) => u.startsWith('mysql://'), { error: 'must use the mysql:// scheme' }),
  LUMA_HOST: z.string().min(1).default('127.0.0.1'),
  LUMA_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LUMA_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LUMA_LOG_FORMAT: z.enum(['text', 'json']).default('text'),
  LUMA_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
})

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`invalid configuration:\n${problems}`)
  }

  const e = parsed.data
  return {
    host: e.LUMA_HOST,
    port: e.LUMA_PORT,
    databaseUrl: e.DATABASE_URL,
    logLevel: e.LUMA_LOG_LEVEL,
    logFormat: e.LUMA_LOG_FORMAT,
    shutdownTimeoutMs: e.LUMA_SHUTDOWN_TIMEOUT_MS,
  }
}
