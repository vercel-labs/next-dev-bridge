import {
  BadRequestError,
  applyScenarioEditForRequest,
  createSessionCookie,
  getPublicSession,
  getScenarioPayloadsForRequest,
} from '../_lib/control.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

export async function GET(request) {
  try {
    const { session, scenarios } = await getScenarioPayloadsForRequest(request)

    return jsonWithSession(
      {
        preview: getPublicSession(session),
        scenarios,
      },
      session
    )
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { probe, session, scenarios } = await applyScenarioEditForRequest(
      request,
      body
    )

    return jsonWithSession(
      {
        ok: true,
        probe,
        preview: getPublicSession(session),
        scenarios,
      },
      session
    )
  } catch (error) {
    return jsonError(error)
  }
}

function jsonWithSession(payload, session) {
  const headers = {
    'cache-control': 'no-store',
  }
  const cookie = createSessionCookie(session)

  if (cookie) {
    headers['set-cookie'] = cookie
  }

  return Response.json(payload, {
    headers,
  })
}

function jsonError(error) {
  const status = error instanceof BadRequestError ? 400 : error.statusCode || 500

  return Response.json(
    {
      error: error.message || String(error),
    },
    {
      headers: {
        'cache-control': 'no-store',
      },
      status,
    }
  )
}
