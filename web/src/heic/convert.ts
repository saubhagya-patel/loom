import type { ConvertRequest, ConvertResponse, ConvertType } from './convert.worker.ts'

export type { ConvertType }

/**
 * 0.91, measured rather than picked.
 *
 * On a real 287 KB HEIC, decoded and re-encoded: 0.88 → 534 KB, 0.91 → 605 KB, 0.95 → 771 KB,
 * 1.0 → 1314 KB. JPEG at 1.0 is **not** lossless — it is minimal quantisation, still lossy —
 * and the source is already lossy HEIC, so it cannot recover detail discarded before we saw
 * it. It preserves HEIC's own artifacts at 2.5x the bytes, which is the wrong trade in a
 * product for moving a full phone into a finite Drive.
 *
 * Genuinely lossless is available twice, and neither is JPEG: "Upload as HEIC" keeps the
 * original bytes, and PNG here is mathematically lossless. 0.91 sits where the curve flattens.
 */
export const DEFAULT_QUALITY = 0.91

export type ConvertOptions = { type?: ConvertType; quality?: number }

// One worker, shared across the app and the tools.
let worker: Worker | null = null
const pending = new Map<string, { resolve: (b: Blob) => void; reject: (e: Error) => void }>()

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./convert.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<ConvertResponse>) => {
    const data = event.data
    const entry = pending.get(data.id)
    if (!entry) return
    pending.delete(data.id)
    if (data.ok) entry.resolve(data.blob)
    else entry.reject(new Error(data.error))
  }
  worker.onerror = () => {
    // Fail everything waiting rather than leaving promises hanging, and drop the worker so
    // the next conversion gets a fresh one.
    for (const [, entry] of pending) entry.reject(new Error('the converter stopped unexpectedly'))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

export function convertImage(file: Blob, options: ConvertOptions = {}): Promise<Blob> {
  const id = crypto.randomUUID()
  const request: ConvertRequest = {
    id,
    blob: file,
    type: options.type ?? 'image/jpeg',
    quality: options.quality ?? DEFAULT_QUALITY,
  }
  return new Promise<Blob>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ensureWorker().postMessage(request)
  })
}

/** Kept so the upload queue's call site reads the way it did. */
export function convertToJpeg(file: File): Promise<Blob> {
  return convertImage(file)
}
