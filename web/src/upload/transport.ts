import { contentRange, parseRange } from './chunk.ts'

const RESUMABLE_URL =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id'
const FILES_URL = 'https://www.googleapis.com/drive/v3/files'

// The only module that holds a resumable session URI. Keeping that surface to one file is what
// makes docs/plan.md §2.5's "never log it, never put it in a URL" checkable by reading rather
// than by trusting — so nothing here logs, and no error below carries a `uri`.
export type ChunkResult =
  | { kind: 'incomplete'; confirmedBytes: number; rangeMd5: string | null }
  | { kind: 'complete'; driveFileId: string }
  | { kind: 'expired' } //       404 — session gone; the file restarts
  | { kind: 'unauthorized' } //  401 — refresh the token, retry the same chunk
  | { kind: 'retryable'; status: number }
  | { kind: 'fatal'; status: number; code: string }

export type Transport = {
  initiate: (file: File, folderId: string, token: string) => Promise<string>
  putChunk: (uri: string, blob: Blob, range: string) => Promise<ChunkResult>
  queryOffset: (uri: string, total: number) => Promise<ChunkResult>
  sizeOf: (driveFileId: string, token: string) => Promise<number | null>
}

// Thrown only by initiate, which is the one call that cannot express failure as a ChunkResult.
// Carries a code, never a URL or a response body.
export class InitiateError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string) {
    super(`drive refused to start the upload (${code})`)
    this.name = 'InitiateError'
    this.status = status
    this.code = code
  }
}

// Drive's error body is { error: { errors: [{ reason }], code, message } }. Only the machine
// reason is kept: `message` is free text from an upstream we do not control and is one of the
// ways a filename ends up somewhere it should not be (§2.8).
async function reasonOf(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json()
    const error = (body as { error?: { errors?: { reason?: unknown }[] } }).error
    const reason = error?.errors?.[0]?.reason
    return typeof reason === 'string' ? reason : `http_${res.status}`
  } catch {
    return `http_${res.status}`
  }
}

// 408 and 429 are explicit; 5xx is a class. Everything else is a decision, not a retry.
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

async function classify(res: Response): Promise<ChunkResult> {
  // 308 Resume Incomplete. The Range header is the authority on what actually landed — never
  // our own arithmetic (§2.6). Drive omits it when it holds zero bytes, which means zero.
  if (res.status === 308) {
    return {
      kind: 'incomplete',
      confirmedBytes: parseRange(res.headers.get('Range')) ?? 0,
      rangeMd5: res.headers.get('x-range-md5'),
    }
  }

  if (res.ok) {
    const body: unknown = await res.json().catch(() => null)
    const id = (body as { id?: unknown } | null)?.id
    return typeof id === 'string'
      ? { kind: 'complete', driveFileId: id }
      : { kind: 'fatal', status: res.status, code: 'no_file_id' }
  }

  if (res.status === 401) return { kind: 'unauthorized' }
  // A 404 on a PUT means the session is gone or expired. Retrying the chunk can never work;
  // the file has to start over (§5.2).
  if (res.status === 404) return { kind: 'expired' }
  if (isRetryableStatus(res.status)) return { kind: 'retryable', status: res.status }
  return { kind: 'fatal', status: res.status, code: await reasonOf(res) }
}

export function createTransport(): Transport {
  return {
    initiate: async (file, folderId, token) => {
      const res = await fetch(RESUMABLE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': file.type || 'application/octet-stream',
          'X-Upload-Content-Length': String(file.size),
        },
        body: JSON.stringify({ name: file.name, parents: [folderId] }),
      })
      if (!res.ok) throw new InitiateError(res.status, await reasonOf(res))

      // Readable cross-origin — verified against real Drive by the Phase 0 Task 9 spike, which
      // is the single assumption this whole architecture rests on.
      const uri = res.headers.get('Location')
      if (!uri) throw new InitiateError(res.status, 'no_location_header')
      return uri
    },

    // No Authorization header, deliberately: the session URI is itself the authorization. The
    // Task 9 spike confirmed a chunk PUT without one is accepted — which is also why §2.5
    // treats the URI as a credential.
    putChunk: async (uri, blob, range) => {
      const res = await fetch(uri, { method: 'PUT', headers: { 'Content-Range': range }, body: blob })
      return classify(res)
    },

    // A zero-length PUT asking Drive where it got to. This is the recovery path after any
    // network failure — we ask rather than assume (§2.6).
    queryOffset: async (uri, total) => {
      const res = await fetch(uri, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes */${total}` },
      })
      return classify(res)
    },

    sizeOf: async (driveFileId, token) => {
      const res = await fetch(`${FILES_URL}/${driveFileId}?fields=size`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return null
      const body: unknown = await res.json().catch(() => null)
      const size = (body as { size?: unknown } | null)?.size
      return typeof size === 'string' ? Number(size) : null
    },
  }
}

export { contentRange }
