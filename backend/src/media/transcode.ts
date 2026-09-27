import type { Request } from 'express'
import type { Readable } from 'node:stream'
import busboy from 'busboy'
import { all as decodeHeicAll } from 'heic-decode'
import sharp from 'sharp'
import { AppError } from '../api/errors.ts'
import { createDriveSink } from './drive-sink.ts'

// libvips keeps an operation cache and spins a thread per core by default. Both are tuned for
// a batch image server and both are wrong for a single streaming conversion.
sharp.cache(false)
sharp.concurrency(1)

// A byte cap bounds the file, not the pixels: a small file can declare enormous dimensions.
// An iPhone still is about 12 MP, so 50 MP refuses a decompression bomb with room to spare —
// and it is checked against the reported dimensions *before* anything is decoded.
const MAX_PIXELS = 50_000_000
const QUALITY = 88

const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1'])

function isHeic(input: Buffer): boolean {
  return (
    input.length >= 12 &&
    input.subarray(4, 8).toString('latin1') === 'ftyp' &&
    HEIC_BRANDS.has(input.subarray(8, 12).toString('latin1'))
  )
}

/**
 * sharp does the encoding; it does not do the HEIC decoding.
 *
 * Measured 2026-09-21: sharp 0.35.4's bundled libheif 1.23.2 cannot decode HEVC-coded HEIC at
 * all — every file fails with `bad seek to <filesize + 32>`, including one Apple's own encoder
 * produced, and including files macOS opens without complaint. sharp 0.35.4 is the latest
 * release, so there is no upgrade to take. Its JPEG *encoding* is fine and fast, so it keeps
 * that half and libheif-wasm does the decode.
 */
async function toJpegStream(input: Buffer): Promise<Readable> {
  if (!isHeic(input)) {
    return sharp(input, { limitInputPixels: MAX_PIXELS }).jpeg({ quality: QUALITY })
  }

  const images = await decodeHeicAll({ buffer: new Uint8Array(input) })
  try {
    // A HEIC can hold a burst or a sequence. V1 takes the first image; grouping is V2
    // (docs/plan.md §2.9).
    const first = images[0]
    if (!first) throw new AppError(422, 'not_an_image', 'that file contains no image')
    if (first.width * first.height > MAX_PIXELS) {
      throw new AppError(413, 'too_large', 'that photo has too many pixels to convert here')
    }

    const { width, height, data } = await first.decode()
    return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
      raw: { width, height, channels: 4 },
      limitInputPixels: MAX_PIXELS,
    }).jpeg({ quality: QUALITY })
  } finally {
    // Frees the decoder's WASM heap. Without this each request leaks it for the life of the
    // process, which on this path means leaking a decoded photo.
    images.dispose()
  }
}

/**
 * The single exception to TRD §1's zero-knowledge storage, and the fence around it is as much
 * the deliverable as the conversion (docs/plan.md §2.7).
 *
 * **§2.7 asks for the input to be streamed, and that is not achievable.** HEIC is an indexed
 * container: the decoder seeks around it, so it needs the whole thing and a seekable source.
 * That is a property of the format, not of any library. The input is therefore buffered —
 * bounded by the same 32 MiB cap the route already enforces, held only for the life of the
 * request. What §2.7 actually promises still holds: nothing on disk, no temp files, nothing
 * outliving the request, and no cleanup path that can leak. The *output* still streams into
 * Drive in 8 MiB chunks via drive-sink.ts.
 */
export function transcodeToDrive(req: Request, sessionUri: string, maxBytes: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const bb = busboy({ headers: req.headers, limits: { files: 1, fields: 4, fileSize: maxBytes } })
    let sawFile = false

    bb.on('file', (_name, stream) => {
      sawFile = true
      const parts: Buffer[] = []
      let received = 0

      stream.on('data', (chunk: Buffer) => {
        received += chunk.length
        // Belt to the route's Content-Length brace: a client can lie about its length, and
        // this is the number that is actually true.
        if (received > maxBytes) {
          stream.destroy()
          reject(new AppError(413, 'too_large', 'that photo is too large to convert here'))
          return
        }
        parts.push(chunk)
      })

      stream.on('limit', () => reject(new AppError(413, 'too_large', 'that photo is too large to convert here')))
      stream.on('error', () => reject(new AppError(400, 'upload_failed', 'the upload stream failed')))

      stream.on('end', () => {
        void (async () => {
          try {
            const jpeg = await toJpegStream(Buffer.concat(parts))
            const sink = createDriveSink(sessionUri)
            // `for await` is what preserves backpressure on the way out: the encoder stays
            // paused while a PUT is in flight, so a slow network throttles the conversion
            // rather than queueing its output in memory.
            for await (const chunk of jpeg) await sink.write(chunk as Buffer)
            resolve(await sink.end())
          } catch (err) {
            reject(
              err instanceof AppError
                ? err
                : new AppError(422, 'not_an_image', 'that file could not be converted'),
            )
          }
        })()
      })
    })

    bb.on('error', () => reject(new AppError(400, 'upload_failed', 'the upload could not be read')))
    bb.on('close', () => {
      if (!sawFile) reject(new AppError(400, 'invalid_request', 'no file was sent'))
    })

    req.pipe(bb)
  })
}
