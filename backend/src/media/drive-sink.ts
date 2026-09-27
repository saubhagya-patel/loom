import { AppError } from '../api/errors.ts'

// Must stay a multiple of 256 KiB: Drive rejects any chunk but the last that is not, and the
// failure does not name the cause (agent-cache/knowledge.md).
const FLUSH_BYTES = 8 * 1024 * 1024

export type DriveSink = {
  write: (chunk: Buffer) => Promise<void>
  /** The Drive file id, and the byte count actually written — the client cannot know it. */
  end: () => Promise<{ driveFileId: string; bytes: number }>
}

/**
 * Writes a stream of *unknown* length into a resumable session.
 *
 * sharp does not know how large its JPEG will be until it has finished making it, and Drive
 * wants either a Content-Length or a Content-Range carrying a total. Drive's own answer is that
 * a chunk may declare its total as `*`:
 *
 *     bytes 0-8388607/*          -> 308, "keep going"
 *     bytes 8388608-9437183/9437184 -> 200, total known at the final flush
 *
 * So memory stays flat at one chunk no matter how large the input, and every PUT still has a
 * known Content-Length — nothing depends on Google accepting an unknown-length body
 * (docs/plan.md §2.7).
 */
export function createDriveSink(sessionUri: string): DriveSink {
  let held: Buffer[] = []
  let heldBytes = 0
  let offset = 0

  // Nothing here — no error, no message, no rethrow — carries the session URI. It is a bearer
  // write capability into the user's Drive (§2.5, proven by the Phase 0 Task 9 spike).
  async function put(body: Buffer, range: string): Promise<string | null> {
    const res = await fetch(sessionUri, {
      method: 'PUT',
      headers: { 'Content-Range': range, 'Content-Length': String(body.length) },
      body: new Uint8Array(body),
    })

    if (res.status === 308) return null
    if (!res.ok) throw new AppError(502, 'drive_put_failed', `drive rejected the upload (${res.status})`)

    const json: unknown = await res.json().catch(() => null)
    const id = (json as { id?: unknown } | null)?.id
    if (typeof id !== 'string') throw new AppError(502, 'drive_bad_response', 'drive returned no file id')
    return id
  }

  return {
    write: async (chunk) => {
      held.push(chunk)
      heldBytes += chunk.length

      // Strictly greater, not >=. Holding at least one byte back guarantees the final flush is
      // non-empty, so there is always a last chunk on which to declare the real total.
      while (heldBytes > FLUSH_BYTES) {
        const all = Buffer.concat(held)
        const send = all.subarray(0, FLUSH_BYTES)
        const rest = all.subarray(FLUSH_BYTES)
        held = rest.length > 0 ? [rest] : []
        heldBytes = rest.length

        await put(send, `bytes ${offset}-${offset + FLUSH_BYTES - 1}/*`)
        offset += FLUSH_BYTES
      }
    },

    end: async () => {
      const last = Buffer.concat(held)
      const total = offset + last.length
      if (total === 0) throw new AppError(422, 'empty_output', 'the conversion produced nothing')

      const id = await put(last, `bytes ${offset}-${total - 1}/${total}`)
      if (!id) throw new AppError(502, 'drive_incomplete', 'drive did not finish the upload')
      return { driveFileId: id, bytes: total }
    },
  }
}
