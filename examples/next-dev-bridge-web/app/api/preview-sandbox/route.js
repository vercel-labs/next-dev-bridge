import {
  createSessionCookie,
  getPreviewSession,
  getPublicSession,
  isSandboxStoppedError,
  stopPreviewSession,
} from '../_lib/control.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

export async function GET(request) {
  return respondWithSession(await getRecoverablePreviewSession(request))
}

export async function POST(request) {
  const url = new URL(request.url)
  const session = await getRecoverablePreviewSession(request, {
    ignoreRequested: url.searchParams.get('ignore') === '1',
    forceNew: url.searchParams.get('restart') === '1',
  })

  return respondWithSession(session)
}

export async function DELETE(request) {
  const result = await stopPreviewSession(request)

  return Response.json(result, {
    headers: {
      'cache-control': 'no-store',
      'set-cookie': 'next-dev-bridge-sandbox=; Path=/; Max-Age=0; SameSite=Lax',
    },
  })
}

function respondWithSession(session) {
  const headers = {
    'cache-control': 'no-store',
  }
  const cookie = createSessionCookie(session)

  if (cookie) {
    headers['set-cookie'] = cookie
  }

  return Response.json(getPublicSession(session), {
    headers,
  })
}

async function getRecoverablePreviewSession(request, options = {}) {
  try {
    return await getPreviewSession(request, options)
  } catch (error) {
    if (!isSandboxStoppedError(error)) {
      throw error
    }

    return getPreviewSession(request, {
      forceNew: true,
      ignoreRequested: true,
    })
  }
}
