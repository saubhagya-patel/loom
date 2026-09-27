import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Masthead } from '../ui/Masthead.tsx'
import { SiteFooter } from '../ui/SiteFooter.tsx'

/** Chrome shared by both tools. Touches no auth: signed-out is the expected visitor here. */
export function ToolShell({
  eyebrow,
  title,
  lede,
  other,
  children,
}: {
  eyebrow: string
  title: string
  lede: string
  other: { to: string; label: string }
  children: ReactNode
}) {
  return (
    <>
      <Masthead />

      {/* The whole proposition, stated once and checkable in the network tab in ten seconds. */}
      <div className="privacy-banner mono">
        <span className="privacy-banner-main">
          <CheckGlyph />
          Zero network requests. This tool runs entirely in your browser, via WebAssembly and
          OffscreenCanvas. Nothing about your file ever leaves this device.
        </span>
        <span className="privacy-banner-side">
          <span>
            <span className="dot dot--verified" /> No account
          </span>
          <span>
            <span className="dot dot--verified" /> No upload
          </span>
        </span>
      </div>

      <main className="page">
        <section className="tool-head">
          <div>
            <span className="eyebrow label">{eyebrow}</span>
            <h1 className="display display--sm">{title}</h1>
            <p className="lede">{lede}</p>
          </div>
          <div className="tool-head-actions">
            <Link className="btn" to={other.to}>
              {other.label}
            </Link>
            <Link className="btn" to="/">
              Open Drive uploader
            </Link>
          </div>
        </section>

        {children}
      </main>

      <SiteFooter />
    </>
  )
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden focusable="false">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.9 8.3l2.1 2.1 4.2-4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
