import { Link } from 'react-router'

export function NotFound() {
  return (
    <main className="page">
      <section className="band empty">
        <span className="label muted">404</span>
        <h1 className="headline headline--sm">There is nothing at this address.</h1>
        <Link className="btn" to="/">
          Go to Loom
        </Link>
      </section>
    </main>
  )
}
