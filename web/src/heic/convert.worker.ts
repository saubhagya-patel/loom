/// <reference lib="webworker" />

export type ConvertType = 'image/jpeg' | 'image/png'

export type ConvertRequest = { id: string; blob: Blob; type: ConvertType; quality: number }
export type ConvertResponse =
  | { id: string; ok: true; blob: Blob }
  | { id: string; ok: false; error: string }

/**
 * Decode without a DOM.
 *
 * TRD §6 names `heic2any`. It cannot do this: it calls `document.createElement('canvas')`, and
 * a Worker has no `document`. Running it on the main thread instead works and freezes the UI
 * for the length of a batch — the exact failure this worker exists to prevent.
 *
 * Native first. Safari decodes HEIC itself, so on an iPhone this costs no WASM download at
 * all. Chrome and Firefox on desktop refuse and fall through to libheif — which, for the
 * standalone tools, is the *hot* path rather than the cold one, since they exist for exactly
 * the platforms whose browsers say no.
 */
async function decode(blob: Blob): Promise<ImageBitmap | ImageData> {
  try {
    return await createImageBitmap(blob)
  } catch {
    const { default: decodeHeic } = await import('heic-decode')
    const { width, height, data } = await decodeHeic({ buffer: new Uint8Array(await blob.arrayBuffer()) })
    return new ImageData(new Uint8ClampedArray(data), width, height)
  }
}

async function convert(blob: Blob, type: ConvertType, quality: number): Promise<Blob> {
  const image = await decode(blob)
  const canvas = new OffscreenCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context in this browser')

  if (image instanceof ImageData) ctx.putImageData(image, 0, 0)
  else {
    ctx.drawImage(image, 0, 0)
    image.close() // release the decoded frame immediately; these are large
  }

  // PNG ignores quality and is lossless; JPEG uses it.
  return canvas.convertToBlob({ type, quality })
}

self.onmessage = (event: MessageEvent<ConvertRequest>) => {
  const { id, blob, type, quality } = event.data
  void (async () => {
    try {
      self.postMessage({ id, ok: true, blob: await convert(blob, type, quality) } satisfies ConvertResponse)
    } catch (err) {
      self.postMessage({
        id,
        ok: false,
        error: err instanceof Error ? err.message : 'conversion failed',
      } satisfies ConvertResponse)
    }
  })()
}
