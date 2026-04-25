import Link from 'next/link'
import { buildErrorMessage, describeBuildStatus } from './subject'

export default function BuildErrorsPage() {
  return (
    <main className="shell">
      <div className="pageHeader">
        <section>
          <p className="eyebrow">Build error test</p>
          <h1>Break compilation, then recover through HMR.</h1>
          <p className="lede">
            This route imports <code>app/build-errors/subject.js</code>. The
            scenario scripts rewrite that file to create build failures the HMR
            observer can see directly.
          </p>
        </section>
        <Link className="backLink" href="/">
          Home
        </Link>
      </div>

      <section className="panelGrid">
        <div className="panel">
          <span className="statusPill">Compiling</span>
          <h2>{buildErrorMessage}</h2>
          <p>{describeBuildStatus()}</p>
        </div>

        <aside className="panel">
          <h3>Try this sequence</h3>
          <ol className="stepList">
            <li>
              Run <code>bun run scenario -- build:syntax</code> to introduce a syntax
              error.
            </li>
            <li>
              Run <code>bun run scenario -- build:missing-export</code> to replace it
              with a missing export error.
            </li>
            <li>
              Run <code>bun run scenario -- build:recover</code> to restore the route.
            </li>
          </ol>
        </aside>
      </section>
    </main>
  )
}
