import { memo } from 'react'
import { thumbnailAt, type DriveFile } from '../drive/list.ts'

// The CSS frame is ~124px; ask Drive for enough pixels that it is not soft on a retina screen.
const REQUEST_PX = 320

export const Tile = memo(function Tile({ file }: { file: DriveFile }) {
  const href = file.webViewLink ?? undefined

  // Drive has no thumbnail for a .mov until it has produced one, and none at all for some
  // types. A named frame reads as a file we hold; a broken image reads as a bug.
  if (!file.thumbnailLink) {
    return (
      <li className="frame">
        <a className="frame-named" href={href} target="_blank" rel="noreferrer">
          {file.name}
        </a>
      </li>
    )
  }

  return (
    <li className="frame">
      <a href={href} target="_blank" rel="noreferrer" title={file.name}>
        <img
          src={thumbnailAt(file.thumbnailLink, REQUEST_PX)}
          alt={file.name}
          loading="lazy"
          decoding="async"
          width={REQUEST_PX}
          height={REQUEST_PX}
        />
      </a>
    </li>
  )
})
