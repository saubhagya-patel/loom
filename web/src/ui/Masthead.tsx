import { Link } from 'react-router'
import { Emblem } from './Emblem.tsx'

export type MastheadView = 'photos' | 'queue'

/**
 * Shared by the app and the standalone tools.
 *
 * The design shows a signed-in masthead on the tool page, which cannot be right: the tools
 * make no request and have no Drive connection, so a "scoped to Drive" chip and an account
 * would both be claims about something that is not happening. Signed out, it says what is
 * actually true instead.
 */
export function Masthead({
  account,
  view,
  onView,
  onSignOut,
}: {
  account?: { email: string } | undefined
  view?: MastheadView
  onView?: (v: MastheadView) => void
  onSignOut?: () => void
}) {
  return (
    <header className="masthead">
      <div className="masthead-in">
        <Link className="brand" to="/">
          <Emblem />
          <span className="wordmark">Loom</span>
        </Link>

        {account ? (
          <span className="scope-chip mono">
            <LockGlyph />
            Scoped to Drive/loom only — client direct stream
          </span>
        ) : (
          <span className="scope-chip mono">
            <LockGlyph />
            Runs in your browser — no account, no upload
          </span>
        )}

        <div className="masthead-end">
          {account && view && onView ? (
            <nav className="segmented">
              <button aria-current={view === 'queue'} onClick={() => onView('queue')}>
                Upload
              </button>
              <button aria-current={view === 'photos'} onClick={() => onView('photos')}>
                Drive Photos
              </button>
            </nav>
          ) : (
            <Link className="btn btn--sm" to="/">
              Open Loom
            </Link>
          )}

          {account ? (
            <>
              <span className="who mono">
                <span className="dot dot--verified" />
                {account.email}
              </span>
              {/* No avatar image: Loom requests `openid email`, not `profile`, so no picture
                  exists. A monogram is the honest version of the same shape. */}
              <button className="avatar" onClick={onSignOut} title="Sign out" aria-label="Sign out">
                {account.email.slice(0, 1).toUpperCase()}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </header>
  )
}

function LockGlyph() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden focusable="false">
      <rect x="2.5" y="5.5" width="7" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4.2 5.5V4.2a1.8 1.8 0 0 1 3.6 0v1.3" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}
