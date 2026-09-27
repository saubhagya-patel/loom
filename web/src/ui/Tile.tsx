import { memo, useEffect, useRef, useState } from 'react'
import { thumbnailAt, type DriveFile } from '../drive/list.ts'
import { bytes, kindOf } from './format.ts'

const REQUEST_PX = 480
const MAX_RETRIES = 2

/**
 * One cell of the contact sheet: a white plate, the photograph, and a footer carrying the
 * name, what the file actually is, and its size.
 *
 * No verified tick. The gallery *is* a listing of Drive, so a per-frame mark would be true of
 * every tile and therefore say nothing — the claim is made once per volume header, where the
 * count varies. Green stays reserved for things that are sometimes false.
 */
export const Tile = memo(function Tile({ file, index }: { file: DriveFile; index: number }) {
  const href = file.webViewLink ?? undefined
  const kind = kindOf(file.mimeType, file.name)

  // lh3.googleusercontent.com rate-limits thumbnails and a grid asks for dozens at once —
  // measured returning 429 under exactly that load. Back off, retry, then degrade.
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
    // Jittered: every frame failed at the same instant, and retrying in lockstep reproduces
    // the burst that caused it.
    timer.current = setTimeout(() => setAttempt((n) => n + 1), 500 * 2 ** attempt + Math.random() * 400)
  }

  const showImage = file.thumbnailLink !== null && !exhausted

  return (
    <li className="cell">
      <a className="cell-link" href={href} target="_blank" rel="noreferrer" title={file.name}>
        <span className="cell-plate">
          {showImage ? (
            <>
              <img
                key={attempt}
                src={thumbnailAt(file.thumbnailLink!, REQUEST_PX)}
                alt=""
                loading="lazy"
                decoding="async"
                width={REQUEST_PX}
                height={REQUEST_PX}
                onError={onError}
              />
              <span className="cell-index mono">#{String(index).padStart(2, '0')}</span>
            </>
          ) : (
            /* Drive makes no thumbnail for a .mov until it has processed one, and rate limits
               can exhaust the retries. Either way this says what is happening. */
            <span className="cell-pending">
              <span className="cell-spinner" aria-hidden />
              <span className="cell-pending-name mono">{file.name}</span>
              <span className="cell-pending-note">
                {exhausted ? 'Preview unavailable right now' : 'Drive is still making a preview'}
              </span>
            </span>
          )}
        </span>

        <span className="cell-foot">
          <span className="cell-name mono">{file.name}</span>
          <span className="cell-kind mono">{kind}</span>
          <span className="cell-size mono">{file.size === null ? '—' : bytes(file.size)}</span>
        </span>
      </a>
    </li>
  )
})
