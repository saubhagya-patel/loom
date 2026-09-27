import { memo, useState } from 'react'
import { CHUNK_BYTES } from '../upload/chunk.ts'
import type { Queue } from '../upload/queue.ts'
import { useQueueItem } from '../upload/useQueue.ts'
import { bytes, kindOf, rate } from './format.ts'

const STATE_LABEL: Record<string, string> = {
  QUEUED: 'Queued',
  CONVERTING: 'Converting',
  INITIATING: 'Opening session',
  UPLOADING: 'Uploading',
  PAUSED: 'Paused',
  VERIFYING: 'Verifying',
  DONE: 'Verified',
  FAILED: 'Failed',
  NEEDS_FILE: 'Needs the file',
}

const TONE: Record<string, string> = {
  DONE: 'verified',
  FAILED: 'alert',
  NEEDS_FILE: 'alert',
  UPLOADING: 'active',
  CONVERTING: 'active',
  INITIATING: 'active',
  VERIFYING: 'active',
}

export const QueueRow = memo(function QueueRow({ queue, id }: { queue: Queue; id: string }) {
  const item = useQueueItem(queue, id)
  const [mismatch, setMismatch] = useState(false)

  if (!item) return null

  const pct = item.size > 0 ? Math.min(100, Math.round((item.uploadedBytes / item.size) * 100)) : 0
  const running = item.state === 'UPLOADING' || item.state === 'INITIATING' || item.state === 'CONVERTING'
  const chunks = Math.max(1, Math.ceil(item.size / CHUNK_BYTES))
  const chunk = Math.min(chunks, Math.floor(item.uploadedBytes / CHUNK_BYTES) + 1)
  const tone = TONE[item.state] ?? 'idle'

  return (
    <li className="log-row">
      <div className="log-asset">
        <span className="kind kind--inline label">{kindOf('', item.name)}</span>
        <span className="log-name mono" title={item.name}>
          {item.name}
        </span>
        <span className="log-size mono">{bytes(item.size)}</span>
      </div>

      <div className="log-status">
        <div className="log-state">
          <span className={`state label state--${tone}`}>
            {tone === 'verified' ? <span className="dot dot--verified" /> : null}
            {STATE_LABEL[item.state] ?? item.state}
          </span>
          {item.state === 'UPLOADING' ? (
            <span className="log-detail mono">
              Chunk {chunk} of {chunks} · 8 MiB each · {pct}%
            </span>
          ) : null}
          {item.state === 'DONE' ? (
            <span className="log-detail mono">Size confirmed by Drive</span>
          ) : null}
        </div>

        <div className="rail" aria-hidden>
          <div className={`rail-fill${item.state === 'DONE' ? ' rail-fill--done' : ''}`} style={{ width: `${pct}%` }} />
        </div>

        <div className="log-numbers mono">
          <span>
            {bytes(item.uploadedBytes)} / {bytes(item.size)}
          </span>
          {item.state === 'UPLOADING' ? <span>{rate(item.bytesPerSecond)}</span> : null}
        </div>

        {item.error ? <p className="notice notice--alert">{item.error}</p> : null}

        {item.state === 'NEEDS_FILE' ? (
          <div className="reselect">
            {/* A byte offset survives a reload; a File handle does not. The offset below is
                real, so re-picking the same file resumes rather than restarts. */}
            <p className="log-detail mono">
              Pick {item.name} again to resume from {bytes(item.uploadedBytes)}
            </p>
            <input
              type="file"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                void queue.provideFile(id, file).then((ok) => setMismatch(!ok))
              }}
            />
            {mismatch ? (
              <p className="notice notice--alert">
                That is a different file — its bytes would corrupt this upload.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* TRD §9: gated on Drive confirming the size, never on the rail reaching the end. */}
        {item.verified ? <p className="notice notice--verified">Safe to delete your local copy.</p> : null}
      </div>

      <div className="log-directives">
        {running ? (
          <button className="btn btn--sm" onClick={() => queue.pause(id)}>
            Pause
          </button>
        ) : null}
        {item.state === 'PAUSED' ? (
          <button className="btn btn--sm" onClick={() => queue.resume(id)}>
            Resume
          </button>
        ) : null}
        {item.state === 'FAILED' ? (
          <button className="btn btn--sm" onClick={() => queue.resume(id)}>
            Retry
          </button>
        ) : null}
        {item.state === 'DONE' ? null : (
          <button className="btn btn--sm btn--ghost" onClick={() => queue.cancel(id)}>
            Cancel
          </button>
        )}
      </div>
    </li>
  )
})
