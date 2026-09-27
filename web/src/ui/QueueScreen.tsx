import { useEffect, useMemo, useRef, useState } from 'react'
import { getAccessToken, refreshAccessToken } from '../auth/token.ts'
import { checkHeic } from '../heic/detect.ts'
import { DEFAULT_QUALITY } from '../heic/convert.ts'
import { STRATEGY_CHOICES, type Strategy } from '../heic/strategy.ts'
import { createQueue } from '../upload/queue.ts'
import { createTransport } from '../upload/transport.ts'
import { useQueueIds, useQueueSummary } from '../upload/useQueue.ts'
import { bytes } from './format.ts'
import { QueueRow } from './QueueRow.tsx'

type Staged = {
  files: File[]
  heicCount: number
  substituted: number
  unreadable: number
  totalBytes: number
}

export function QueueScreen({ folderId }: { folderId: string }) {
  const queue = useMemo(
    () =>
      createQueue({
        transport: createTransport(),
        getToken: getAccessToken,
        refreshToken: refreshAccessToken,
        folderId,
      }),
    [folderId],
  )

  const picker = useRef<HTMLInputElement>(null)
  const ids = useQueueIds(queue)
  const summary = useQueueSummary(queue)
  const [staged, setStaged] = useState<Staged | null>(null)
  const [strategy, setStrategy] = useState<Strategy>('device')
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    void queue.hydrate()
  }, [queue])

  async function receive(files: File[]): Promise<void> {
    const checks = await Promise.all(files.map(checkHeic))
    setStaged({
      files,
      heicCount: checks.filter((c) => c.isHeic).length,
      substituted: checks.filter((c) => c.substituted).length,
      unreadable: checks.filter((c) => c.unreadable).length,
      totalBytes: files.reduce((n, f) => n + f.size, 0),
    })
  }

  function send(): void {
    if (!staged) return
    // A file that is not really HEIC uploads as-is whatever is chosen here, so the choice is
    // only offered when it can change something.
    void queue.add(staged.files, staged.heicCount > 0 ? strategy : 'raw')
    setStaged(null)
  }

  const inFlight = summary.total > 0
  const totalQueuedBytes = staged?.totalBytes ?? 0

  return (
    <main className="page uploader">
      <section className="uploader-head">
        <div>
          <span className="eyebrow label">
            <span className="dot dot--verified" />
            Direct drive pipe · resumable, 8 MiB chunks
          </span>
          <h1 className="display display--sm">Upload · Loom Drive target</h1>
        </div>
        <div className="statcard statcard--tight">
          <div className="stat">
            <span className="label">Drive partition</span>
            <span className="stat-value mono">Drive/loom/</span>
          </div>
          <span className="stat-rule" />
          <div className="stat">
            <span className="label">Auth scope</span>
            <span className="stat-value mono stat-value--clay">drive.file (restricted)</span>
          </div>
        </div>
      </section>

      <div className="uploader-grid">
        <div className="uploader-left">
          <div
            className={`ingest${dragging ? ' ingest--live' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              const files = [...e.dataTransfer.files]
              if (files.length) void receive(files)
            }}
          >
            <span className="tick tick--tl" />
            <span className="tick tick--tr" />
            <span className="tick tick--bl" />
            <span className="tick tick--br" />

            <span className="ingest-glyph" aria-hidden>
              <svg viewBox="0 0 24 24" width="22" height="22">
                <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
                <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" strokeWidth="1.7" />
              </svg>
            </span>
            <p className="ingest-title">Drop your files here</p>
            <p className="ingest-note">
              Drag photos or video straight into the browser pipeline, or click to browse.
            </p>
            <div className="ingest-chips mono">
              <span>Zero server retention</span>
              <span>Resumable · survives a drop</span>
              <span>HEIC · JPEG · video</span>
            </div>
            <div className="ingest-actions">
              <button className="btn btn--clay" onClick={() => picker.current?.click()}>
                Browse files
              </button>
            </div>
            <input
              ref={picker}
              type="file"
              multiple
              accept="image/*,video/*,.heic,.heif"
              hidden
              onChange={(e) => {
                const files = [...(e.target.files ?? [])]
                e.target.value = ''
                if (files.length) void receive(files)
              }}
            />
          </div>

          {staged ? (
            <section className="staged">
              <header className="staged-head">
                <span className="label staged-status">
                  <span className="dot dot--clay" />
                  Staged · ready for stream
                </span>
                <button className="btn btn--sm btn--ghost" onClick={() => setStaged(null)}>
                  Clear
                </button>
              </header>

              <div className="staged-summary">
                <span className="staged-count mono">
                  {staged.files.length} {staged.files.length === 1 ? 'file' : 'files'}
                </span>
                <span className="staged-bytes mono">{bytes(totalQueuedBytes)}</span>
                {staged.heicCount > 0 ? (
                  <span className="staged-heic mono">{staged.heicCount} HEIC</span>
                ) : null}
              </div>

              {staged.substituted > 0 ? (
                <p className="staged-note mono">
                  {staged.substituted} named .heic {staged.substituted === 1 ? 'is' : 'are'} already
                  JPEG — your browser converted {staged.substituted === 1 ? 'it' : 'them'} on
                  selection. {staged.substituted === 1 ? 'It needs' : 'They need'} no conversion.
                </p>
              ) : null}

              {staged.unreadable > 0 ? (
                <p className="staged-note staged-note--alert mono">
                  {staged.unreadable} could not be read — probably still in iCloud. Open{' '}
                  {staged.unreadable === 1 ? 'it' : 'them'} in Photos to download first.
                </p>
              ) : null}

              {/* TRD §6's pre-upload decision, inline against the staged files rather than in
                  a modal. Same requirement, and it stays visible while you decide. */}
              {staged.heicCount > 0 ? (
                <>
                  <span className="label staged-label">Encoding &amp; ingestion target</span>
                  <div className="encodings">
                    {STRATEGY_CHOICES.map((choice) => (
                      <button
                        key={choice.value}
                        className={`encoding${strategy === choice.value ? ' encoding--on' : ''}`}
                        onClick={() => setStrategy(choice.value)}
                      >
                        <span className="encoding-title">{choice.title}</span>
                        <span className="encoding-note mono">
                          {choice.value === 'device'
                            ? `Recommended · q${DEFAULT_QUALITY} in your browser`
                            : choice.value === 'raw'
                              ? 'Untouched original bytes'
                              : 'Leaves your device'}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              <div className="staged-foot">
                <span className="staged-target mono">
                  Target: Google Drive → <strong>/loom/</strong>
                </span>
                <button className="btn btn--clay" onClick={send}>
                  Upload {staged.files.length} {staged.files.length === 1 ? 'file' : 'files'} to Drive
                </button>
              </div>
            </section>
          ) : null}
        </div>

        <aside className="uploader-right">
          <header className="pipe-head-bar">
            <span className="pipe-title">
              <span className="dot dot--verified" />
              Pipe activity
            </span>
            <span className="pipe-summary mono">
              {summary.total} {summary.total === 1 ? 'item' : 'items'}
              {summary.active > 0 ? ` · ${summary.active} in flight` : ''}
              {summary.done > 0 ? ` · ${summary.done} verified` : ''}
            </span>
          </header>

          {inFlight ? (
            <ul className="pipes">
              {ids.map((id) => (
                <QueueRow key={id} queue={queue} id={id} />
              ))}
            </ul>
          ) : (
            <p className="pipe-empty mono">Nothing in the pipe. Drop files to begin.</p>
          )}

          <p className="pipe-foot-note mono">
            Zero server buffer · the browser streams straight to Google over TLS.
          </p>
        </aside>
      </div>
    </main>
  )
}
