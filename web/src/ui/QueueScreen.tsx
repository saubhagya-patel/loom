import { useEffect, useMemo, useRef, useState } from 'react'
import { refreshAccessToken, getAccessToken } from '../auth/token.ts'
import { checkHeic } from '../heic/detect.ts'
import type { Strategy } from '../heic/strategy.ts'
import { createQueue } from '../upload/queue.ts'
import { createTransport } from '../upload/transport.ts'
import { useQueueIds, useQueueSummary } from '../upload/useQueue.ts'
import { DecisionModal } from './DecisionModal.tsx'
import { QueueRow } from './QueueRow.tsx'

// Files waiting on the user's answer to the HEIC question.
type Pending = { files: File[]; heicCount: number; substitutedCount: number }

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
  const [pending, setPending] = useState<Pending | null>(null)
  const [unreadable, setUnreadable] = useState(0)
  const [substituted, setSubstituted] = useState(0)

  async function receive(files: File[]): Promise<void> {
    const checks = await Promise.all(files.map(checkHeic))

    // A photo still in iCloud yields a File with a plausible size that fails at read time, so
    // this is the first moment we can know (agent-cache/knowledge.md).
    setUnreadable(checks.filter((c) => c.unreadable).length)

    const substitutedCount = checks.filter((c) => c.substituted).length
    const heicCount = checks.filter((c) => c.isHeic).length

    if (heicCount === 0) {
      // Nothing to decide. 'raw' here means "upload exactly what was picked", which is what
      // every non-HEIC file wants anyway.
      //
      // Say so when files *claimed* to be HEIC and were not. Otherwise picking a .heic and
      // getting no modal reads as the feature being broken — and on iOS, where Safari can
      // substitute a whole batch at selection time, that silence would be the normal case.
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

  // Prunes week-dead session URIs, then restores anything interrupted as NEEDS_FILE.
  useEffect(() => {
    void queue.hydrate()
  }, [queue])

  return (
    <section className="queue">
      {pending ? (
        <DecisionModal
          heicCount={pending.heicCount}
          substitutedCount={pending.substitutedCount}
          onChoose={choose}
          onCancel={() => setPending(null)}
        />
      ) : null}

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
            if (files.length) void receive(files)
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

      {substituted > 0 ? (
        <p className="fine">
          {substituted} file{substituted === 1 ? '' : 's'} named .heic turned out to already be
          JPEG, so {substituted === 1 ? 'it needs' : 'they need'} no conversion —{' '}
          {substituted === 1 ? 'it was' : 'they were'} uploaded as-is.
        </p>
      ) : null}

      {unreadable > 0 ? (
        <p className="error">
          {unreadable} file{unreadable === 1 ? '' : 's'} could not be read — {unreadable === 1 ? 'it is' : 'they are'}{' '}
          probably still in iCloud. Open {unreadable === 1 ? 'it' : 'them'} in Photos to download
          first.
        </p>
      ) : null}

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
