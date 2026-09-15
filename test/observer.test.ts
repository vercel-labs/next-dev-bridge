import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({ sockets: [] as any[] }))

vi.mock('../src/websocket.js', () => ({
  DEFAULT_DEV_SERVER_URL: 'http://localhost:3000',
  HMR_PATHS: ['/_next/hmr', '/_next/webpack-hmr'],
  buildHmrUrl: ({ url = 'http://localhost:3000', hmrPath = '/_next/hmr' }) => {
    const base = new URL(url)
    return new URL(`ws://${base.host}${hmrPath}`)
  },
  connectWebSocket: () => {
    const socket = new EventEmitter() as EventEmitter & { close(): void }
    socket.close = vi.fn()
    mocked.sockets.push(socket)
    queueMicrotask(() => socket.emit('open'))
    return socket
  },
}))

import { connect } from '../src/observer'

describe('connect runtime HMR capability detection', () => {
  afterEach(() => {
    mocked.sockets.length = 0
  })

  it('keeps old build messages working and automatically emits new runtime messages', async () => {
    const events: any[] = []
    const connection = connect(
      'http://localhost:3000',
      { reconnect: false },
      (event) => events.push(event)
    )
    await Promise.resolve()
    const socket = mocked.sockets[0]

    socket.emit(
      'message',
      JSON.stringify({
        type: 'sync',
        hash: 'legacy-build',
        errors: [],
        warnings: [],
      })
    )
    socket.emit(
      'message',
      JSON.stringify({
        type: 'runtimeErrors',
        clientId: 'next-client',
        pathname: '/dashboard',
        errors: [
          {
            type: 'runtime',
            errorName: 'Error',
            message: 'render failed',
            fatal: true,
            boundary: { kind: 'default-global' },
            stack: [
              {
                file: 'app/dashboard/page.tsx',
                methodName: 'Page',
                line: 4,
                column: 9,
              },
            ],
          },
        ],
      })
    )

    expect(events.map((event) => event.type)).toEqual([
      'session:connecting',
      'session:connected',
      'build:ready',
      'runtime:error',
    ])
    expect(events.at(-1)).toMatchObject({
      error: {
        source: 'nextjs',
        message: 'render failed',
        isFatal: true,
        filename: 'app/dashboard/page.tsx',
      },
    })

    connection.stop()
  })
})
