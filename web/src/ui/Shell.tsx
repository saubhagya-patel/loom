import { useState } from 'react'
import type { Account } from '../auth/useSession.ts'
import { Gallery } from './Gallery.tsx'
import { Masthead, type MastheadView } from './Masthead.tsx'
import { QueueScreen } from './QueueScreen.tsx'
import { SiteFooter } from './SiteFooter.tsx'

export function Shell({ account, onSignOut }: { account: Account; onSignOut: () => void }) {
  const [view, setView] = useState<MastheadView>('photos')

  if (!account.appFolderId) {
    return (
      <>
        <Masthead account={account} onSignOut={onSignOut} />
        <main className="page">
          <p className="notice notice--alert">
            No Drive folder yet — sign out and back in to create one.
          </p>
        </main>
        <SiteFooter />
      </>
    )
  }

  return (
    <>
      <Masthead account={account} view={view} onView={setView} onSignOut={onSignOut} />

      {/* Remounted on open so it re-reads Drive: that is what picks up a finished upload and
          refreshes the short-lived thumbnail URLs. */}
      {view === 'photos' ? (
        <Gallery folderId={account.appFolderId} onAddPhotos={() => setView('queue')} />
      ) : null}

      {/* Never unmounted: switching tabs mid-upload must not destroy the engine. */}
      <div hidden={view !== 'queue'}>
        <QueueScreen folderId={account.appFolderId} />
      </div>

      <SiteFooter />
    </>
  )
}
