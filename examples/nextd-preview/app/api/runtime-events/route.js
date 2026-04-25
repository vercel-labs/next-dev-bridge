export const dynamic = 'force-dynamic'

import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

function getStore() {
  if (!globalThis.__NEXTD_EXAMPLE_RUNTIME_EVENTS__) {
    globalThis.__NEXTD_EXAMPLE_RUNTIME_EVENTS__ = {
      current: { kind: 'clear', message: 'No runtime errors reported yet.' },
      events: [],
      nextId: 1,
    }
  }

  return globalThis.__NEXTD_EXAMPLE_RUNTIME_EVENTS__
}

export async function GET() {
  const store = getStore()
  return Response.json(
    {
      current: store.current,
      events: store.events,
    },
    {
      headers: corsHeaders(),
    }
  )
}

export async function POST(request) {
  const store = getStore()
  const body = await request.json().catch(() => ({}))
  const frames = Array.isArray(body.frames) ? body.frames : []
  const mappedFrames =
    body.kind === 'error' && frames.length > 0
      ? await getOriginalStackFrames(request, frames)
      : []
  const event = {
    id: store.nextId++,
    at: new Date().toISOString(),
    kind: body.kind === 'error' ? 'error' : 'clear',
    message: String(body.message || ''),
    category: String(
      body.category || (body.kind === 'error' ? 'runtime' : 'clear')
    ),
    stack: body.stack ? String(body.stack) : null,
    frames,
    mappedFrames,
    source: String(body.source || 'runtime-effect'),
  }

  store.current = event
  store.events.push(event)

  if (store.events.length > 50) {
    store.events.splice(0, store.events.length - 50)
  }

  return Response.json(
    { ok: true, event },
    {
      headers: corsHeaders(),
    }
  )
}

export async function DELETE() {
  const store = getStore()
  store.current = {
    kind: 'clear',
    category: 'clear',
    message: 'Runtime event store reset.',
    stack: null,
    frames: [],
    mappedFrames: [],
    source: 'runtime-effect',
    at: new Date().toISOString(),
  }
  store.events = []
  store.nextId = 1

  return Response.json(
    { ok: true },
    {
      headers: corsHeaders(),
    }
  )
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  })
}

async function getOriginalStackFrames(request, frames) {
  try {
    const endpoint = new URL('/__nextjs_original-stack-frames', request.url)
    const response = await fetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({
        frames: frames.map((frame) => ({
          ...frame,
          file: normalizeFrameFile(frame.file),
        })),
        isServer: false,
        isEdgeServer: false,
        isAppDirectory: true,
      }),
    })

    if (!response.ok || response.status === 204) {
      const reason = await response.text().catch(() => '')
      return frames.map(() => ({
        status: 'rejected',
        reason:
          reason || 'No original stack frame response from Next dev server.',
      }))
    }

    const mappedFrames = await response.json()
    return frames.map(
      (_frame, index) =>
        mappedFrames[index] || {
          status: 'rejected',
          reason: 'No original stack frame response for frame.',
        }
    )
  } catch (error) {
    return [
      {
        status: 'rejected',
        reason: error?.message || String(error),
      },
    ]
  }
}

function normalizeFrameFile(file) {
  if (!file) {
    return file
  }

  try {
    const frameUrl = new URL(file)

    if (frameUrl.pathname.startsWith('/_next/static/')) {
      const distRelativePath = frameUrl.pathname.slice('/_next/'.length)
      return (
        pathToFileURL(path.join(getNextDevDistDir(), distRelativePath)).href +
        frameUrl.search
      )
    }
  } catch {}

  return file
}

function getNextDevDistDir() {
  const distDir = process.env.__NEXT_DIST_DIR
  if (distDir) {
    return distDir
  }

  const nextDevDir = path.join(process.cwd(), '.next', 'dev')
  return fs.existsSync(nextDevDir)
    ? nextDevDir
    : path.join(process.cwd(), '.next')
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
  }
}
