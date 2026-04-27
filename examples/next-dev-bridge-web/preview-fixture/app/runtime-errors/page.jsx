import Link from 'next/link'
import { RuntimeErrorClient } from './runtime-error-client'
import { RuntimeEffectClient } from './runtime-effect-client'

export default function RuntimeErrorsPage() {
  return (
    <main className="shell">
      <div className="pageHeader">
        <section>
          <p className="eyebrow">Runtime error preview</p>
          <h1>Trigger browser runtime errors.</h1>
          <p className="lede">
            This route renders client components. The editor rewrites
            <code>app/runtime-errors/runtime-mode.js</code> and
            <code>app/runtime-errors/runtime-effect-client.jsx</code>, then
            Fast Refresh lets browser runtime errors fire while the overlay
            stays hidden.
          </p>
        </section>
        <Link className="backLink" href="/">
          Preview home
        </Link>
      </div>

      <section className="panelGrid">
        <RuntimeErrorClient />
        <RuntimeEffectClient />

        <aside className="panel">
          <h3>Runtime route</h3>
          <p>
            This page covers render, scheduled, and useEffect runtime failures.
            HMR still reports a clean build for each case.
          </p>
        </aside>
      </section>
    </main>
  )
}
