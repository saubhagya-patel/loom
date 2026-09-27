import { memo } from 'react'
import { thumbnailAt, type DriveFile } from '../drive/list.ts'
import { kindOf } from './format.ts'

const REQUEST_PX = 480

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

        <span className="kind label">{kind}</span>
      </a>
    </li>
  )
})
