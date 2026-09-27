import './App.css'
import { Link } from 'react-router'
import { useSession } from './auth/useSession.ts'
import { Emblem } from './ui/Emblem.tsx'
import { Shell } from './ui/Shell.tsx'
import { SiteFooter } from './ui/SiteFooter.tsx'

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

  return (
    <>
      <main className="page landing">
        <div className="landing-brand">
          <Emblem size={44} />
          <span className="wordmark wordmark--lg">Loom</span>
        </div>

        <span className="eyebrow label">
          <span className="dot dot--verified" />
          Direct browser to Google Drive
        </span>

        <h1 className="display">Move photos off a full phone, into Drive you already own.</h1>

        <p className="lede">
          Photos go straight from this browser to your own Google Drive. They are never uploaded
          to us, because there is nothing of ours in the way.
        </p>

        <ul className="assurances">
          <li>
            <span className="dot dot--verified" />
            Files travel from this browser to your Drive, and nowhere else.
          </li>
          <li>
            <span className="dot dot--verified" />
            Loom sees only the files it put there — nothing else in your Drive.
          </li>
          <li>
            <span className="dot dot--verified" />
            No filename, size or thumbnail is ever stored or logged on our side.
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

        <p className="landing-scope mono">Scope requested: drive.file · openid · email</p>

        {/* The tools are the only part of Loom that works for someone who will never sign in,
            and they demonstrate the privacy claim rather than asserting it. */}
        <section className="landing-tools">
          <p className="landing-tools-lead">
            Only need to open one HEIC, or convert a handful? No account required.
          </p>
          <div className="landing-tools-links">
            <Link className="btn" to="/tools/heic-viewer">
              HEIC viewer
            </Link>
            <Link className="btn" to="/tools/heic-to-zip">
              HEIC to ZIP
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
