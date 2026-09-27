import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '../../generated/prisma/client.ts'
import type { Config } from '../config/config.ts'

// The health handler depends on this rather than on the whole client, so it can
// be tested without a database. Phase 1's Google calls get the same treatment.
export type Pinger = { ping: () => Promise<void> }

export type Store = Pinger & {
  prisma: PrismaClient
  close: () => Promise<void>
}

export function createStore(cfg: Config): Store {
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(cfg.databaseUrl) })
  return {
    prisma,
    ping: async () => {
      await prisma.$queryRaw`SELECT 1`
    },
    close: () => prisma.$disconnect(),
  }
}
