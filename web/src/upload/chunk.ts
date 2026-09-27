const KIB = 1024
const MIB = 1024 * KIB

// Drive rejects any chunk but the last that is not a multiple of 256 KiB, and the failure does
// not name the cause (agent-cache/knowledge.md). 8 MiB sits inside TRD §7's 5-10 MB band and is
// a clean 32 x 256 KiB.
const ALIGNMENT = 256 * KIB
export const CHUNK_BYTES = 8 * MIB

// At load, not at first use: a misaligned constant is a deployment mistake, and it should stop
// the app rather than surface as an unexplained 400 partway through someone's upload.
if (CHUNK_BYTES % ALIGNMENT !== 0) {
  throw new Error(`CHUNK_BYTES must be a multiple of ${ALIGNMENT} bytes, got ${CHUNK_BYTES}`)
}

// `end` is inclusive, matching both HTTP range forms. A zero-byte file has no chunk at all and
// is the caller's problem — Drive's resumable protocol has nothing to send for it.
export function chunkAt(offset: number, total: number): { start: number; end: number } {
  return { start: offset, end: Math.min(offset + CHUNK_BYTES, total) - 1 }
}

// The REQUEST form: a space, and a total. `bytes 0-262143/327680`.
export function contentRange(start: number, end: number, total: number): string {
  return `bytes ${start}-${end}/${total}`
}

// The RESPONSE form, which is NOT the request form: `bytes=0-262143` — an equals sign, an
// inclusive end, and no total. Confusing the two is the likeliest off-by-one in this phase,
// which is why the conversion to "next offset" happens here and nowhere else: callers get a
// number to resume from, never an end index to add one to themselves.
//
// Verified against real Drive responses by the Phase 0 Task 9 spike.
export function parseRange(header: string | null): number | null {
  if (!header) return null
  const match = /^bytes=(\d+)-(\d+)$/.exec(header.trim())
  const end = match?.[2]
  return end === undefined ? null : Number(end) + 1
}
