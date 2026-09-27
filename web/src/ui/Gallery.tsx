import { useEffect, useMemo, useRef, useState } from 'react'
import type { DriveFile } from '../drive/list.ts'
import { useGallery } from '../drive/useGallery.ts'
import { bytes, dayKey, dayLabel } from './format.ts'
import { Tile } from './Tile.tsx'

type Density = 'compact' | 'standard' | 'large'

const DENSITIES: { value: Density; short: string; title: string }[] = [
  { value: 'compact', short: 'C', title: 'Compact' },
  { value: 'standard', short: 'STD', title: 'Standard' },
  { value: 'large', short: 'LG', title: 'Large' },
]

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

function pulse(at: number | null): string {
  if (at === null) return 'Idle'
  const mins = Math.floor((Date.now() - at) / 60000)
  if (mins < 1) return 'Active · just now'
  if (mins < 60) return `Active · ${mins}m ago`
  return `Active · ${Math.floor(mins / 60)}h ago`
}

export function Gallery({ folderId, onAddPhotos }: { folderId: string; onAddPhotos: () => void }) {
  const { files, loading, error, complete, lastLoadedAt, loadMore, refresh } = useGallery(folderId)
  const [density, setDensity] = useState<Density>('standard')
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
      <main className="page">
        <p className="notice notice--alert">{error}</p>
        <button className="btn" onClick={refresh}>
          Try again
        </button>
      </main>
    )
  }

  if (files.length === 0 && loading) {
    return (
      <main className="page">
        <p className="band mono muted">Reading your Drive…</p>
      </main>
    )
  }

  if (files.length === 0) {
    return (
      <main className="page">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow label">
              <span className="dot dot--verified" />
              Archive registry · Google Drive
            </span>
            <h1 className="display">Nothing is in your Drive yet.</h1>
            <p className="lede">
              Whatever you add goes into a folder called <span className="path-chip mono">/loom/</span>{' '}
              in your own Google Drive, straight from this browser.
            </p>
            <button className="btn btn--clay" onClick={onAddPhotos}>
              Upload your first batch
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow label">
            <span className="dot dot--verified" />
            Archive registry · Google Drive
          </span>
          <h1 className="display">
            <span className="mono display-count">
              {files.length.toLocaleString()}
              {complete ? '' : '+'}
            </span>{' '}
            {files.length === 1 ? 'file safely verified in Google Drive' : 'files safely verified in Google Drive'}{' '}
            <span className="path-chip mono">/loom/</span>
          </h1>
        </div>

        <div className="hero-side">
          <div className="statcard">
            <div className="stat">
              <span className="label">Storage used</span>
              <span className="stat-value mono">{bytes(stored)}</span>
            </div>
            <span className="stat-rule" />
            <div className="stat">
              <span className="label">Sync pulse</span>
              <span className="stat-value mono stat-value--verified">{pulse(lastLoadedAt)}</span>
            </div>
            <span className="stat-rule" />
            <div className="stat">
              <span className="label">Density</span>
              <div className="segmented segmented--xs">
                {DENSITIES.map((d) => (
                  <button
                    key={d.value}
                    aria-current={density === d.value}
                    title={d.title}
                    onClick={() => setDensity(d.value)}
                  >
                    {d.short}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="hero-actions">
            <button className="btn" onClick={refresh}>
              Refresh from Drive
            </button>
            <button className="btn btn--clay" onClick={onAddPhotos}>
              Upload new batch
            </button>
          </div>
        </div>
      </section>

      {/* Both halves are true of every byte above: the browser PUTs straight at Drive, and no
          part of a file is kept or logged on our side. */}
      <div className="rail mono">
        <span className="rail-group">
          <span className="rail-item">
            <span className="dot dot--verified" />
            Direct in-browser streaming
          </span>
          <span className="rail-item">Zero server retention</span>
        </span>
        <span className="rail-group">
          <span className="rail-item">Sort: newest first</span>
          <span className="rail-item">
            Showing 001..{String(files.length).padStart(3, '0')}
            {complete ? '' : '+'}
          </span>
        </span>
      </div>

      <main className="page">
        {groups.map((group) => (
          <section key={group.key} className="volume">
            <header className="volume-head">
              <h2 className="volume-title">
                Volume <span className="mono">{group.key}</span>
              </h2>
              <span className="volume-count mono">
                · {group.files.length} {group.files.length === 1 ? 'item' : 'items'}
              </span>
              <span className="volume-label mono">{group.label}</span>
              <span className="verified-chip mono">
                <CheckGlyph />
                {group.files.length} verified in Drive
              </span>
            </header>

            <ul className={`sheet sheet--${density}`}>
              {group.files.map((file, i) => (
                <Tile key={file.id} file={file} index={i + 1} />
              ))}
            </ul>
          </section>
        ))}

        <div ref={sentinel} className="sentinel" />

        <p className="stream-end mono">
          {loading ? (
            'Reading more from Drive…'
          ) : (
            <>
              <span className="dot dot--verified" />
              End of stream · every file above confirmed by Drive just now
            </>
          )}
        </p>
        <p className="stream-note mono">
          Only files loom uploaded are visible here — moving one out of the loom folder removes
          it from this view.
        </p>
      </main>
    </>
  )
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden focusable="false">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.9 8.3l2.1 2.1 4.2-4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
