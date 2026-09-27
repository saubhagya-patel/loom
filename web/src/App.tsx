import './App.css'
import { useSession } from './auth/useSession.ts'
import { Shell } from './ui/Shell.tsx'

export default function App() {
  const session = useSession()

  if (session.status === 'loading') {
    return (
      <main className="shell">
        <p className="hero-note">Checking your session…</p>
      </main>
    )
  }

  if (session.status === 'signed-in') {
    return <Shell account={session.account} onSignOut={() => void session.signOut()} />
  }

  // TRD §9.1: the value proposition, the privacy assurances, and one way in. The assurances
  // are the reason anyone would hand a backup tool their Drive, so they are stated as plain
  // facts about what the app does rather than as badges.
  return (
    <main className="shell">
      <div className="landing">
        <h1 className="wordmark">loom</h1>
        <p className="pitch">Move photos off a full phone and into Drive you already own.</p>

        <ul className="assurances">
          <li>Photos go straight from this browser to your Drive.</li>
          <li>loom can only see the files it put there — nothing else in your Drive.</li>
          <li>Nothing about your photos is stored or logged on our side.</li>
        </ul>

        {__GOOGLE_CLIENT_ID__ ? (
          <button className="primary" onClick={() => void session.signIn()}>
            Continue with Google
          </button>
        ) : (
          <p className="error">
            No OAuth client id configured. Set <code>LOOM_GOOGLE_CLIENT_ID</code> in{' '}
            <code>backend/.env</code> and restart the dev server.
          </p>
        )}

        {session.error ? <p className="error">{session.error}</p> : null}
      </div>
    </main>
  )
}
