import { useEffect, useMemo, useRef } from 'react'
import { refreshAccessToken, getAccessToken } from '../auth/token.ts'
import { createQueue } from '../upload/queue.ts'
import { createTransport } from '../upload/transport.ts'
import { useQueueIds, useQueueSummary } from '../upload/useQueue.ts'
import { QueueRow } from './QueueRow.tsx'

export function QueueScreen({ folderId }: { folderId: string }) {
  // One queue for the life of the screen. The engine owns its state; React only watches.
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

  // Prunes week-dead session URIs, then restores anything interrupted as NEEDS_FILE.
  useEffect(() => {
    void queue.hydrate()
  }, [queue])

  return (
    <section className="queue">
      <div className="queue-head">
        <button
          onClick={() => picker.current?.click()}
          className="primary"
        >
          Choose photos
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = '' // so re-picking the same file fires change again
            if (files.length) void queue.add(files)
          }}
        />

        {summary.total > 0 ? (
          <span className="muted">
            {summary.done} of {summary.total} done
            {summary.active > 0 ? ` · ${summary.active} in progress` : ''}
            {summary.failed > 0 ? ` · ${summary.failed} failed` : ''}
            {summary.needsFile > 0 ? ` · ${summary.needsFile} need re-selecting` : ''}
          </span>
        ) : null}
      </div>

      {ids.length === 0 ? (
        <p className="muted">
          Nothing queued. Files go straight from this browser to your Drive — they never pass
          through a server.
        </p>
      ) : (
        <ul className="rows">
          {ids.map((id) => (
            <QueueRow key={id} queue={queue} id={id} />
          ))}
        </ul>
      )}
    </section>
  )
}
