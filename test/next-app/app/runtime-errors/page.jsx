import Link from 'next/link'
import { RuntimeErrorClient } from './runtime-error-client'

export default function RuntimeErrorsPage() {
  return (
    <main className="shell">
      <div className="pageHeader">
        <section>
          <p className="eyebrow">Runtime error test</p>
          <h1>Trigger multiple browser runtime errors.</h1>
          <p className="lede">
            This route renders a client component. The scenario scripts rewrite
            <code>app/runtime-errors/runtime-mode.js</code>, then Fast Refresh
            lets the browser overlay show runtime errors and recover.
          </p>
        </section>
        <Link className="backLink" href="/">
          Home
        </Link>
      </div>

      <section className="panelGrid">
        <RuntimeErrorClient />

        <aside className="panel">
          <h3>Try this sequence</h3>
          <ol className="stepList">
            <li>
              Keep this page open in a browser tab so client runtime errors can
              execute.
            </li>
            <li>
              Run <code>bun run scenario -- runtime:multi</code> to schedule two
              uncaught runtime errors.
            </li>
            <li>
              Run <code>bun run scenario -- runtime:recover</code> to return the
              component to a healthy state.
            </li>
          </ol>
        </aside>
      </section>
    </main>
  )
}
