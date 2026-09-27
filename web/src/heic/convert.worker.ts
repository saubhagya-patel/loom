/// <reference lib="webworker" />

export type ConvertRequest = { id: string; blob: Blob }
export type ConvertResponse =
  | { id: string; ok: true; blob: Blob }
  | { id: string; ok: false; error: string }

const QUALITY = 0.88

/**
 * Decode a HEIC without a DOM.
 *
 * TRD §6 names `heic2any` for this. It cannot do the job: it calls
 * `document.createElement('canvas')`, and a Worker has no `document`. Running it on the main
 * thread instead would work and would freeze the queue UI for the length of a batch, which is
 * the exact failure the worker exists to prevent. So it is dropped — a recorded deviation.
 *
 * Native first. Safari decodes HEIC itself, and Safari is the browser that matters here
 * because these are iPhone photos — so on the target platform this costs no WASM download at
 * all. Chrome and Firefox refuse, and fall through to libheif.
 */
async function decode(blob: Blob): Promise<ImageBitmap | ImageData> {
  try {
    return await createImageBitmap(blob)
  } catch {
    // Loaded only when the native path failed, so an iPhone never fetches it.
    const { default: decodeHeic } = await import('heic-decode')
    const { width, height, data } = await decodeHeic({ buffer: new Uint8Array(await blob.arrayBuffer()) })
    return new ImageData(new Uint8ClampedArray(data), width, height)
  }
}

async function toJpeg(blob: Blob): Promise<Blob> {
  const image = await decode(blob)
  const canvas = new OffscreenCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context in this browser')

  // OffscreenCanvas is the worker-safe replacement for the canvas element heic2any wanted,
  // and it hands the JPEG encoding to the browser rather than to JavaScript.
  if (image instanceof ImageData) ctx.putImageData(image, 0, 0)
  else {
    ctx.drawImage(image, 0, 0)
    image.close() // release the decoded frame straight away; these are large
  }

  return canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY })
}

self.onmessage = (event: MessageEvent<ConvertRequest>) => {
  const { id, blob } = event.data
  void (async () => {
    try {
      self.postMessage({ id, ok: true, blob: await toJpeg(blob) } satisfies ConvertResponse)
    } catch (err) {
      self.postMessage({
        id,
        ok: false,
        error: err instanceof Error ? err.message : 'conversion failed',
      } satisfies ConvertResponse)
    }
  })()
}
