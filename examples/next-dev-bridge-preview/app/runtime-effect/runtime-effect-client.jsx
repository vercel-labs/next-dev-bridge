'use client'

import { useEffect, useState } from 'react'

export function RuntimeEffectClient() {
  const [effectRuns, setEffectRuns] = useState(0)
  const [manualErrors, setManualErrors] = useState(0)

  useEffect(() => {
    setEffectRuns((value) => value + 1)

    const timer = setTimeout(() => {
      throw new Error('Runtime effect thrown error: useEffect fired after HMR.')
    }, 250)

    return () => clearTimeout(timer)
  }, [])

  function throwManualRuntimeError() {
    const nextCount = manualErrors + 1
    setManualErrors(nextCount)

    setTimeout(() => {
      throw new Error(
        `Manual runtime effect error #${nextCount}: button-triggered runtime failure.`
      )
    }, 0)
  }

  return (
    <div className="panel">
      <span className="statusPill dangerPill">Runtime error armed</span>
      <h2>Throwing useEffect installed</h2>
      <p>
        This HMR update compiled successfully. The browser effect now throws a
        runtime error after hydration.
      </p>
      <button
        className="runtimeActionButton"
        onClick={throwManualRuntimeError}
        type="button"
      >
        Throw another runtime error ({manualErrors})
      </button>

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
