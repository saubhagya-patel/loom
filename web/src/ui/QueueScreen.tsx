import { useEffect, useMemo, useRef, useState } from 'react'
import { getAccessToken, refreshAccessToken } from '../auth/token.ts'
import { checkHeic } from '../heic/detect.ts'
import type { Strategy } from '../heic/strategy.ts'
import { createQueue } from '../upload/queue.ts'
import { createTransport } from '../upload/transport.ts'
import { useQueueIds, useQueueSummary } from '../upload/useQueue.ts'
import { DecisionModal } from './DecisionModal.tsx'
import { QueueRow } from './QueueRow.tsx'

type Pending = { files: File[]; heicCount: number; substitutedCount: number }

export function QueueScreen({
  folderId,
  onActiveCount,
}: {
  folderId: string
  onActiveCount?: (n: number) => void
}) {
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
  const [pending, setPending] = useState<Pending | null>(null)
  const [unreadable, setUnreadable] = useState(0)
  const [substituted, setSubstituted] = useState(0)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    void queue.hydrate()
  }, [queue])

  useEffect(() => {
    onActiveCount?.(summary.active)
  }, [summary.active, onActiveCount])

  async function receive(files: File[]): Promise<void> {
    const checks = await Promise.all(files.map(checkHeic))
    setUnreadable(checks.filter((c) => c.unreadable).length)

    const substitutedCount = checks.filter((c) => c.substituted).length
    const heicCount = checks.filter((c) => c.isHeic).length

    if (heicCount === 0) {
      // Nothing to decide. Say so when files *claimed* HEIC and were not, or picking a .heic
      // and getting no modal reads as the feature being broken.
      setSubstituted(substitutedCount)
      void queue.add(files, 'raw')
      return
    }
    setSubstituted(0)
    setPending({ files, heicCount, substitutedCount })
  }

  function choose(strategy: Strategy): void {
    const files = pending?.files ?? []
    setPending(null)
    void queue.add(files, strategy)
  }

  return (
    <>
      {pending ? (
        <DecisionModal
          heicCount={pending.heicCount}
          substitutedCount={pending.substitutedCount}
          onChoose={choose}
          onCancel={() => setPending(null)}
        />
      ) : null}

      <section className="band pipeline-head">
        <span className="eyebrow label">
          Pipeline
          <span className="slash">/</span>
          Direct to Drive
        </span>
        <h1 className="headline headline--sm">Transfers</h1>
        <p className="hero-meta mono">
          <span>Resumable, 8 MiB chunks</span>
          <span className="slash">/</span>
          <span>Drive / loom</span>
        </p>
      </section>

      {/* Drag target. The claim under it is literally true on this path: the browser PUTs
          chunks straight at Drive and the server is not in the route. */}
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
        <span className="tick tick--tl label">+0.0</span>
        <span className="tick tick--tr label">+1.0</span>
        <span className="tick tick--bl label">-0.0</span>
        <span className="tick tick--br label">-1.0</span>

        <p className="ingest-title">Drop photos here, or choose them</p>
        <p className="ingest-note">
          Your browser sends chunks straight to Drive · nothing passes through our servers
        </p>
        <div className="ingest-actions">
          <button className="btn btn--clay" onClick={() => picker.current?.click()}>
            Select files
          </button>
        </div>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length) void receive(files)
          }}
        />
      </div>

      {substituted > 0 ? (
        <p className="notice">
          {substituted} file{substituted === 1 ? '' : 's'} named .heic turned out to already be
          JPEG, so {substituted === 1 ? 'it needs' : 'they need'} no conversion —{' '}
          {substituted === 1 ? 'it was' : 'they were'} uploaded as-is.
        </p>
      ) : null}

      {unreadable > 0 ? (
        <p className="notice notice--alert">
          {unreadable} file{unreadable === 1 ? '' : 's'} could not be read —{' '}
          {unreadable === 1 ? 'it is' : 'they are'} probably still in iCloud. Open{' '}
          {unreadable === 1 ? 'it' : 'them'} in Photos to download first.
        </p>
      ) : null}

      {summary.total > 0 ? (
        <>
          <div className="telemetry">
            <span className="label">Queue</span>
            <span className="tdot" />
            <span className="mono">{summary.total} items</span>
            <span className="trule" />
            <span className="mono tstat">
              <span className="dot dot--active" />
              {summary.active} in flight
            </span>
            <span className="trule" />
            <span className="mono tstat tstat--verified">
              <span className="dot dot--verified" />
              {summary.done} verified
            </span>
            {summary.failed > 0 ? (
              <>
                <span className="trule" />
                <span className="mono tstat tstat--alert">
                  <span className="dot dot--alert" />
                  {summary.failed} failed
                </span>
              </>
            ) : null}
          </div>

          <ul className="log">
            <li className="log-head label">
              <span>Asset</span>
              <span>Status &amp; verification</span>
              <span>Controls</span>
            </li>
            {ids.map((id) => (
              <QueueRow key={id} queue={queue} id={id} />
            ))}
          </ul>
        </>
      ) : null}
    </>
  )
}
