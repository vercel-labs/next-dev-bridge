import { describe, expect, it } from 'vitest'

import { processHMR } from '../src/index'

describe('processHMR', () => {
  it('is a callable iframe-friendly tracker', () => {
    const handleHMR = processHMR({
      now: () => '2026-04-25T00:00:00.000Z',
    })
    const seen: Array<{ type: string; phase: string }> = []

    const result = handleHMR(
      JSON.stringify({ type: 'building' }),
      (event, state) => {
        seen.push({ type: event.type, phase: state.phase })
      }
    )

    expect(typeof handleHMR).toBe('function')
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({
      type: 'build:compiling',
      buildId: 1,
    })
    expect(result.state.phase).toBe('compiling')
    expect(handleHMR.getSnapshot().phase).toBe('compiling')
    expect(seen).toEqual([{ type: 'build:compiling', phase: 'compiling' }])
  })

  it('reports build errors and recovery', () => {
    const handleHMR = processHMR()

    const errorResult = handleHMR(
      JSON.stringify({
        type: 'built',
        hash: 'error-hash',
        errors: [
          {
            moduleName: './app/page.jsx',
            message: 'Line 1:2: Parsing error: Unexpected token',
          },
        ],
        warnings: [],
      })
    )

    expect(errorResult.events).toHaveLength(1)
    expect(errorResult.events[0]).toMatchObject({
      type: 'build:error',
      change: 'shown',
      hash: 'error-hash',
    })
    expect(errorResult.state.hasErrors).toBe(true)

    if (errorResult.events[0].type !== 'build:error') {
      throw new Error('Expected build:error event')
    }
    expect(errorResult.events[0].errors[0]).toMatch(/Syntax error:/)

    const recoveryResult = handleHMR(
      JSON.stringify({
        type: 'built',
        hash: 'recovered-hash',
        errors: [],
        warnings: [],
      })
    )

    expect(recoveryResult.events).toHaveLength(1)
    expect(recoveryResult.events[0]).toMatchObject({
      type: 'build:recovered',
    })
    expect(recoveryResult.state).toMatchObject({
      hasErrors: false,
      phase: 'ok',
      hash: 'recovered-hash',
    })
  })

  it('returns build:ready for a clean initial sync', () => {
    const handleHMR = processHMR()
    const result = handleHMR({
      type: 'sync',
      hash: 'initial-hash',
      errors: [],
      warnings: [],
    })

    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({
      type: 'build:ready',
      trigger: 'sync',
    })
    expect(result.state).toMatchObject({
      phase: 'ok',
      hash: 'initial-hash',
    })
  })

  it('reports invalid messages without throwing', () => {
    const handleHMR = processHMR()
    const result = handleHMR('not json')

    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({
      type: 'observer:error',
      reason: 'invalid-hmr-message',
    })
    expect(result.state.phase).toBe('idle')
  })

  it('reset clears tracked build state', () => {
    const handleHMR = processHMR()
    handleHMR({
      type: 'built',
      hash: 'error-hash',
      errors: [{ message: 'Line 1:2: Parsing error: Unexpected token' }],
      warnings: [],
    })

    const state = handleHMR.reset()

    expect(state).toMatchObject({
      phase: 'idle',
      hasErrors: false,
      hash: null,
    })
    expect(handleHMR.getSnapshot().phase).toBe('idle')
  })
})
