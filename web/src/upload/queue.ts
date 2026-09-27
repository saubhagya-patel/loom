import { chunkAt, contentRange } from './chunk.ts'
import { openQueueDb, type QueueDb, type QueueRecord } from './db.ts'
import { fileIdOf, matchesFileId } from './identity.ts'
import { InitiateError, type ChunkResult, type Transport } from './transport.ts'

export type UploadState =
  | 'QUEUED'
  | 'INITIATING'
  | 'UPLOADING'
  | 'PAUSED'
  | 'VERIFYING'
  | 'DONE'
  | 'FAILED'
  | 'NEEDS_FILE'

export type QueueItem = {
  id: string
  name: string
  size: number
  state: UploadState
  uploadedBytes: number
  error?: string
  // TRD §9's deletion guardrail reads this and only this. It is set in exactly one place:
  // after Drive's own reported size matches the local one.
  verified: boolean
}

export type Queue = {
  hydrate: () => Promise<void>
  add: (files: File[]) => Promise<void>
  pause: (id: string) => void
  resume: (id: string) => void
  cancel: (id: string) => void
  provideFile: (id: string, file: File) => Promise<boolean>
  subscribe: (id: string, fn: () => void) => () => void
  subscribeIds: (fn: () => void) => () => void
  snapshot: (id: string) => QueueItem | undefined
  ids: () => string[]
}

type Entry = {
  item: QueueItem
  file: File | null
  record: QueueRecord | null
  paused: boolean
  cancelled: boolean
}

const MAX_ATTEMPTS = 5
const PROGRESS_THROTTLE_MS = 250
const RESTART_LIMIT = 2

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// 2^n seconds with jitter (§5.2). Jitter matters because a dropped connection tends to fail
// every queued file at once, and a fixed ladder would then retry them in lockstep.
function backoffMs(attempt: number): number {
  return 2 ** attempt * 1000 * (0.5 + Math.random() / 2)
}

function messageFor(code: string): string {
  // A full Drive is not our bug and must not read like one (§5.2).
  if (code === 'storageQuotaExceeded') return 'your google drive is full'
  if (code === 'forbidden' || code === 'insufficientFilePermissions') return 'drive refused access'
  return `upload failed (${code})`
}

