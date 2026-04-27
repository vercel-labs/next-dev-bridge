import Link from 'next/link'
import { RuntimeErrorClient } from './runtime-error-client'

export default function RuntimeErrorsPage() {
  return (
    <main className="shell">
      <div className="pageHeader">
        <section>
          <p className="eyebrow">Runtime error preview</p>
          <h1>Trigger multiple browser runtime errors.</h1>
          <p className="lede">
            This route renders a client component. The editor rewrites
            <code>app/runtime-errors/runtime-mode.js</code>, then Fast Refresh
            lets browser runtime errors fire while the overlay stays hidden.
          </p>
        </section>
        <Link className="backLink" href="/">
          Preview home
        </Link>
      </div>

      <section className="panelGrid">
        <RuntimeErrorClient />

        <aside className="panel">
          <h3>Runtime route</h3>
          <p>
            This page exists to show how runtime failures differ from compiler
            errors: HMR still reports a clean build.
          </p>
        </aside>
      </section>
    </main>
  )
}
