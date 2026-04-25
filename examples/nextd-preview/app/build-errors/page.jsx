import Link from 'next/link'
import { buildErrorMessage, describeBuildStatus } from './subject'

export default function BuildErrorsPage() {
  return (
    <main className="shell">
      <div className="pageHeader">
        <section>
          <p className="eyebrow">Build error preview</p>
          <h1>Break compilation, then recover through HMR.</h1>
          <p className="lede">
            This route imports <code>app/build-errors/subject.js</code>. The
            example editor rewrites that file to create build failures nextd
            can see directly.
          </p>
        </section>
        <Link className="backLink" href="/">
          Preview home
        </Link>
      </div>

      <section className="panelGrid">
        <div className="panel">
          <span className="statusPill">Compiling</span>
          <h2>{buildErrorMessage}</h2>
          <p>{describeBuildStatus()}</p>
        </div>

        <aside className="panel">
          <h3>Preview route</h3>
          <p>
            Keep this route loaded in the iframe while applying build scenarios
            from the editor.
          </p>
        </aside>
      </section>
    </main>
  )
}