export function createQueue(deps: {
  transport: Transport
  getToken: () => string | null
  refreshToken: () => Promise<boolean>
  folderId: string
}): Queue {
  const entries = new Map<string, Entry>()
  const perId = new Map<string, Set<() => void>>()
  const idsListeners = new Set<() => void>()
  let db: QueueDb | null = null
  let pumping = false
  const lastEmit = new Map<string, number>()

  // Cached because useSyncExternalStore compares snapshots by identity: returning a fresh
  // array from ids() on every call would re-render the list forever.
  let idsSnapshot: string[] = []

  const emit = (id: string): void => {
    for (const fn of perId.get(id) ?? []) fn()
  }
  const emitIds = (): void => {
    idsSnapshot = [...entries.keys()]
    for (const fn of idsListeners) fn()
  }

  // useSyncExternalStore compares snapshots by identity, so every change replaces `item` with
  // a new object and an unchanged item keeps its reference.
  const update = (id: string, patch: Partial<QueueItem>, throttle = false): void => {
    const entry = entries.get(id)
    if (!entry) return
    entry.item = { ...entry.item, ...patch }

    // Byte counts are transient and arrive far faster than a screen can use
    // (vercel-react-best-practices: rerender-use-ref-transient-values). State changes always
    // emit; progress is rate-limited so a queue of small files cannot flood React.
    if (throttle) {
      const now = Date.now()
      if (now - (lastEmit.get(id) ?? 0) < PROGRESS_THROTTLE_MS) return
      lastEmit.set(id, now)
    }
    emit(id)
  }

  const persist = async (entry: Entry): Promise<void> => {
    if (db && entry.record) await db.put(entry.record)
  }

  const fail = (id: string, error: string): void => update(id, { state: 'FAILED', error })

  async function verify(entry: Entry, driveFileId: string): Promise<void> {
    const { id } = entry.item
    update(id, { state: 'VERIFYING', uploadedBytes: entry.item.size })

    const token = deps.getToken()
    const remoteSize = token ? await deps.transport.sizeOf(driveFileId, token) : null

    if (remoteSize === entry.item.size) {
      update(id, { state: 'DONE', verified: true })
      if (db) await db.remove(id)
      entry.record = null
    } else {
      // Deliberately not DONE. TRD §9 forbids suggesting the user delete their local copy
      // until this passes, so a size we could not confirm has to stay unverified.
      fail(id, remoteSize === null ? 'could not confirm the upload' : 'uploaded size did not match')
    }
  }

  async function runFile(entry: Entry): Promise<void> {
    const { id, size } = entry.item

    for (let restarts = 0; restarts <= RESTART_LIMIT; restarts++) {
      const file = entry.file
      if (!file) {
        update(id, { state: 'NEEDS_FILE' })
        return
      }

      // --- initiate ------------------------------------------------------------
      if (!entry.record) {
        update(id, { state: 'INITIATING' })
        const token = deps.getToken()
        if (!token && !(await deps.refreshToken())) return fail(id, 'not signed in')
        try {
          const uri = await deps.transport.initiate(file, deps.folderId, deps.getToken() ?? '')
          entry.record = {
            id,
            name: file.name,
            size,
            lastModified: file.lastModified,
            sessionUri: uri,
            confirmedBytes: 0,
            createdAt: Date.now(),
          }
          await persist(entry)
        } catch (err) {
          return fail(
            id,
            err instanceof InitiateError ? messageFor(err.code) : 'could not start the upload',
          )
        }
      }

      const record = entry.record
      let attempts = 0
      update(id, { state: 'UPLOADING', uploadedBytes: record.confirmedBytes })

      // --- chunk loop ----------------------------------------------------------
      while (record.confirmedBytes < size) {
        if (entry.cancelled) return
        if (entry.paused) {
          update(id, { state: 'PAUSED' })
          return
        }

        const { start, end } = chunkAt(record.confirmedBytes, size)
        let result: ChunkResult
        try {
          result = await deps.transport.putChunk(
            record.sessionUri,
            // Blob.slice only. Never read a whole file — a multi-gigabyte video would crash
            // the tab (docs/plan.md §8).
            file.slice(start, end + 1),
            contentRange(start, end, size),
          )
        } catch {
          result = { kind: 'retryable', status: 0 } // network error, offline, aborted
        }

        if (result.kind === 'incomplete') {
          // THE rule of this phase: the confirmed offset is the number Drive reported, never
          // start + blob.size (docs/plan.md §2.6). With no test suite this is the only thing
          // standing between a resumed upload and a silently corrupt file.
          record.confirmedBytes = result.confirmedBytes
          attempts = 0
          await persist(entry)
          update(id, { uploadedBytes: record.confirmedBytes }, true)
          continue
        }

        if (result.kind === 'complete') {
          record.driveFileId = result.driveFileId
          return verify(entry, result.driveFileId)
        }

        if (result.kind === 'unauthorized') {
          // The token aged out mid-upload. Refresh and retry the same chunk — a long upload
          // must not die because an hour passed (§2.4).
          if (!(await deps.refreshToken())) return fail(id, 'your session expired')
          continue
        }

        if (result.kind === 'expired') break // 404: session gone, restart the file

        if (result.kind === 'retryable') {
          attempts++
          if (attempts > MAX_ATTEMPTS) {
            // The ladder is spent. Ask Drive where it actually got to rather than guessing,
            // then carry on from there (§5.2).
            const probe = await deps.transport.queryOffset(record.sessionUri, size).catch(
              (): ChunkResult => ({ kind: 'retryable', status: 0 }),
            )
            if (probe.kind === 'incomplete') {
              record.confirmedBytes = probe.confirmedBytes
              attempts = 0
              await persist(entry)
              continue
            }
            if (probe.kind === 'complete') return verify(entry, probe.driveFileId)
            if (probe.kind === 'expired') break
            return fail(id, 'lost connection to google drive')
          }
          await sleep(backoffMs(attempts))
          continue
        }

        return fail(id, messageFor(result.code))
      }

      if (record.confirmedBytes >= size && record.driveFileId) {
        return verify(entry, record.driveFileId)
      }

      // Only an 'expired' break reaches here: drop the dead session and start the file over.
      if (db) await db.remove(id)
      entry.record = null
      update(id, { uploadedBytes: 0 })
    }

    fail(id, 'the upload session kept expiring')
  }

  // One file at a time. A phone on a weak network gains nothing from competing sockets, and a
  // single in-flight PUT means one place an offset can be wrong.
  async function pump(): Promise<void> {
    if (pumping) return
    pumping = true
    try {
      for (;;) {
        const next = [...entries.values()].find(
          (e) => !e.cancelled && !e.paused && e.file && (e.item.state === 'QUEUED' || e.item.state === 'PAUSED'),
        )
        if (!next) break
        await runFile(next)
      }
    } finally {
      pumping = false
    }
  }

  const ensureDb = async (): Promise<QueueDb> => (db ??= await openQueueDb())

  return {
    hydrate: async () => {
      const store = await ensureDb()
      // Session URIs die after a week, so a resume against a dead one is prevented rather
      // than handled (§2.5).
      await store.pruneExpired()
      for (const record of await store.all()) {
        if (entries.has(record.id)) continue
        entries.set(record.id, {
          // The offset survived the reload; the File handle did not, and no storage can change
          // that (§2.5). The user re-selects the file and the stored offset makes it cheap.
          item: {
            id: record.id,
            name: record.name,
            size: record.size,
            state: 'NEEDS_FILE',
            uploadedBytes: record.confirmedBytes,
            verified: false,
          },
          file: null,
          record,
          paused: false,
          cancelled: false,
        })
      }
      emitIds()
    },

    add: async (files) => {
      for (const file of files) {
        const id = await fileIdOf(file)
        const existing = entries.get(id)
        if (existing) {
          // Re-picking a file already queued supplies the handle rather than duplicating it.
          existing.file = file
          if (existing.item.state === 'NEEDS_FILE') update(id, { state: 'QUEUED' })
          continue
        }
        entries.set(id, {
          item: { id, name: file.name, size: file.size, state: 'QUEUED', uploadedBytes: 0, verified: false },
          file,
          record: (await (await ensureDb()).get(id)) ?? null,
          paused: false,
          cancelled: false,
        })
      }
      emitIds()
      void pump()
    },

    pause: (id) => {
      const entry = entries.get(id)
      if (entry) entry.paused = true
    },

    resume: (id) => {
      const entry = entries.get(id)
      if (!entry) return
      entry.paused = false
      if (entry.item.state === 'PAUSED' || entry.item.state === 'FAILED') update(id, { state: 'QUEUED' })
      void pump()
    },

    cancel: (id) => {
      const entry = entries.get(id)
      if (!entry) return
      entry.cancelled = true
      entries.delete(id)
      void db?.remove(id)
      emitIds()
    },

    // Re-selecting the WRONG file must never append its bytes to someone else's upload, so the
    // handle is matched against the stored identity hash before it is accepted.
    provideFile: async (id, file) => {
      const entry = entries.get(id)
      if (!entry || !(await matchesFileId(file, id))) return false
      entry.file = file
      update(id, { state: 'QUEUED' })
      void pump()
      return true
    },

    subscribe: (id, fn) => {
      const set = perId.get(id) ?? new Set()
      perId.set(id, set)
      set.add(fn)
      return () => set.delete(fn)
    },

    subscribeIds: (fn) => {
      idsListeners.add(fn)
      return () => idsListeners.delete(fn)
    },

    snapshot: (id) => entries.get(id)?.item,
    ids: () => idsSnapshot,
  }
}
