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

export async function GET(request) {
  let session
  let connect

  try {
    session = await getPreviewSession(request)
    ;({ connect } = await importNextDevBridge())
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
  let observer = null
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

      send('ready', {
        preview: getPublicSession(session),
        state: observer.getSnapshot(),
        target,
      })

      heartbeat = setInterval(() => {
        send('ping', { at: new Date().toISOString() })
      }, 15000)
    },
    cancel() {
      closed = true
      clearInterval(heartbeat)
      if (observer) {
        observer.stop()
      }
    },
  })

  const headers = {
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
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
