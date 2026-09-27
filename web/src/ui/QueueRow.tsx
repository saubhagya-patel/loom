import { memo, useState } from 'react'
import { CHUNK_BYTES } from '../upload/chunk.ts'
import type { Queue } from '../upload/queue.ts'
import { useQueueItem } from '../upload/useQueue.ts'
import { bytes, rate } from './format.ts'

const STATE_TEXT: Record<string, string> = {
  QUEUED: 'Queued for the pipe',
  CONVERTING: 'Converting in a web worker · libheif',
  INITIATING: 'Opening a resumable session with Drive',
  UPLOADING: 'Streaming chunks direct to Drive',
  PAUSED: 'Paused',
  VERIFYING: 'Asking Drive to confirm the stored size',
  DONE: 'Verified in Drive · size matched',
  FAILED: 'Failed',
  NEEDS_FILE: 'Needs the original file again',
}

function eta(remaining: number, perSecond: number): string {
  if (perSecond <= 0 || remaining <= 0) return '—'
  const s = Math.round(remaining / perSecond)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export const QueueRow = memo(function QueueRow({ queue, id }: { queue: Queue; id: string }) {
  const item = useQueueItem(queue, id)
  const [mismatch, setMismatch] = useState(false)
  if (!item) return null

  const pct = item.size > 0 ? Math.min(100, Math.round((item.uploadedBytes / item.size) * 100)) : 0
  const running = item.state === 'UPLOADING' || item.state === 'INITIATING' || item.state === 'CONVERTING'
  const chunks = Math.max(1, Math.ceil(item.size / CHUNK_BYTES))
  const chunk = Math.min(chunks, Math.floor(item.uploadedBytes / CHUNK_BYTES) + 1)
  const done = item.state === 'DONE'
  const failed = item.state === 'FAILED' || item.state === 'NEEDS_FILE'

  return (
    <li className={`pipe${done ? ' pipe--done' : ''}${failed ? ' pipe--failed' : ''}`}>
      <div className="pipe-head">
        <span className={`pipe-icon${done ? ' pipe-icon--done' : ''}`} aria-hidden>
          {done ? '✓' : running ? '↑' : '·'}
        </span>
        <span className="pipe-name mono" title={item.name}>
          {item.name}
        </span>
        <span className={`pipe-pct mono${done ? ' pipe-pct--done' : ''}`}>{done ? '100%' : `${pct}%`}</span>
      </div>

      <p className="pipe-state">{STATE_TEXT[item.state] ?? item.state}</p>

      <div className="pipe-rail" aria-hidden>
        <div className={`pipe-fill${done ? ' pipe-fill--done' : ''}`} style={{ width: `${done ? 100 : pct}%` }} />
      </div>

      {item.state === 'UPLOADING' ? (
        <div className="pipe-meta">
          <span className="pipe-metric">
            <span className="label">Chunk index</span>
            <span className="mono">
              {chunk} of {chunks} (8 MiB)
            </span>
          </span>
          <span className="pipe-metric">
            <span className="label">Velocity</span>
            <span className="mono">{rate(item.bytesPerSecond)}</span>
          </span>
          <span className="pipe-metric pipe-metric--end">
            <span className="label">Remaining</span>
            <span className="mono">{eta(item.size - item.uploadedBytes, item.bytesPerSecond)}</span>
          </span>
        </div>
      ) : null}

      {/* TRD §9's guardrail. Shown only once Drive has confirmed the stored size — never when
          the rail reaches the end. */}
      {item.verified ? (
        <div className="safe-band">
          <span className="safe-band-text mono">
            <CheckGlyph /> Safe to delete from your phone
          </span>
          <span className="safe-band-size mono">Size match: {item.size.toLocaleString()} B</span>
        </div>
      ) : null}

      {item.error ? <p className="pipe-error">{item.error}</p> : null}

      {item.state === 'NEEDS_FILE' ? (
        <div className="pipe-reselect">
          <p className="pipe-hint mono">
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
            <p className="pipe-error">That is a different file — its bytes would corrupt this upload.</p>
          ) : null}
        </div>
      ) : null}

      <div className="pipe-foot">
        <span className="pipe-bytes mono">
          {bytes(item.uploadedBytes)} / {bytes(item.size)}
        </span>
        <span className="pipe-actions">
          {running ? (
            <button className="btn btn--sm btn--ghost" onClick={() => queue.pause(id)}>
              Pause
            </button>
          ) : null}
          {item.state === 'PAUSED' ? (
            <button className="btn btn--sm btn--ghost" onClick={() => queue.resume(id)}>
              Resume
            </button>
          ) : null}
          {item.state === 'FAILED' ? (
            <button className="btn btn--sm btn--ghost" onClick={() => queue.resume(id)}>
              Retry
            </button>
          ) : null}
          {done ? null : (
            <button className="btn btn--sm btn--ghost" onClick={() => queue.cancel(id)}>
              Cancel
            </button>
          )}
        </span>
      </div>
    </li>
  )
})

function CheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden focusable="false">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.9 8.3l2.1 2.1 4.2-4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
