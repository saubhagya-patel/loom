import type { Request } from 'express'
import busboy from 'busboy'
import sharp from 'sharp'
import { AppError } from '../api/errors.ts'
import { createDriveSink } from './drive-sink.ts'

// libvips keeps an operation cache and spins a thread per core by default. Both are tuned for
// a batch image server, and both are wrong for a single streaming conversion: the cache holds
// decoded data alive after we are done with it, and the threads each take a working buffer.
// Measured on a 17 MB input: this and sequentialRead below took peak growth from ~308 MB to a
// fraction of it.
sharp.cache(false)
sharp.concurrency(1)

// A 32 MiB cap bounds the bytes, not the pixels: a small file can declare enormous dimensions
// and libvips would allocate for them. An iPhone still is about 12 MP, so 50 MP leaves ample
// headroom while refusing a decompression bomb — and it is what bounds peak memory, since the
// decoded raster is three bytes per pixel.
const MAX_PIXELS = 50_000_000

// MEASURED, so the claim in docs/plan.md §2.7 stays honest. A 17 MB / 20 MP input peaks around
// 230 MB of RSS above baseline, and tuning the knobs above took it there from ~308 MB.
//
// It is **bounded**, not flat, and the difference matters. `sharp` buffers its *stream input*
// internally — libvips needs a seekable source — and decoding then costs three bytes per pixel
// regardless of how the bytes arrived. So memory tracks the image's dimensions, capped by
// MAX_PIXELS, not the file's size.
//
// What §2.7 actually promises is still true: nothing is written to disk, nothing outlives the
// request, and there is no cleanup path that can leak because there is nothing to clean up.
// The output side genuinely streams, in 8 MiB chunks, via drive-sink.ts. Concurrent requests
// multiply this, which is a deployment question for Phase 5 rather than a local-V1 one.

/**
 * The single exception to TRD §1's zero-knowledge storage, and the fence around it is as much
 * the deliverable as the conversion (docs/plan.md §2.7).
 *
 * busboy -> sharp -> Drive, as streams, with backpressure preserved. No multer, no disk, no
 * memory storage, no temp files — so there is no cleanup path that can leak, because there is
 * nothing to clean up.
 */
export function transcodeToDrive(req: Request, sessionUri: string, maxBytes: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const bb = busboy({ headers: req.headers, limits: { files: 1, fields: 4, fileSize: maxBytes } })
    let sawFile = false

    bb.on('file', (_name, stream) => {
      sawFile = true

      // sharp() with no argument is a TRANSFORM STREAM. sharp(buffer) is the form every example
      // uses and it is wrong here: it reads the whole input into memory, which defeats the
      // entire point of the pipe and makes resident memory track the upload size.
      //
      // sequentialRead lets libvips work top-to-bottom in strips instead of pulling the whole
      // raster in for random access — the single biggest lever on peak memory here.
      //
      // Not mozjpeg: it is markedly slower, and TRD §6 sells this route as the *fast* one for
      // budget phones. A slower cloud path than the on-device path has no reason to exist.
      const converter = sharp({ sequentialRead: true, limitInputPixels: MAX_PIXELS })
        .jpeg({ quality: 88 })

      // A second line of defence behind the Content-Length check in the route. If a client
      // lies about its length, busboy stops the stream here.
      stream.on('limit', () => {
        converter.destroy()
        reject(new AppError(413, 'too_large', 'that photo is too large to convert here'))
      })

      stream.on('error', () => reject(new AppError(400, 'upload_failed', 'the upload stream failed')))
      converter.on('error', () => reject(new AppError(422, 'not_an_image', 'that file could not be converted')))
      stream.pipe(converter)

      void (async () => {
        try {
          const sink = createDriveSink(sessionUri)
          // `for await` is what preserves backpressure: the converter stays paused while a PUT
          // is in flight, so a slow network throttles the conversion rather than queueing it
          // up in memory.
          for await (const chunk of converter) await sink.write(chunk as Buffer)
          resolve(await sink.end())
        } catch (err) {
          reject(err instanceof AppError ? err : new AppError(502, 'transcode_failed', 'the conversion failed'))
        }
      })()
    })

    bb.on('error', () => reject(new AppError(400, 'upload_failed', 'the upload could not be read')))
    bb.on('close', () => {
      if (!sawFile) reject(new AppError(400, 'invalid_request', 'no file was sent'))
    })

    req.pipe(bb)
  })
}
