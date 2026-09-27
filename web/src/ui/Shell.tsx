import { useState } from 'react'
import type { Account } from '../auth/useSession.ts'
import { Emblem } from './Emblem.tsx'
import { Gallery } from './Gallery.tsx'
import { QueueScreen } from './QueueScreen.tsx'
import { ToolLinks } from './ToolLinks.tsx'

type View = 'photos' | 'queue'

export function Shell({ account, onSignOut }: { account: Account; onSignOut: () => void }) {
  const [view, setView] = useState<View>('photos')
  const [active, setActive] = useState(0)

  if (!account.appFolderId) {
    return (
      <main className="page">
        <p className="notice notice--alert">No Drive folder yet — sign out and back in to create one.</p>
      </main>
    )
  }

  return (
    <>
      <header className="masthead">
        <div className="masthead-in">
          <div className="brand">
            <Emblem />
            <span className="wordmark">LOOM</span>
            <span className="chip label">Drive direct</span>
          </div>

          <nav className="segmented">
            <button aria-current={view === 'photos'} onClick={() => setView('photos')}>
              Photos
            </button>
            <span className="segmented-rule" />
            <button aria-current={view === 'queue'} onClick={() => setView('queue')}>
              Uploads
              {active > 0 ? <span className="pill mono">{active} active</span> : null}
            </button>
          </nav>

          <div className="masthead-end">
            {/* True, and the single most reassuring fact about the product — so it is stated
                in the chrome rather than buried in a settings page. */}
            <span className="scope label">
              <span className="dot dot--verified" />
              Scoped to Drive/loom only
            </span>
            <span className="masthead-rule" />
            <span className="who mono">{account.email}</span>
            <button className="ghost label" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="page">
        {/* Remounted on open so it re-reads Drive: that is what picks up a finished upload and
            refreshes the short-lived thumbnail URLs. */}
        {view === 'photos' ? (
          <Gallery folderId={account.appFolderId} onAddPhotos={() => setView('queue')} />
        ) : null}

        {/* Never unmounted: switching tabs mid-upload must not destroy the engine. */}
        <div hidden={view !== 'queue'}>
          <QueueScreen folderId={account.appFolderId} onActiveCount={setActive} />
        </div>

        <ToolLinks />
      </main>
    </>
  )
}
