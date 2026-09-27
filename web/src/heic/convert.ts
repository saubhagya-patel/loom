import type { ConvertRequest, ConvertResponse } from './convert.worker.ts'

// One worker, shared. Conversion runs off the main thread because heic2any blocks whatever
// thread it is on: run it inline and the Phase 2 queue UI freezes mid-batch, so a working
// engine looks broken (docs/plan.md, Phase 3).
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
    // The worker died. Fail everything waiting on it rather than leaving promises hanging,
    // and drop it so the next conversion gets a fresh one.
    for (const [, entry] of pending) entry.reject(new Error('the converter stopped unexpectedly'))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

export function convertToJpeg(file: File): Promise<Blob> {
  const id = crypto.randomUUID()
  const request: ConvertRequest = { id, blob: file }
  return new Promise<Blob>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ensureWorker().postMessage(request)
  })
}
