import { memo, useState } from 'react'
import type { Queue } from '../upload/queue.ts'
import { useQueueItem } from '../upload/useQueue.ts'

const LABEL: Record<string, string> = {
  QUEUED: 'waiting',
  INITIATING: 'starting',
  UPLOADING: 'uploading',
  PAUSED: 'paused',
  VERIFYING: 'verifying',
  DONE: 'done',
  FAILED: 'failed',
  NEEDS_FILE: 'needs the file again',
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// memo + a per-file subscription: a chunk landing on this file re-renders this row alone.
// content-visibility lets the browser skip layout and paint for rows scrolled out of view,
// which is what makes "hundreds of files" cost nothing.
export const QueueRow = memo(function QueueRow({ queue, id }: { queue: Queue; id: string }) {
  const item = useQueueItem(queue, id)
  const [mismatch, setMismatch] = useState(false)
  if (!item) return null

  const pct = item.size > 0 ? Math.min(100, Math.round((item.uploadedBytes / item.size) * 100)) : 0
  const active = item.state === 'UPLOADING' || item.state === 'INITIATING'

  return (
    <li className="row">
      <div className="row-head">
        <span className="row-name" title={item.name}>
          {item.name}
        </span>
        <span className={`row-state row-state--${item.state.toLowerCase()}`}>
          {LABEL[item.state] ?? item.state}
        </span>
      </div>

      <div className="bar" aria-hidden>
        <div className={`bar-fill${item.state === 'DONE' ? ' bar-fill--done' : ''}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="row-foot">
        <span className="muted">
          {mb(item.uploadedBytes)} of {mb(item.size)}
        </span>

        {active ? <button onClick={() => queue.pause(id)}>Pause</button> : null}
        {item.state === 'PAUSED' ? <button onClick={() => queue.resume(id)}>Resume</button> : null}
        {item.state === 'FAILED' ? <button onClick={() => queue.resume(id)}>Retry</button> : null}
        {item.state === 'DONE' ? null : <button onClick={() => queue.cancel(id)}>Remove</button>}
      </div>

      {item.state === 'NEEDS_FILE' ? (
        <div className="reselect">
          {/* A byte offset survives a reload; a File handle does not, and no storage changes
              that (docs/plan.md §2.5). The offset below is real, so this resume is nearly free. */}
          <p className="fine">
            Pick <strong>{item.name}</strong> again to resume from {mb(item.uploadedBytes)}.
          </p>
          <input
            type="file"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              void queue.provideFile(id, file).then((ok) => setMismatch(!ok))
            }}
          />
          {mismatch ? <p className="error">That is a different file — its bytes would corrupt this upload.</p> : null}
        </div>
      ) : null}

      {item.error ? <p className="error">{item.error}</p> : null}

      {/* TRD §9's deletion guardrail. Gated on `verified`, which is set only after Drive's own
          reported size matched — never on reaching DONE, and never on the progress bar. */}
      {item.verified ? <p className="safe">Safe to delete your local copy.</p> : null}
    </li>
  )
})
