import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createRuntimeErrorObserverScript,
  observeRuntimeErrors,
} from '../src/runtime'

describe('observeRuntimeErrors', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('captures window error events and source maps stack frames', async () => {
    const fakeWindow = createFakeWindow()
    const events: any[] = []
    const error = new Error('effect exploded')
    error.stack = [
      'Error: effect exploded',
      '    at RuntimeEffectClient.useEffect (http://localhost:3000/_next/static/chunks/app/runtime-effect.js:20:9)',
    ].join('\n')

    observeRuntimeErrors((event) => events.push(event), {
      now: () => '2026-04-27T10:00:00.000Z',
      sourceMap: {
        url: 'http://localhost:3000',
        fetch: async () =>
          Response.json([
            {
              status: 'fulfilled',
              value: {
                originalStackFrame: {
                  file: 'app/runtime-effect/runtime-effect-client.jsx',
                  methodName: 'RuntimeEffectClient.useEffect',
                  line1: 12,
                  column1: 7,
                },
                originalCodeFrame: '> 12 | throw new Error("effect exploded")',
              },
            },
          ]),
      },
    })

    fakeWindow.emit('error', {
      error,
      message: error.message,
      filename: 'http://localhost:3000/_next/static/chunks/app/runtime-effect.js',
      lineno: 20,
      colno: 9,
    })
    await waitFor(() => events.length === 1)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'runtime:error',
      error: {
        id: 1,
        source: 'error',
        name: 'Error',
        message: 'effect exploded',
        at: '2026-04-27T10:00:00.000Z',
        mapped: {
          mappedFrames: [
            {
              status: 'fulfilled',
              value: {
                originalStackFrame: {
                  file: 'app/runtime-effect/runtime-effect-client.jsx',
                  line1: 12,
                },
              },
            },
          ],
        },
      },
    })
  })

  it('captures unhandled promise rejections and dedupes repeated errors', async () => {
    const fakeWindow = createFakeWindow()
    const events: any[] = []

    observeRuntimeErrors((event) => events.push(event), {
      now: () => '2026-04-27T10:00:00.000Z',
    })

    const rejection = new Error('promise exploded')
    rejection.stack = 'Error: promise exploded\n    at demo (app.js:1:1)'
    fakeWindow.emit('unhandledrejection', {
      reason: rejection,
    })
    fakeWindow.emit('unhandledrejection', {
      reason: rejection,
    })
    await waitFor(() => events.length === 1)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'runtime:error',
      error: {
        id: 1,
        source: 'unhandledrejection',
        message: 'promise exploded',
      },
    })
  })

  it('can reset and stop listening', async () => {
    const fakeWindow = createFakeWindow()
    const events: any[] = []
    const observer = observeRuntimeErrors((event) => events.push(event))

    fakeWindow.emit('error', {
      message: 'script failed',
      filename: 'http://localhost:3000/app.js',
      lineno: 1,
      colno: 2,
    })
    await waitFor(() => events.length === 1)

    expect(observer.getSnapshot().errors).toHaveLength(1)
    expect(observer.reset()).toEqual({ errors: [] })
    expect(events.at(-1)).toEqual({ type: 'runtime:cleared', errors: [] })

    observer.stop()
    fakeWindow.emit('error', { message: 'ignored' })
    await flushAsyncHandlers()

    expect(observer.getSnapshot().errors).toHaveLength(0)
  })

  it('creates a self-contained runtime observer script', () => {
    const script = createRuntimeErrorObserverScript({
      targetOrigin: 'https://example.com',
      sourceMap: true,
    })

    expect(script).toContain('addEventListener')
    expect(script).toContain('WebSocket')
    expect(script).toContain('nexto:runtime')
    expect(script).toContain('nexto:runtime-reset')
    expect(script).toContain('https://example.com')
    expect(script).not.toContain('</script>')
  })
})

function createFakeWindow() {
  const listeners = new Map<string, Set<(event: any) => void>>()
  const fakeWindow = {
    addEventListener(type: string, listener: (event: any) => void) {
      const nextListeners = listeners.get(type) || new Set()
      nextListeners.add(listener)
      listeners.set(type, nextListeners)
    },
    removeEventListener(type: string, listener: (event: any) => void) {
      listeners.get(type)?.delete(listener)
    },
  }

  vi.stubGlobal('window', fakeWindow)

  return {
    emit(type: string, event: any) {
      for (const listener of listeners.get(type) || []) {
        listener(event)
      }
    },
  }
}

async function flushAsyncHandlers() {
  await Promise.resolve()
  await Promise.resolve()
}

async function waitFor(condition: () => boolean) {
  for (let index = 0; index < 10; index += 1) {
    if (condition()) {
      return
    }
    await flushAsyncHandlers()
  }
}
