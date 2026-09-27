import { memo, useEffect, useRef, useState } from 'react'
import { thumbnailAt, type DriveFile } from '../drive/list.ts'
import { kindOf } from './format.ts'

// The frame is 190px comfortable / 124px dense, so this covers both on a retina screen
// without asking Google for pixels nobody sees.
const REQUEST_PX = 320
const MAX_RETRIES = 2

/**
 * One frame of the contact sheet: a hairline cell, a white matte, and the photograph inset
 * within it — the way a print sits inside a window mount.
 *
 * There is deliberately no verified tick here. The gallery *is* a listing of Drive, so every
 * frame in it would carry the same mark, which makes it decoration rather than information —
 * and emerald in this system means verification and nothing else. The claim is made once per
 * day-group in the volume header, where it is readable. The tick that does carry information
 * is the one in the upload queue, where `verified` gates TRD §9's deletion guardrail.
 */
export const Tile = memo(function Tile({ file }: { file: DriveFile }) {
  const href = file.webViewLink ?? undefined
  const kind = kindOf(file.mimeType, file.name)

  // lh3.googleusercontent.com rate-limits thumbnails, and a dense grid asks for dozens at
  // once — measured returning 429 under exactly that load. So a failed frame backs off and
  // tries again rather than leaving the browser's broken-image alt text on screen, and after
  // a couple of attempts it degrades to a named plate like a file with no thumbnail at all.
  const [attempt, setAttempt] = useState(0)
  const [exhausted, setExhausted] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const onError = (): void => {
    if (attempt >= MAX_RETRIES) {
      setExhausted(true)
      return
    }
    // Jittered, because every frame in the row failed at the same instant and retrying in
    // lockstep would reproduce the burst that caused it.
    const delay = 500 * 2 ** attempt + Math.random() * 400
    timer.current = setTimeout(() => setAttempt((n) => n + 1), delay)
  }

  const showImage = file.thumbnailLink !== null && !exhausted

  return (
    <li className="frame">
      <a className="frame-link" href={href} target="_blank" rel="noreferrer" title={file.name}>
        <span className="matte">
          {showImage ? (
            <img
              // Remounting on retry makes the browser re-request rather than reuse the
              // failed response; a cache-busting query param would break the signed URL.
              key={attempt}
              src={thumbnailAt(file.thumbnailLink!, REQUEST_PX)}
              alt=""
              loading="lazy"
              decoding="async"
              width={REQUEST_PX}
              height={REQUEST_PX}
              onError={onError}
            />
          ) : (
            /* Drive also has no thumbnail for a .mov until it has processed one. Either way a
               named plate reads as a file we hold; a broken image reads as a bug. */
            <span className="frame-blank">
              <span className="label">{kind}</span>
              <span className="frame-blank-name mono">{file.name}</span>
            </span>
          )}
        </span>

        <span className="kind label">{kind}</span>
      </a>
    </li>
  )
})
