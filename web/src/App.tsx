import './App.css'
import { useSession } from './auth/useSession.ts'

// TRD §9's sign-in screen and the shell behind it. Phase 2 fills that shell with the upload
// queue; for now it proves the handshake — a folder id here means Drive has the folder.
export default function App() {
  const session = useSession()

  if (session.status === 'loading') {
    return (
      <main className="shell">
        <p className="muted">checking your session…</p>
      </main>
    )
  }

  if (session.status === 'signed-out') {
    return (
      <main className="shell">
        <h1>loom</h1>
        <p className="muted">
          Back up your photos straight to your own Google Drive. They go from this browser to
          your Drive without passing through our servers.
        </p>

        {__GOOGLE_CLIENT_ID__ ? (
          <button onClick={() => void session.signIn()}>Sign in with Google</button>
        ) : (
          <p className="error">
            No OAuth client id configured. Set <code>LOOM_GOOGLE_CLIENT_ID</code> in{' '}
            <code>backend/.env</code> and restart the dev server.
          </p>
        )}

        {session.error ? <p className="error">{session.error}</p> : null}

        <p className="fine">
          loom asks only for <code>drive.file</code> — it can see the files it creates, and
          nothing else in your Drive.
        </p>
      </main>
    )
  }

  return (
    <main className="shell">
      <h1>loom</h1>
      <p>
        Signed in as <strong>{session.account.email}</strong>
      </p>
      <p className="muted">
        {session.account.appFolderId
          ? 'Your “loom” folder is ready in Drive.'
          : 'No folder yet — sign in again to create one.'}
      </p>
      <button onClick={() => void session.signOut()}>Sign out</button>
    </main>
  )
}
