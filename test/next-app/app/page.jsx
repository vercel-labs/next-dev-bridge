import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Next.js dev websocket test fixture</p>
        <h1>Observe HMR build state while edits break and recover.</h1>
        <p className="lede">
          Open the test pages, run the observer, then apply the scripted edits
          to watch build errors, runtime errors, and successful recovery.
        </p>
      </section>

      <section className="grid">
        <Link className="card" href="/build-errors">
          <span className="kicker">Page 1</span>
          <h2>Build Errors</h2>
          <p>
            Imports a small module that the scenario scripts rewrite into syntax
            and export errors.
          </p>
        </Link>

        <Link className="card cardWarm" href="/runtime-effect">
          <span className="kicker">Page 2</span>
          <h2>Runtime Effect</h2>
          <p>
            Starts with a healthy effect, then HMR adds a browser runtime error
            and removes it again.
          </p>
        </Link>
      </section>
    </main>
  )
}
