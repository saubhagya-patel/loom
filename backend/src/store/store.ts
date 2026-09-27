import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '../../generated/prisma/client.ts'
import type { Config } from '../config/config.ts'

// The health handler depends on this rather than on the whole client, so it can
// be tested without a database. Phase 1's Google calls get the same treatment.
export type Pinger = { ping: () => Promise<void> }

export type Store = Pinger & {
  prisma: PrismaClient
  verifySchema: () => Promise<void>
  close: () => Promise<void>
}

// Nothing tracks which SQL scripts have been applied to a given database — that is the
// accepted cost of owning the schema by hand (docs/plan.md §2.1). This check buys back the
// part that actually hurts: a missing table becomes an instruction at startup instead of
// `Table 'loom.users' doesn't exist` from whichever query happened to run first.
const REQUIRED_TABLES = ['users'] as const

export function createStore(cfg: Config): Store {
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(cfg.databaseUrl) })
  return {
    prisma,
    ping: async () => {
      await prisma.$queryRaw`SELECT 1`
    },
    verifySchema: async () => {
      // Aliased to a lowercase name because the column's own case varies by driver.
      const rows = await prisma.$queryRaw<{ name: string }[]>`
        SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
      `
      const present = new Set(rows.map((r) => r.name))
      const missing = REQUIRED_TABLES.filter((t) => !present.has(t))
      if (missing.length > 0) {
        // No connection string in the message: a startup failure is the thing most likely
        // to be pasted somewhere public, and the URL carries a password (config.ts).
        throw new Error(
          `database is missing table(s): ${missing.join(', ')}. ` +
            'Apply backend/db/schema.sql — its header carries the command.',
        )
      }
    },
    close: () => prisma.$disconnect(),
  }
}
