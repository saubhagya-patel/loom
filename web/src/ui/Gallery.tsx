import { useEffect, useRef } from 'react'
import { useGallery } from '../drive/useGallery.ts'
import { Tile } from './Tile.tsx'

function formatBytes(total: number): string {
  if (total >= 1024 ** 3) return `${(total / 1024 ** 3).toFixed(1)} GB`
  if (total >= 1024 ** 2) return `${Math.round(total / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(total / 1024))} KB`
}

export function Gallery({ folderId, onAddPhotos }: { folderId: string; onAddPhotos: () => void }) {
  const { files, loading, error, complete, loadMore, refresh } = useGallery(folderId)
  const sentinel = useRef<HTMLDivElement>(null)

  // Pages load as you reach the bottom rather than behind a button you have to find. The
  // margin starts the next page before the grid actually runs out.
  useEffect(() => {
    const el = sentinel.current
    if (!el || complete) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore()
      },
      { rootMargin: '400px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [complete, loadMore])

  if (error) {
    return (
      <div className="empty">
        <p className="error">{error}</p>
        <button onClick={refresh}>Try again</button>
      </div>
    )
  }

  if (files.length === 0) {
    if (loading) return <p className="hero-note">Looking in your Drive…</p>
    return (
      <div className="empty">
        <p>No photos here yet.</p>
        <p className="muted">
          Whatever you upload goes into a folder called loom in your own Google Drive. It never
          passes through our servers.
        </p>
        <button className="primary" onClick={onAddPhotos}>
          Add photos
        </button>
      </div>
    )
  }

  const bytes = files.reduce((sum, file) => sum + (file.size ?? 0), 0)

  return (
    <>
      {/* The sentence is the point of this screen; the grid below is its evidence. The count
          carries a + until every page is in, because claiming a total we have not finished
          counting would be the one thing this screen must not do. */}
      <h1 className="hero">
        <span className="count tabular">
          {files.length}
          {complete ? '' : '+'}
        </span>{' '}
        {files.length === 1 ? 'photo is' : 'photos are'} safe in your Drive.
      </h1>
      <p className="hero-note tabular">{formatBytes(bytes)}</p>

      <ul className="sheet">
        {files.map((file) => (
          <Tile key={file.id} file={file} />
        ))}
      </ul>

      <div ref={sentinel} className="sentinel" />

      <p className="sheet-foot">
        {loading
          ? 'Loading more…'
          : /* Said here, at the end of the sheet, rather than as a permanent banner: this is
               where someone would notice a file they expected is missing. */
            'Only what loom uploaded appears here. Moving a file out of the loom folder in Drive removes it from this view.'}
      </p>
    </>
  )
}
