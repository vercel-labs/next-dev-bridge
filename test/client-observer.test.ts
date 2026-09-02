import { afterEach, describe, expect, it, vi } from 'vitest'

import { observeNextDev } from '../src/client'

describe('observeNextDev', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it.each(['/_next/webpack-hmr', '/_next/hmr'])(
    'emits build events from the Next HMR websocket at %s',
    (hmrPath) => {
      const fakeWindow = createFakeWindow()
      const events: any[] = []
      const observer = observeNextDev((event, state) => {
        events.push({ event, state })
      })

      const socket = new fakeWindow.WebSocket(`ws://localhost${hmrPath}`)
      socket.emit('message', {
        data: JSON.stringify({
          type: 'built',
          hash: 'error-hash',
          errors: [{ message: 'Line 1:2: Parsing error: Unexpected token' }],
          warnings: [],
        }),
      })

      expect(events).toHaveLength(1)
      expect(events[0].event).toMatchObject({
        type: 'build:error',
        hash: 'error-hash',
      })
      expect(events[0].state.build.hasErrors).toBe(true)
      expect(events[0].state.runtime.errors).toEqual([])

      observer.stop()
      expect(fakeWindow.WebSocket).toBe(fakeWindow.NativeWebSocket)
    }
  )

  it('emits source-mapped runtime errors', async () => {
    vi.useFakeTimers()
    const fakeWindow = createFakeWindow()
    const events: any[] = []
    const error = new Error('runtime exploded')
    error.stack = [
      'Error: runtime exploded',
      '    at RuntimeEffectClient.useEffect (http://localhost:3000/_next/static/chunks/app.js:14:7)',
    ].join('\n')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json([
          {
            status: 'fulfilled',
            value: {
              originalStackFrame: {
                file: 'app/runtime-effect/runtime-effect-client.jsx',
                line1: 14,
                column1: 7,
              },
              originalCodeFrame: '> 14 | throw new Error("runtime exploded")',
            },
          },
        ])
      )
    )

    observeNextDev((event, state) => events.push({ event, state }), {
      sourceMap: {},
    })

    fakeWindow.emit('error', {
      error,
      message: error.message,
      filename: 'http://localhost:3000/_next/static/chunks/app.js',
      lineno: 14,
      colno: 7,
    })
    await vi.advanceTimersByTimeAsync(1000)
    await waitFor(() => events.length === 1)

    expect(events[0].event).toMatchObject({
      type: 'runtime:error',
      error: {
        message: 'runtime exploded',
        mapped: {
          mappedFrames: [
            {
              status: 'fulfilled',
              value: {
                originalStackFrame: {
                  file: 'app/runtime-effect/runtime-effect-client.jsx',
                  line1: 14,
                },
              },
            },
          ],
        },
      },
    })
    expect(events[0].state.runtime.errors).toHaveLength(1)
  })

  it('emits fatal runtime errors from the Next HMR websocket', () => {
    const fakeWindow = createFakeWindow()
    const events: any[] = []
    observeNextDev((event, state) => events.push({ event, state }), {
      now: () => '2026-09-02T10:00:00.000Z',
    })
    const socket = new fakeWindow.WebSocket('ws://localhost/_next/hmr')

    socket.emit('message', {
      data: JSON.stringify({
        type: 'runtime-error-state',
        clientId: 'client-1',
        pathname: '/runtime-effect',
        errors: [
          {
            type: 'runtime',
            errorName: 'Error',
            message: 'root boundary exploded',
            fatal: true,
            stack: [
              {
                file: 'app/runtime-effect/page.tsx',
                methodName: 'Page',
                line: 8,
                column: 3,
              },
            ],
          },
        ],
      }),
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      event: {
        type: 'runtime:error',
        error: {
          source: 'nextjs',
          message: 'root boundary exploded',
          isFatal: true,
          severity: 'fatal',
        },
      },
      state: {
        runtime: {
          errors: [{ isFatal: true, severity: 'fatal' }],
        },
      },
    })
  })

  it('falls back to browser runtime errors without HMR runtime state', async () => {
    vi.useFakeTimers()
    const fakeWindow = createFakeWindow()
    const events: any[] = []
    observeNextDev((event, state) => events.push({ event, state }))
    const socket = new fakeWindow.WebSocket('ws://localhost/_next/hmr')

    socket.emit('message', {
      data: JSON.stringify({
        type: 'sync',
        hash: 'legacy-next',
        errors: [],
        warnings: [],
      }),
    })
    events.length = 0

    const error = new Error('legacy browser runtime error')
    fakeWindow.emit('error', { error, message: error.message })
    expect(events).toEqual([])

    await vi.advanceTimersByTimeAsync(1000)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      event: {
        type: 'runtime:error',
        error: {
          source: 'error',
          message: error.message,
          severity: 'recoverable',
        },
      },
      state: {
        runtime: {
          errors: [{ message: error.message, severity: 'recoverable' }],
        },
      },
    })
    expect(events[0].event.error.isFatal).toBeUndefined()
  })
})

function createFakeWindow() {
  const windowListeners = new Map<string, Set<(event: any) => void>>()

  class NativeWebSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3

    listeners = new Map<string, Set<(event: any) => void>>()
    url: string

    constructor(url: string | URL) {
      this.url = String(url)
    }

    addEventListener(type: string, listener: (event: any) => void) {
      const listeners = this.listeners.get(type) || new Set()
      listeners.add(listener)
      this.listeners.set(type, listeners)
    }

    emit(type: string, event: any) {
      for (const listener of this.listeners.get(type) || []) {
        listener(event)
      }
    }
  }

  const fakeWindow = {
    NativeWebSocket,
    WebSocket: NativeWebSocket as any,
    location: {
      href: 'http://localhost:3000/runtime-effect',
    },
    addEventListener(type: string, listener: (event: any) => void) {
      const listeners = windowListeners.get(type) || new Set()
      listeners.add(listener)
      windowListeners.set(type, listeners)
    },
    removeEventListener(type: string, listener: (event: any) => void) {
      windowListeners.get(type)?.delete(listener)
    },
    emit(type: string, event: any) {
      for (const listener of windowListeners.get(type) || []) {
        listener(event)
      }
    },
  }

  vi.stubGlobal('window', fakeWindow)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 204 }))
  )

  return fakeWindow
}

async function waitFor(condition: () => boolean) {
  for (let index = 0; index < 10; index += 1) {
    if (condition()) {
      return
    }
    await Promise.resolve()
  }
}
