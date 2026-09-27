import { convertToJpeg } from '../heic/convert.ts'
import { isHeic } from '../heic/detect.ts'
import type { Strategy } from '../heic/strategy.ts'
import { chunkAt, contentRange } from './chunk.ts'
import { openQueueDb, type QueueDb, type QueueRecord } from './db.ts'
import { fileIdOf, matchesFileId } from './identity.ts'
import { InitiateError, type ChunkResult, type Transport } from './transport.ts'

export type UploadState =
  | 'QUEUED'
  | 'CONVERTING'
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
  /**
   * Measured here rather than in the row. It is a property of the transfer, and computing it
   * during render would mean reading a clock and a ref while rendering — both impure.
   */
  bytesPerSecond: number
  error?: string
  // TRD §9's deletion guardrail reads this and only this. It is set in exactly one place:
  // after Drive's own reported size matches the local one.
  verified: boolean
}

// What the header renders. Deliberately booleans and counts, never the item map: a component
// that subscribed to the map would re-render on every chunk of every file
// (vercel-react-best-practices: rerender-derived-state).
export type QueueSummary = {
  total: number
  active: number
  done: number
  failed: number
  needsFile: number
  // TRD §9: the deletion affordance is gated on this, never on 'DONE' alone.
  allVerified: boolean
}

export type Queue = {
  hydrate: () => Promise<void>
  add: (files: File[], strategy: Strategy) => Promise<void>
  pause: (id: string) => void
  resume: (id: string) => void
  cancel: (id: string) => void
  provideFile: (id: string, file: File) => Promise<boolean>
  subscribe: (id: string, fn: () => void) => () => void
  subscribeIds: (fn: () => void) => () => void
  subscribeSummary: (fn: () => void) => () => void
  snapshot: (id: string) => QueueItem | undefined
  summary: () => QueueSummary
  ids: () => string[]
}

