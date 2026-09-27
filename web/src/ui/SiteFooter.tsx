import { Link } from 'react-router'

/** True of every route: the app streams to Drive directly, the tools make no request at all. */
export function SiteFooter() {
  return (
    <footer className="site-foot">
      <span className="mono">Direct browser to Google Drive · zero server retention</span>
      <nav className="site-foot-links mono">
        <Link to="/tools/heic-viewer">HEIC Viewer</Link>
        <Link to="/tools/heic-to-zip">HEIC to Zip</Link>
      </nav>
    </footer>
  )
}
