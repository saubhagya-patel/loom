import { memo } from 'react'
import { thumbnailAt, type DriveFile } from '../drive/list.ts'
import { kindOf } from './format.ts'

const REQUEST_PX = 480

/**
 * One frame of the contact sheet: a hairline cell, a white matte, and the photograph inset
 * within it — the way a print sits inside a window mount. The verified pin and the format
 * badge are engraved into opposite corners.
 */
export const Tile = memo(function Tile({ file }: { file: DriveFile }) {
  const href = file.webViewLink ?? undefined
  const kind = kindOf(file.mimeType, file.name)

  return (
    <li className="frame">
      <a className="frame-link" href={href} target="_blank" rel="noreferrer" title={file.name}>
        <span className="matte">
          {file.thumbnailLink ? (
            <img
              src={thumbnailAt(file.thumbnailLink, REQUEST_PX)}
              alt={file.name}
              loading="lazy"
              decoding="async"
              width={REQUEST_PX}
              height={REQUEST_PX}
            />
          ) : (
            /* Drive makes no thumbnail for a .mov until it has processed one. A named plate
               reads as a file we hold; a broken image reads as a bug. */
            <span className="frame-blank">
              <span className="label">{kind}</span>
              <span className="frame-blank-name mono">{file.name}</span>
            </span>
          )}
        </span>

        {/* In Drive at all means Drive confirmed it, so every frame here is verified. */}
        <span className="pin" title="Verified in Drive" aria-label="Verified in Drive">
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden focusable="false">
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M4.8 8.3l2.1 2.1 4.3-4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </span>

        <span className="kind label">{kind}</span>
      </a>
    </li>
  )
})