type Entry = {
  item: QueueItem
  /** The file the user picked. Identity and re-selection are always about this one. */
  file: File | null
  /** What actually gets uploaded — the same object, unless conversion replaced it. */
  source: Blob | null
  strategy: Strategy
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
  const lastProgress = new Map<string, { at: number; bytes: number }>()

  // Cached because useSyncExternalStore compares snapshots by identity: returning a fresh
  // array or object from these on every call would re-render forever.
  let idsSnapshot: string[] = []
  let summarySnapshot: QueueSummary = {
    total: 0,
    active: 0,
    done: 0,
    failed: 0,
    needsFile: 0,
    allVerified: false,
  }
  const summaryListeners = new Set<() => void>()

  const emit = (id: string): void => {
    for (const fn of perId.get(id) ?? []) fn()
  }
  const emitIds = (): void => {
    idsSnapshot = [...entries.keys()]
    for (const fn of idsListeners) fn()
    recomputeSummary()
  }

  // Recomputed only when a state changes, never on a byte count — so progress, which is by far
  // the most frequent update, never touches the header.
  const ACTIVE: ReadonlySet<UploadState> = new Set<UploadState>([
    'QUEUED',
    'CONVERTING',
    'INITIATING',
    'UPLOADING',
    'VERIFYING',
  ])
  function recomputeSummary(): void {
    let active = 0
    let done = 0
    let failed = 0
    let needsFile = 0
    let verified = 0
    for (const entry of entries.values()) {
      const { state } = entry.item
      if (ACTIVE.has(state)) active++
      else if (state === 'DONE') done++
      else if (state === 'FAILED') failed++
      else if (state === 'NEEDS_FILE') needsFile++
      if (entry.item.verified) verified++
    }
    const total = entries.size
    summarySnapshot = {
      total,
      active,
      done,
      failed,
      needsFile,
      allVerified: total > 0 && verified === total,
    }
    for (const fn of summaryListeners) fn()
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
      emit(id)
      return
    }
    emit(id)
    if (patch.state !== undefined || patch.verified !== undefined) recomputeSummary()
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

  /**
   * TRD §6's opt-in cloud route, and the only path in Loom where media reaches our server.
   *
   * The browser opens the resumable session itself — it holds the Drive token, and the server
   * never gets one — then hands the session URI and the original HEIC to our endpoint. The
   * server converts as it streams and does the PUTs, so there is no chunk loop here at all.
   */
  async function runCloudTranscode(entry: Entry, file: File): Promise<void> {
    const { id } = entry.item

    if (!entry.record) {
      update(id, { state: 'INITIATING' })
      const token = deps.getToken()
      if (!token && !(await deps.refreshToken())) return fail(id, 'not signed in')
      try {
        const uri = await deps.transport.initiate(
          // No size: the JPEG does not exist yet, so its length is unknowable here.
          { name: file.name.replace(/\.hei[cf]$/i, '.jpg'), mimeType: 'image/jpeg' },
          deps.folderId,
          deps.getToken() ?? '',
        )
        entry.record = {
          id,
          name: file.name,
          size: file.size,
          lastModified: file.lastModified,
          sessionUri: uri,
          confirmedBytes: 0,
          createdAt: Date.now(),
          // Server-produced bytes, so this record can never be resumed against either.
          derived: true,
        }
        await persist(entry)
      } catch (err) {
        return fail(id, err instanceof InitiateError ? messageFor(err.code) : 'could not start the upload')
      }
    }

    // No byte-level progress on this route: the browser hands the whole file to one fetch and
    // cannot observe its own upload without dropping to XHR. The row sits at UPLOADING until
    // the server answers.
    update(id, { state: 'UPLOADING' })

    const body = new FormData()
    body.append('photo', file, file.name)

    let res: Response
    try {
      res = await fetch('/api/media/transcode-stream', {
        method: 'POST',
        // A header, not a form field, so our server can check it before parsing any body.
        headers: { 'X-Loom-Session-Uri': entry.record.sessionUri },
        body,
      })
    } catch {
      return fail(id, 'could not reach the converter')
    }

    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      return fail(id, payload?.error?.message ?? 'the conversion failed')
    }

    const payload = (await res.json()) as { driveFileId?: string; bytes?: number }
    if (!payload.driveFileId) return fail(id, 'the converter returned no file')

    // What Drive holds is the server's JPEG, not the HEIC that was picked, so verifying
    // against the original file's size would compare two unrelated numbers and always fail.
    // The server reports what it wrote; verify() then checks Drive agrees with that.
    if (typeof payload.bytes !== 'number') return fail(id, 'the converter reported no size')
    update(id, { size: payload.bytes })

    // VERIFYING is not skipped here. This is the route with the least direct evidence the
    // bytes arrived, and it gates TRD §9's deletion guardrail.
    entry.record.driveFileId = payload.driveFileId
    return verify(entry, payload.driveFileId)
  }

  async function runFile(entry: Entry): Promise<void> {
    const { id } = entry.item

    for (let restarts = 0; restarts <= RESTART_LIMIT; restarts++) {
      const file = entry.file
      if (!file) {
        update(id, { state: 'NEEDS_FILE' })
        return
      }

      // A strategy only means anything for a file that is actually HEIC. Everything else
      // uploads exactly as picked, whatever the batch chose.
      const route = entry.strategy === 'raw' ? 'raw' : (await isHeic(file)) ? entry.strategy : 'raw'

      if (route === 'cloud') return runCloudTranscode(entry, file)

      // --- convert -------------------------------------------------------------
      // Lazily, and here rather than before the queue: the identity hash and the re-selection
      // prompt are both about the file the user actually has on disk.
      if (!entry.source) {
        if (route === 'device') {
          update(id, { state: 'CONVERTING' })
          try {
            entry.source = await convertToJpeg(file)
          } catch {
            // One file's conversion failing must not take the batch with it.
            return fail(id, 'could not convert this photo')
          }
          // The progress bar measures what is being sent, which is no longer the file's size.
          update(id, { size: entry.source.size })
        } else {
          entry.source = file
        }
      }

      const source = entry.source
      const uploadSize = source.size
      const derived = source !== file

      // --- initiate ------------------------------------------------------------
      if (!entry.record) {
        update(id, { state: 'INITIATING' })
        const token = deps.getToken()
        if (!token && !(await deps.refreshToken())) return fail(id, 'not signed in')
        try {
          const uri = await deps.transport.initiate(
            {
              name: derived ? file.name.replace(/\.hei[cf]$/i, '.jpg') : file.name,
              mimeType: derived ? 'image/jpeg' : file.type,
              size: uploadSize,
            },
            deps.folderId,
            deps.getToken() ?? '',
          )
          entry.record = {
            id,
            name: file.name,
            size: uploadSize,
            lastModified: file.lastModified,
            sessionUri: uri,
            confirmedBytes: 0,
            createdAt: Date.now(),
            derived,
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
      while (record.confirmedBytes < uploadSize) {
        if (entry.cancelled) return
        if (entry.paused) {
          update(id, { state: 'PAUSED' })
          return
        }

        const { start, end } = chunkAt(record.confirmedBytes, uploadSize)
        let result: ChunkResult
        try {
          result = await deps.transport.putChunk(
            record.sessionUri,
            // Blob.slice only. Never read a whole file — a multi-gigabyte video would crash
            // the tab (docs/plan.md §8).
            source.slice(start, end + 1),
            contentRange(start, end, uploadSize),
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

          const now = Date.now()
          const prev = lastProgress.get(id)
          const moved = prev && record.confirmedBytes > prev.bytes && now > prev.at
          const bytesPerSecond = moved
            ? ((record.confirmedBytes - prev.bytes) / (now - prev.at)) * 1000
            : entry.item.bytesPerSecond
          lastProgress.set(id, { at: now, bytes: record.confirmedBytes })

          update(id, { uploadedBytes: record.confirmedBytes, bytesPerSecond }, true)
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
            const probe = await deps.transport.queryOffset(record.sessionUri, uploadSize).catch(
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

      if (record.confirmedBytes >= uploadSize && record.driveFileId) {
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
        // Derived bytes cannot be reproduced byte-for-byte, so this record cannot be resumed
        // against — see QueueRecord.derived. Dropping it restarts the file cleanly instead of
        // offering a resume that would corrupt it.
        if (record.derived) {
          await store.remove(record.id)
          continue
        }
        entries.set(record.id, {
          // The offset survived the reload; the File handle did not, and no storage can change
          // that (§2.5). The user re-selects the file and the stored offset makes it cheap.
          item: {
            id: record.id,
            name: record.name,
            size: record.size,
            state: 'NEEDS_FILE',
            uploadedBytes: record.confirmedBytes,
            bytesPerSecond: 0,
            verified: false,
          },
          file: null,
          source: null,
          // A persisted record is never derived (those were dropped above), so its bytes come
          // straight off disk and 'raw' is the honest strategy for the resumed upload.
          strategy: 'raw',
          record,
          paused: false,
          cancelled: false,
        })
      }
      emitIds()
    },

    add: async (files, strategy) => {
      for (const file of files) {
        const id = await fileIdOf(file)
        const existing = entries.get(id)
        if (existing) {
          // Re-picking a file already queued supplies the handle rather than duplicating it.
          existing.file = file
          existing.source ??= null
          if (existing.item.state === 'NEEDS_FILE') update(id, { state: 'QUEUED' })
          continue
        }
        entries.set(id, {
          item: {
            id,
            name: file.name,
            size: file.size,
            state: 'QUEUED',
            uploadedBytes: 0,
            bytesPerSecond: 0,
            verified: false,
          },
          file,
          source: null,
          strategy,
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

    subscribeSummary: (fn) => {
      summaryListeners.add(fn)
      return () => summaryListeners.delete(fn)
    },

    snapshot: (id) => entries.get(id)?.item,
    summary: () => summarySnapshot,
    ids: () => idsSnapshot,
  }
}
