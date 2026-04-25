'use client'

import { useEffect, useState } from 'react'
import { reportRuntimeEvent } from './runtime-reporter'

export function RuntimeEffectClient() {
  const [effectRuns, setEffectRuns] = useState(0)

  useEffect(() => {
    setEffectRuns((value) => value + 1)
    reportRuntimeEvent(
      'clear',
      'Runtime effect page mounted with no runtime error.'
    )
  }, [])

  return (
    <div className="panel">
      <span className="statusPill">Runtime clean</span>
      <h2>No runtime error</h2>
      <p>
        This component currently has a healthy effect. HMR should report build
        success for this page before any runtime error is introduced.
      </p>

      <div className="runtimeMeter">
        <div className="meterRow">
          <strong>Effect runs</strong>
          <span>{effectRuns}</span>
        </div>
        <div className="meterRow">
          <strong>Runtime source</strong>
          <code>app/runtime-effect/runtime-effect-client.jsx</code>
        </div>
      </div>
    </div>
  )
}
