import { afterEach, describe, expect, it, vi } from 'vitest'

import { observeNextDev } from '../src/client'

describe('observeNextDev', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('emits build events from the Next HMR websocket', () => {
    const fakeWindow = createFakeWindow()
    const events: any[] = []
    const observer = observeNextDev((event, state) => {
      events.push({ event, state })
    })

    const socket = new fakeWindow.WebSocket('ws://localhost/_next/webpack-hmr')
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
  })

  it('emits source-mapped runtime errors', async () => {
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
