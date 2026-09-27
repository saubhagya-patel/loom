import './App.css'
import { useSession } from './auth/useSession.ts'
import { Emblem } from './ui/Emblem.tsx'
import { Shell } from './ui/Shell.tsx'
import { ToolLinks } from './ui/ToolLinks.tsx'

export default function App() {
  const session = useSession()

  if (session.status === 'loading') {
    return (
      <main className="page">
        <p className="band mono muted">Checking your session…</p>
      </main>
    )
  }

  if (session.status === 'signed-in') {
    return <Shell account={session.account} onSignOut={() => void session.signOut()} />
  }

  // TRD §9.1. The assurances are the reason anyone would hand a backup tool their Drive, so
  // they are stated as plain facts about behaviour rather than dressed as badges.
  return (
    <main className="page">
      <div className="landing">
        <div className="brand brand--lg">
          <Emblem size={40} />
          <span className="wordmark wordmark--lg">LOOM</span>
          <span className="chip label">Drive direct</span>
        </div>

        <h1 className="headline">Move photos off a full phone, into Drive you already own.</h1>

        <ul className="assurances">
          <li>
            <span className="dot dot--verified" />
            Photos travel from this browser straight to your Drive.
          </li>
          <li>
            <span className="dot dot--verified" />
            loom sees only the files it put there — nothing else in your Drive.
          </li>
          <li>
            <span className="dot dot--verified" />
            Nothing about your photos is stored or logged on our side.
          </li>
        </ul>

        {__GOOGLE_CLIENT_ID__ ? (
          <button className="btn btn--clay btn--lg" onClick={() => void session.signIn()}>
            Continue with Google
          </button>
        ) : (
          <p className="notice notice--alert">
            No OAuth client id configured. Set <span className="mono">LOOM_GOOGLE_CLIENT_ID</span> in{' '}
            <span className="mono">backend/.env</span> and restart the dev server.
          </p>
        )}

        {session.error ? <p className="notice notice--alert">{session.error}</p> : null}

        <p className="stream-note mono">Scope requested: drive.file · openid · email</p>

        <ToolLinks tone="offer" />
      </div>
    </main>
  )
}
