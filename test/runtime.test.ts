import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createRuntimeErrorObserverScript,
  observeRuntimeErrors,
} from '../src/runtime'

describe('observeRuntimeErrors', () => {
  afterEach(() => {
    vi.useRealTimers()
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
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
        ])
      )
    )

    observeRuntimeErrors((event) => events.push(event), {
      now: () => '2026-04-27T10:00:00.000Z',
      sourceMap: {},
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
        severity: 'recoverable',
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
    expect(fetch).toHaveBeenCalledWith(
      new URL(
        '/__nextjs_original-stack-frames',
        'http://localhost:3000/runtime-effect'
      ),
      expect.objectContaining({
        method: 'POST',
      })
    )
  })

  it('does not source map runtime errors unless source mapping is configured', async () => {
    const fakeWindow = createFakeWindow()
    const events: any[] = []
    const fetchMock = vi.fn(async () => Response.json([]))
    vi.stubGlobal('fetch', fetchMock)
    const error = new Error('plain runtime error')
    error.stack =
      'Error: plain runtime error\n' +
      '    at Page (http://localhost:3000/_next/static/chunks/app/page.js:20:9)'

    observeRuntimeErrors((event) => events.push(event), {
      now: () => '2026-04-27T10:00:00.000Z',
    })

    fakeWindow.emit('error', {
      error,
      message: error.message,
      filename: 'http://localhost:3000/_next/static/chunks/app/page.js',
      lineno: 20,
      colno: 9,
    })
    await waitFor(() => events.length === 1)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(events[0].error.mapped).toBeUndefined()
  })

  it('passes configured source-map options to runtime stack mapping', async () => {
    const fakeWindow = createFakeWindow()
    const events: any[] = []
    const error = new Error('effect exploded')
    error.stack = [
      'Error: effect exploded',
      '    at RuntimeEffectClient.useEffect.timer (_0l5b1-n._.js:26:27)',
    ].join('\n')
    const requestBodies: any[] = []
    let requestInit: RequestInit | undefined

    observeRuntimeErrors((event) => events.push(event), {
      sourceMap: {
        endpoint: 'https://web.example.test/api/next-dev-bridge-stack-frames',
        fetch: async (_url, init) => {
          requestInit = init
          requestBodies.push(JSON.parse(String(init?.body)))

          return Response.json([])
        },
        frameRoot: '/repo/.next/dev/static',
      },
    })

    fakeWindow.emit('error', {
      error,
      message: error.message,
      filename: 'http://localhost:3000/_next/static/chunks/_0l5b1-n._.js',
      lineno: 26,
      colno: 27,
    })
    await waitFor(() => events.length === 1)

    expect(requestBodies[0]).toMatchObject({
      sourceOrigin: 'http://localhost:3000',
    })
    expect(requestBodies[0].frames[0].file).toBe(
      '/repo/.next/dev/static/chunks/_0l5b1-n._.js'
    )
    expect(requestInit?.headers).toBeUndefined()
  })

  it('captures repeated unhandled promise rejections', async () => {
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
    await waitFor(() => events.length === 2)

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'runtime:error',
      error: {
        id: 1,
        source: 'unhandledrejection',
        severity: 'recoverable',
        message: 'promise exploded',
      },
    })
    expect(events[1]).toMatchObject({
      type: 'runtime:error',
      error: {
        id: 2,
        source: 'unhandledrejection',
        severity: 'recoverable',
        message: 'promise exploded',
      },
    })
  })

  it('captures errors dispatched by window.reportError', async () => {
    const fakeWindow = createFakeWindow()
    const events: any[] = []
    const originalReportError = vi.fn((error: unknown) => {
      fakeWindow.emit('error', {
        error,
        message: error instanceof Error ? error.message : String(error),
      })
    })
    ;(window as any).reportError = originalReportError

    observeRuntimeErrors((event) => events.push(event), {
      now: () => '2026-04-27T10:00:00.000Z',
    })

    const error = new Error('boundary exploded')
    error.stack = 'Error: boundary exploded\n    at Page (app/page.js:2:1)'
    ;(window as any).reportError(error)
    await waitFor(() => events.length === 1)

    expect(originalReportError).toHaveBeenCalledWith(error)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'runtime:error',
      error: {
        id: 1,
        source: 'error',
        severity: 'recoverable',
        name: 'Error',
        message: 'boundary exploded',
        stack: error.stack,
        at: '2026-04-27T10:00:00.000Z',
      },
    })

  })

  it('keeps repeated reportError calls as separate errors', async () => {
    const fakeWindow = createFakeWindow()
    const events: any[] = []
    const originalReportError = vi.fn((error: unknown) => {
      fakeWindow.emit('error', {
        error,
        message: error instanceof Error ? error.message : String(error),
      })
    })
    ;(window as any).reportError = originalReportError

    observeRuntimeErrors((event) => events.push(event), {
      now: () => '2026-04-27T10:00:00.000Z',
    })

    const error = new Error('boundary exploded')
    error.stack = 'Error: boundary exploded\n    at Page (app/page.js:2:1)'

    ;(window as any).reportError(error)
    ;(window as any).reportError(error)
    await waitFor(() => events.length === 2)

    expect(originalReportError).toHaveBeenCalledTimes(2)
    expect(events).toHaveLength(2)
    expect(events.map((event) => event.error.source)).toEqual(['error', 'error'])
    expect(events.map((event) => event.error.id)).toEqual([1, 2])
  })

  it.each([
    { fatal: true, severity: 'fatal' },
    { fatal: false, severity: 'recoverable' },
  ] as const)(
    'uses Next HMR runtime state fatality ($fatal)',
    async ({ fatal, severity }) => {
      vi.useFakeTimers()
      const fakeWindow = createFakeWindow()
      const events: any[] = []
      const observer = observeRuntimeErrors((event) => events.push(event), {
        now: () => '2026-09-02T10:00:00.000Z',
        preferHMR: true,
      })

      const browserError = new Error('boundary exploded')
      fakeWindow.emit('error', {
        error: browserError,
        message: browserError.message,
      })
      expect(events).toEqual([])

      expect(
        observer.handleHMRMessage(
          createHmrRuntimeState({
            fatal,
            message: browserError.message,
          })
        )
      ).toBe(true)

      expect(events).toHaveLength(1)
      expect(events[0].error).toMatchObject({
        source: 'nextjs',
        message: browserError.message,
        isFatal: fatal,
        severity,
        filename: 'app/page.tsx',
        line: 12,
        column: 5,
      })

      await vi.advanceTimersByTimeAsync(1000)
      expect(events).toHaveLength(1)
    }
  )

  it('clears HMR runtime state and ignores state for another pathname', () => {
    createFakeWindow()
    const events: any[] = []
    const observer = observeRuntimeErrors((event) => events.push(event), {
      preferHMR: true,
    })

    expect(
      observer.handleHMRMessage(
        createHmrRuntimeState({ fatal: false, message: 'other route' }, '/other')
      )
    ).toBe(true)
    expect(events).toEqual([])

    observer.handleHMRMessage(
      createHmrRuntimeState({ fatal: false, message: 'current route' })
    )
    observer.handleHMRMessage(createHmrRuntimeState())

    expect(events.map((event) => event.type)).toEqual([
      'runtime:error',
      'runtime:cleared',
    ])
    expect(observer.getSnapshot()).toEqual({ errors: [] })
    expect(observer.handleHMRMessage('{invalid')).toBe(false)
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
      sourceMapEndpoint: 'https://example.com/api/stack-frames',
      sourceMapFrameRoot: '/repo/.next/dev/static',
      targetOrigin: 'https://example.com',
    })

    expect(script).toContain('addEventListener')
    expect(script).not.toContain('reportError')
    expect(script).not.toContain('reported-error')
    expect(script).not.toContain('WebSocket')
    expect(script).toContain('next-dev-bridge:runtime')
    expect(script).toContain('next-dev-bridge:runtime-reset')
    expect(script).toContain('https://example.com')
    expect(script).toContain('https://example.com/api/stack-frames')
    expect(script).toContain('/repo/.next/dev/static')
    expect(script).not.toContain('</script>')
  })

  it('does not source map from the self-contained script without an endpoint', () => {
    const script = createRuntimeErrorObserverScript()

    expect(script).not.toContain('/__nextjs_original-stack-frames')
  })
})

function createFakeWindow() {
  const listeners = new Map<string, Set<(event: any) => void>>()
  const fakeWindow = {
    location: {
      href: 'http://localhost:3000/runtime-effect',
      origin: 'http://localhost:3000',
    },
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
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 204 }))
  )

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

function createHmrRuntimeState(
  error?: { fatal: boolean; message: string },
  pathname = '/runtime-effect'
) {
  return JSON.stringify({
    type: 'runtime-error-state',
    clientId: 'client-1',
    pathname,
    errors: error
      ? [
          {
            type: 'runtime',
            errorName: 'Error',
            message: error.message,
            fatal: error.fatal,
            stack: [
              {
                file: 'app/page.tsx',
                methodName: 'Page',
                line: 12,
                column: 5,
              },
            ],
          },
        ]
      : [],
  })
}
