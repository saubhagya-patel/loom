import { Link } from 'react-router'

/**
 * The way into the standalone tools, from both sides of the sign-in line.
 *
 * `docs/trd-utilities.md` calls these the honest front door: they are the only part of Loom
 * that works for someone who will never sign in, and they demonstrate the privacy claim
 * instead of asserting it. A signed-out visitor who is not ready for an account should still
 * leave having got something, so on the landing page this is a real offer rather than a
 * footnote.
 */
export function ToolLinks({ tone = 'quiet' }: { tone?: 'quiet' | 'offer' }) {
  if (tone === 'offer') {
    return (
      <div className="tool-offer">
        <p className="tool-offer-lead">
          Just need to open one HEIC, or convert a handful? No account needed.
        </p>
        <div className="tool-offer-links">
          <Link className="btn" to="/tools/heic-viewer">
            View a HEIC
          </Link>
          <Link className="btn" to="/tools/heic-to-zip">
            Convert a batch to ZIP
          </Link>
        </div>
      </div>
    )
  }

  return (
    <p className="tool-links label">
      <span className="muted">Free tools</span>
      <Link to="/tools/heic-viewer">HEIC viewer</Link>
      <span className="slash">/</span>
      <Link to="/tools/heic-to-zip">HEIC to ZIP</Link>
    </p>
  )
}
