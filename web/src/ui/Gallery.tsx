import { useEffect, useMemo, useRef, useState } from 'react'
import type { DriveFile } from '../drive/list.ts'
import { useGallery } from '../drive/useGallery.ts'
import { bytes, dayKey, dayLabel } from './format.ts'
import { Tile } from './Tile.tsx'

type Density = 'comfortable' | 'dense'

function groupByDay(files: DriveFile[]): { key: string; label: string; files: DriveFile[] }[] {
  const groups = new Map<string, { key: string; label: string; files: DriveFile[] }>()
  for (const file of files) {
    const key = dayKey(file.createdTime)
    const group = groups.get(key) ?? { key, label: dayLabel(file.createdTime), files: [] }
    group.files.push(file)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function agoFrom(at: number | null): string {
  if (at === null) return 'never'
  const mins = Math.floor((Date.now() - at) / 60000)
  if (mins < 1) return 'moments ago'
  if (mins === 1) return '1 minute ago'
  if (mins < 60) return `${mins} minutes ago`
  const hours = Math.floor(mins / 60)
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`
}

export function Gallery({ folderId, onAddPhotos }: { folderId: string; onAddPhotos: () => void }) {
  const { files, loading, error, complete, lastLoadedAt, loadMore, refresh } = useGallery(folderId)
  const [density, setDensity] = useState<Density>('comfortable')
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = sentinel.current
    if (!el || complete) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore()
      },
      { rootMargin: '600px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [complete, loadMore])

  const groups = useMemo(() => groupByDay(files), [files])
  const stored = files.reduce((sum, f) => sum + (f.size ?? 0), 0)

  if (error) {
    return (
      <section className="band">
        <p className="notice notice--alert">{error}</p>
        <button className="btn" onClick={refresh}>
          Try again
        </button>
      </section>
    )
  }

  if (files.length === 0 && loading) {
    return <p className="band mono muted">Reading your Drive…</p>
  }

  if (files.length === 0) {
    return (
      <section className="band empty">
        <span className="label muted">Repository empty</span>
        <h1 className="headline">Nothing is in your Drive yet.</h1>
        <p className="lede">
          Whatever you add goes into a folder called <span className="mono">loom</span> in your own
          Google Drive, straight from this browser.
        </p>
        <button className="btn btn--clay" onClick={onAddPhotos}>
          Add photos
        </button>
      </section>
    )
  }

  return (
    <>
      {/* The hero states the thing the user came to hear; the sheet below is its evidence. */}
      <section className="band hero">
        <div className="hero-copy">
          <span className="eyebrow label">
            <span className="dot dot--verified" />
            Drive synchronised repository
          </span>
          <h1 className="headline">
            <span className="mono headline-count">
              {files.length.toLocaleString()}
              {complete ? '' : '+'}
            </span>{' '}
            {files.length === 1 ? 'photo is safely in Drive.' : 'photos are safely in Drive.'}
          </h1>
          <p className="hero-meta mono">
            <span>Last read {agoFrom(lastLoadedAt)}</span>
            <span className="slash">/</span>
            <span>Drive / loom</span>
            <span className="slash">/</span>
            <span>{bytes(stored)} stored</span>
          </p>
        </div>

        <div className="hero-actions">
          <div className="segmented segmented--sm">
            <button aria-current={density === 'comfortable'} onClick={() => setDensity('comfortable')}>
              Comfortable
            </button>
            <span className="segmented-rule" />
            <button aria-current={density === 'dense'} onClick={() => setDensity('dense')}>
              Dense
            </button>
          </div>
          <button className="btn" onClick={refresh}>
            Refresh from Drive
          </button>
          <button className="btn btn--clay" onClick={onAddPhotos}>
            Add photos
          </button>
        </div>
      </section>

      {groups.map((group) => (
        <section key={group.key} className="volume">
          <header className="volume-head">
            <h2 className="volume-title">{group.label}</h2>
            <span className="volume-count mono">
              {group.files.length} {group.files.length === 1 ? 'item' : 'items'} verified
            </span>
          </header>
          <ul className={`sheet${density === 'dense' ? ' sheet--dense' : ''}`}>
            {group.files.map((file) => (
              <Tile key={file.id} file={file} />
            ))}
          </ul>
        </section>
      ))}

      <div ref={sentinel} className="sentinel" />

      <p className="stream-end label">
        {loading ? (
          'Reading more from Drive…'
        ) : (
          <>
            <span className="dot dot--verified" />
            End of stream · every file above confirmed by Drive
          </>
        )}
      </p>
      <p className="stream-note mono">
        Only files loom uploaded are visible here — moving one out of the loom folder removes it
        from this view.
      </p>
    </>
  )
}
