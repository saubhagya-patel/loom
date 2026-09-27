import { useState } from 'react'
import type { Account } from '../auth/useSession.ts'
import { Gallery } from './Gallery.tsx'
import { QueueScreen } from './QueueScreen.tsx'

type View = 'photos' | 'queue'

export function Shell({ account, onSignOut }: { account: Account; onSignOut: () => void }) {
  const [view, setView] = useState<View>('photos')

  if (!account.appFolderId) {
    return (
      <main className="shell">
        <p className="error">No Drive folder yet — sign out and back in to create one.</p>
      </main>
    )
  }

  return (
    <main className="shell">
      <header className="top">
        <span className="wordmark">loom</span>
        <nav className="nav">
          <button aria-current={view === 'photos'} onClick={() => setView('photos')}>
            Photos
          </button>
          <button aria-current={view === 'queue'} onClick={() => setView('queue')}>
            Uploads
          </button>
        </nav>
        <button onClick={onSignOut}>Sign out</button>
      </header>

      {/* The gallery is mounted only while it is shown, so returning to it re-reads Drive —
          which is what picks up a just-finished upload, and what keeps the short-lived
          thumbnail URLs fresh. */}
      {view === 'photos' ? (
        <Gallery folderId={account.appFolderId} onAddPhotos={() => setView('queue')} />
      ) : null}

      {/* The queue is never unmounted. Switching tabs mid-upload must not destroy the engine
          or its in-flight chunks, so it is hidden rather than removed. */}
      <div hidden={view !== 'queue'}>
        <QueueScreen folderId={account.appFolderId} />
      </div>
    </main>
  )
}
