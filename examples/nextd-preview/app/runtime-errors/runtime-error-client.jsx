'use client'

import { useEffect, useState } from 'react'
import { runtimeMode, runtimeNote } from './runtime-mode'

export function RuntimeErrorClient() {
  const [refreshCount, setRefreshCount] = useState(0)

  useEffect(() => {
    setRefreshCount((value) => value + 1)
  }, [runtimeMode, runtimeNote])

  useEffect(() => {
    if (runtimeMode !== 'multi') {
      window.__NEXTD_EXAMPLE_RUNTIME_MARKER__ = null
      return
    }

    if (window.__NEXTD_EXAMPLE_RUNTIME_MARKER__ === runtimeNote) {
      return
    }

    window.__NEXTD_EXAMPLE_RUNTIME_MARKER__ = runtimeNote

    const timers = [
      setTimeout(() => {
        throw new Error(
          'Runtime example error 1: the activity panel failed after hydration.'
        )
      }, 250),
      setTimeout(() => {
        throw new Error(
          'Runtime example error 2: the notifications panel failed after hydration.'
        )
      }, 520),
    ]

    return () => {
      for (const timer of timers) {
        clearTimeout(timer)
      }
    }
  }, [runtimeMode, runtimeNote])

  if (runtimeMode === 'render') {
    throw new Error('Runtime example render error: the client component crashed.')
  }

  return (
    <div className="panel">
      <span
        className={
          runtimeMode === 'ok' ? 'statusPill' : 'statusPill dangerPill'
        }
      >
        Runtime mode: {runtimeMode}
      </span>
      <h2>Client runtime surface</h2>
      <p>{runtimeNote}</p>

      <div className="runtimeMeter">
        <div className="meterRow">
          <strong>Fast Refresh count</strong>
          <span>{refreshCount}</span>
        </div>
        <div className="meterRow">
          <strong>Runtime source</strong>
          <code>app/runtime-errors/runtime-mode.js</code>
        </div>
      </div>
    </div>
  )
}
