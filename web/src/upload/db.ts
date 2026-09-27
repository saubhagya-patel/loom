import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

// IndexedDB rather than localStorage (docs/plan.md §2.5). localStorage is synchronous,
// string-only and ~5 MB; this holds a record per in-flight file and wants keyed access with
// transactions. It would work today and be wrong by Phase 4.
//
// What is stored is the durable half of an upload. The File handle is the half that is NOT
// durable — see NEEDS_FILE in queue.ts.
export type QueueRecord = {
  id: string
  name: string
  size: number
  lastModified: number
  // A pre-authorized write capability into the user's Drive, not an identifier (§2.5,
  // confirmed by the Phase 0 Task 9 spike: a chunk PUT needs no Authorization header). It is
  // held here because it must survive a reload, and it goes nowhere else.
  sessionUri: string
  // Always a value Drive told us, never our own arithmetic (§2.6).
  confirmedBytes: number
  createdAt: number
  driveFileId?: string
}

// Drive expires a resumable session after one week. Records are pruned on load so a resume
// against a dead URI is prevented rather than handled (§2.5).
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const DB_NAME = 'loom-uploads'
const STORE = 'queue'

interface QueueSchema extends DBSchema {
  [STORE]: { key: string; value: QueueRecord }
}

export type QueueDb = {
  all: () => Promise<QueueRecord[]>
  get: (id: string) => Promise<QueueRecord | undefined>
  put: (record: QueueRecord) => Promise<void>
  remove: (id: string) => Promise<void>
  pruneExpired: (now?: number) => Promise<string[]>
}

export async function openQueueDb(): Promise<QueueDb> {
  const db: IDBPDatabase<QueueSchema> = await openDB<QueueSchema>(DB_NAME, 1, {
    upgrade(database) {
      database.createObjectStore(STORE, { keyPath: 'id' })
    },
  })

  return {
    all: () => db.getAll(STORE),
    get: (id) => db.get(STORE, id),
    put: async (record) => {
      await db.put(STORE, record)
    },
    remove: (id) => db.delete(STORE, id),
    pruneExpired: async (now = Date.now()) => {
      const stale = (await db.getAll(STORE)).filter((r) => now - r.createdAt >= MAX_AGE_MS)
      await Promise.all(stale.map((r) => db.delete(STORE, r.id)))
      return stale.map((r) => r.id)
    },
  }
}
