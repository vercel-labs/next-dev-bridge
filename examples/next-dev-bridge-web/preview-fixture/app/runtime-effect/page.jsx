import Link from 'next/link'
import { RuntimeEffectClient } from './runtime-effect-client'

export default function RuntimeEffectPage() {
  return (
    <main className="shell">
      <div className="pageHeader">
        <section>
          <p className="eyebrow">Runtime effect preview</p>
          <h1>Start clean, add a useEffect error, then remove it.</h1>
          <p className="lede">
            This page stays healthy first. The editor rewrites the client
            component so HMR builds successfully, then a browser
            <code>useEffect</code> throws and reports a runtime error.
          </p>
        </section>
        <Link className="backLink" href="/">
          Preview home
        </Link>
      </div>

      <section className="panelGrid">
        <RuntimeEffectClient />

        <aside className="panel">
          <h3>Runtime sequence</h3>
          <p>
            The iframe hides the Next dev overlay so the error panel below the
            preview can show the observer output instead.
          </p>
        </aside>
      </section>
    </main>
  )
}
