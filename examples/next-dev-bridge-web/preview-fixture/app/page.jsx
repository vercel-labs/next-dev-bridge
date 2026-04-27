import Link from 'next/link'

export default function PreviewHomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Separate Next preview app</p>
        <h1>This app is intentionally edited and broken.</h1>
        <p className="lede">
          The web viewer runs in another Next process. This preview app is the
          mutable target: build failures and runtime failures happen here while
          the viewer stays alive.
        </p>
      </section>

      <section className="grid">
        <Link className="card" href="/build-errors">
          <span className="kicker">Preview route</span>
          <h2>Build Errors</h2>
          <p>Rewrites a small module into syntax and export errors.</p>
        </Link>

        <Link className="card cardWarm" href="/runtime-effect">
          <span className="kicker">Preview route</span>
          <h2>Runtime Effect</h2>
          <p>Starts clean, then a useEffect throws a runtime error.</p>
        </Link>

        <Link className="card cardWide" href="/runtime-errors">
          <span className="kicker">Preview route</span>
          <h2>Runtime Errors</h2>
          <p>Schedules multiple uncaught client runtime errors.</p>
        </Link>
      </section>
    </main>
  )
}
