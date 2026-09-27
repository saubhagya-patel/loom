/// <reference lib="webworker" />

export type ConvertRequest = { id: string; blob: Blob }
export type ConvertResponse =
  | { id: string; ok: true; blob: Blob }
  | { id: string; ok: false; error: string }

// Imported inside the handler, not at module scope: heic2any carries a large WASM payload, and
// a static import would pull it into the worker's initial load even for a batch with no HEIC
// in it.
self.onmessage = (event: MessageEvent<ConvertRequest>) => {
  const { id, blob } = event.data
  void (async () => {
    try {
      const { default: heic2any } = await import('heic2any')
      const out = await heic2any({ blob, toType: 'image/jpeg', quality: 0.92 })
      // heic2any returns an array for multi-image HEICs (bursts, sequences). V1 takes the
      // first image; grouping is a V2 concern (docs/plan.md §2.9).
      const jpeg = Array.isArray(out) ? out[0] : out
      if (!jpeg) throw new Error('conversion produced nothing')
      const response: ConvertResponse = { id, ok: true, blob: jpeg }
      self.postMessage(response)
    } catch (err) {
      const response: ConvertResponse = {
        id,
        ok: false,
        error: err instanceof Error ? err.message : 'conversion failed',
      }
      self.postMessage(response)
    }
  })()
}
