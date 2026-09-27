import * as z from 'zod'

export type Config = {
  host: string
  port: number
  databaseUrl: string
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  logFormat: 'text' | 'json'
  shutdownTimeoutMs: number
  google: { clientId: string; clientSecret: string }
  tokenKey: string
  sessionSecret: string
  webOrigin: string
  cookieSecure: boolean
  /** Where the built SPA lives, when this process also serves it. */
  staticDir: string | null
}

// Keys are the environment variable names so Zod's issue paths name the
// variable an operator has to fix. Messages never quote the input value: a
// DATABASE_URL carries a password, and a startup failure is the thing most
// likely to be pasted somewhere public (docs/plan.md §2.8). That rule matters
// more from here on — four of these are secrets.
const schema = z.object({
  DATABASE_URL: z
    .url({ error: 'must be a mysql:// connection URL' })
    .refine((u) => u.startsWith('mysql://'), { error: 'must use the mysql:// scheme' }),
  LOOM_HOST: z.string().min(1).default('127.0.0.1'),
  LOOM_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOOM_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOOM_LOG_FORMAT: z.enum(['text', 'json']).default('text'),
  LOOM_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  LOOM_GOOGLE_CLIENT_ID: z.string().min(1),
  LOOM_GOOGLE_CLIENT_SECRET: z.string().min(1),

  // Checked here, at startup, because the alternative is discovering a short key
  // inside createCipheriv on the first sign-in — by which point we have a live
  // refresh token in hand and nowhere safe to put it (docs/plan.md §2.2).
  LOOM_TOKEN_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, {
    error: 'must decode to exactly 32 bytes — generate with: openssl rand -base64 32',
  }),

  LOOM_SESSION_SECRET: z.string().min(16, { error: 'must be at least 16 characters' }),

  LOOM_WEB_ORIGIN: z.url({ error: 'must be a full origin including the scheme' }).default(
    // 127.0.0.1, not localhost: vite.config.ts pins the dev server to this host, and Google
    // treats the two as different origins (agent-cache/knowledge.md).
    'http://127.0.0.1:5173',
  ),

  // Not z.coerce.boolean(): it follows JS truthiness, so the string 'false' would
  // coerce to true and quietly ship insecure cookies.
  LOOM_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Set in a single-service deployment, where this process serves the built SPA as well as
  // the API. Left unset in development, where vite serves it and proxies /api here.
  LOOM_STATIC_DIR: z.string().optional(),
})

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  // Render (and most hosts) assign the port through PORT. LOOM_PORT still wins where it is
  // set, so nothing about local development changes.
  const env = source.LOOM_PORT === undefined && source.PORT !== undefined
    ? { ...source, LOOM_PORT: source.PORT }
    : source

  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`invalid configuration:\n${problems}`)
  }

  const e = parsed.data
  return {
    host: e.LOOM_HOST,
    port: e.LOOM_PORT,
    databaseUrl: e.DATABASE_URL,
    logLevel: e.LOOM_LOG_LEVEL,
    logFormat: e.LOOM_LOG_FORMAT,
    shutdownTimeoutMs: e.LOOM_SHUTDOWN_TIMEOUT_MS,
    google: { clientId: e.LOOM_GOOGLE_CLIENT_ID, clientSecret: e.LOOM_GOOGLE_CLIENT_SECRET },
    tokenKey: e.LOOM_TOKEN_KEY,
    sessionSecret: e.LOOM_SESSION_SECRET,
    webOrigin: e.LOOM_WEB_ORIGIN,
    cookieSecure: e.LOOM_COOKIE_SECURE,
    staticDir: e.LOOM_STATIC_DIR ?? null,
  }
}
