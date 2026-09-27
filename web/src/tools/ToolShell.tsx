import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Emblem } from '../ui/Emblem.tsx'

/**
 * Chrome shared by both tools. Deliberately touches no auth: a signed-out visitor is the
 * expected visitor here, not an error state.
 */
export function ToolShell({
  title,
  lede,
  other,
  children,
}: {
  title: string
  lede: string
  other: { to: string; label: string }
  children: ReactNode
}) {
  return (
    <>
      <header className="masthead">
        <div className="masthead-in">
          <Link className="brand brand--link" to="/">
            <Emblem />
            <span className="wordmark">LOOM</span>
          </Link>
          <span className="chip label">Free tool</span>
          <div className="masthead-end">
            <Link className="ghost label" to={other.to}>
              {other.label}
            </Link>
          </div>
        </div>
      </header>

      <main className="page">
        <section className="band tool-head">
          <h1 className="headline headline--sm">{title}</h1>
          <p className="lede">{lede}</p>
          {/* The whole proposition, stated once and verifiable in the network tab. */}
          <p className="tool-privacy label">
            <span className="dot dot--verified" />
            Runs entirely in your browser · nothing is uploaded
          </p>
        </section>

        {children}

        <p className="stream-note mono">
          Need this for a whole camera roll? <Link to="/">Loom backs photos up to your own
          Google Drive</Link>.
        </p>
      </main>
    </>
  )
}
