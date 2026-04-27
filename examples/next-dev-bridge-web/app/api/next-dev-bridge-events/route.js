import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  createSessionCookie,
  getPreviewSession,
  getPublicSession,
} from '../_lib/control.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

const SANDBOX_PORT = Number(process.env.NEXT_DEV_BRIDGE_SANDBOX_PORT || 3000)
const SANDBOX_ROOT =
  process.env.NEXT_DEV_BRIDGE_SANDBOX_ROOT || '/vercel/sandbox'
const SANDBOX_PREVIEW_ROOT =
  process.env.NEXT_DEV_BRIDGE_SANDBOX_PREVIEW_ROOT ||
  `${SANDBOX_ROOT}/preview`

export async function GET(request) {
  let session

  try {
    session = await getPreviewSession(request)
  } catch (error) {
    return Response.json(
      {
        error: error.message || String(error),
      },
      {
        status: 500,
      }
    )
  }

  const url = new URL(request.url)
  const target = url.searchParams.get('target') || session.targetUrl
  const encoder = new TextEncoder()
  let heartbeat = null
  let cleanup = () => {}
  let closed = false

  const stream = new ReadableStream({
    start(controller) {
      const send = (name, payload) => {
        if (closed) {
          return
        }

        controller.enqueue(
          encoder.encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`)
        )
      }

      send('ready', {
        preview: getPublicSession(session),
        target,
      })

      if (session.mode === 'sandbox') {
        cleanup = startSandboxObserverStream(session, send)
      } else {
        cleanup = startLocalObserverStream(target, send)
      }

      heartbeat = setInterval(() => {
        send('ping', { at: new Date().toISOString() })
      }, 15000)
    },
    cancel() {
      closed = true
      clearInterval(heartbeat)
      cleanup()
    },
  })

  const headers = {
    'cache-control': 'no-cache, no-transform',
    'content-type': 'text/event-stream; charset=utf-8',
    'x-accel-buffering': 'no',
  }
  const cookie = createSessionCookie(session)

  if (cookie) {
    headers['set-cookie'] = cookie
  }

  return new Response(stream, {
    headers,
  })
}

function startLocalObserverStream(target, send) {
  let observer = null

  importNextDevBridge()
    .then(({ connect }) => {
      observer = connect(
        {
          url: target,
        },
        {
          reconnect: false,
        },
        (event, state) => {
          send('next-dev-bridge', { event, state })
        }
      )

      send('local-observer', {
        state: observer.getSnapshot(),
        target,
      })
    })
    .catch((error) => {
      send('next-dev-bridge', {
        event: {
          type: 'session:error',
          error: serializeError(error),
        },
        state: null,
      })
    })

  return () => {
    if (observer) {
      observer.stop()
    }
  }
}

function startSandboxObserverStream(session, send) {
  const abortController = new AbortController()
  let command = null
  let logs = null
  let lineBuffer = ''

  ;(async () => {
    try {
      command = await session.sandbox.runCommand({
        cmd: 'node',
        args: ['-e', getSandboxObserverScript(), String(SANDBOX_PORT)],
        cwd: SANDBOX_PREVIEW_ROOT,
        detached: true,
      })

      send('sandbox-observer', {
        cmdId: command.cmdId,
        target: `http://127.0.0.1:${SANDBOX_PORT}`,
      })

      logs = command.logs({
        signal: abortController.signal,
      })

      for await (const log of logs) {
        if (log.stream === 'stdout') {
          lineBuffer = consumeSandboxObserverStdout(
            lineBuffer + log.data,
            send
          )
        } else if (log.data.trim()) {
          send('next-dev-bridge', {
            event: {
              type: 'session:error',
              error: {
                message: log.data.trim(),
                name: 'SandboxObserverStderr',
              },
            },
            state: null,
          })
        }
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        send('next-dev-bridge', {
          event: {
            type: 'session:error',
            error: serializeError(error),
          },
          state: null,
        })
      }
    }
  })()

  return () => {
    abortController.abort()
    if (logs && typeof logs.close === 'function') {
      logs.close()
    }
    if (command) {
      command.kill().catch(() => {})
    }
  }
}

function consumeSandboxObserverStdout(chunk, send) {
  const lines = chunk.split('\n')
  const rest = lines.pop() || ''

  for (const line of lines) {
    if (!line.trim()) {
      continue
    }

    try {
      const message = JSON.parse(line)
      send(message.name, message.payload)
    } catch (error) {
      send('next-dev-bridge', {
        event: {
          type: 'session:error',
          error: serializeError(error),
        },
        state: null,
      })
    }
  }

  return rest
}

function getSandboxObserverScript() {
  return `
const port = process.argv[1] || '3000'
const target = 'http://127.0.0.1:' + port
let observer

function send(name, payload) {
  process.stdout.write(JSON.stringify({ name, payload }) + '\\n')
}

function serializeError(error) {
  return {
    message: error && error.message ? error.message : String(error),
    name: error && error.name ? error.name : 'Error',
    stack: error && error.stack ? error.stack : undefined,
  }
}

try {
  const { connect } = await import('next-dev-bridge')
  observer = connect(
    { url: target },
    { reconnect: true },
    (event, state) => send('next-dev-bridge', { event, state })
  )
  send('sandbox-observer-ready', {
    state: observer.getSnapshot(),
    target,
  })
} catch (error) {
  send('next-dev-bridge', {
    event: {
      type: 'session:error',
      error: serializeError(error),
    },
    state: null,
  })
  process.exit(1)
}

process.on('SIGTERM', () => {
  if (observer) {
    observer.stop()
  }
  process.exit(0)
})
process.on('SIGINT', () => {
  if (observer) {
    observer.stop()
  }
  process.exit(0)
})
setInterval(() => {}, 2147483647)
`
}

function serializeError(error) {
  return {
    message: error && error.message ? error.message : String(error),
    name: error && error.name ? error.name : 'Error',
    stack: error && error.stack ? error.stack : undefined,
  }
}

async function importNextDevBridge() {
  const localDist = [
    path.resolve(process.cwd(), '..', '..', 'dist', 'index.js'),
    path.resolve(process.cwd(), 'dist', 'index.js'),
  ].find((candidate) => fs.existsSync(candidate))

  if (localDist) {
    return (0, eval)(`import(${JSON.stringify(pathToFileURL(localDist).href)})`)
  }

  return (0, eval)('import("next-dev-bridge")')
}
