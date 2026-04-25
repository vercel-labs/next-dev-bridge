import Link from 'next/link'
import { RuntimeEffectClient } from './runtime-effect-client'

export default function RuntimeEffectPage() {
  return (
    <main className="shell">
      <div className="pageHeader">
        <section>
          <p className="eyebrow">Runtime effect test</p>
          <h1>Start clean, add a useEffect error, then remove it.</h1>
          <p className="lede">
            This page stays healthy first. The scenario script rewrites the
            client component so HMR builds successfully, then a browser
            <code>useEffect</code> throws and reports a runtime error.
          </p>
        </section>
        <Link className="backLink" href="/">
          Home
        </Link>
      </div>

      <section className="panelGrid">
        <RuntimeEffectClient />

        <aside className="panel">
          <h3>Runtime sequence</h3>
          <ol className="stepList">
            <li>
              Run <code>bun run scenario -- runtime-effect:error</code> to add
              the effect that logs <code>console.error</code> and throws.
            </li>
            <li>
              Run <code>bun run scenario -- runtime-effect:recover</code> to
              remove the throwing effect and report recovery.
            </li>
          </ol>
        </aside>
      </section>
    </main>
  )
}
