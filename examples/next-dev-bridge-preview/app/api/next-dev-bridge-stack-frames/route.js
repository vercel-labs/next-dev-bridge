export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

export async function POST(request) {
  let body

  try {
    body = JSON.parse(await request.text())
  } catch {
    return Response.json(
      {
        error: 'Expected a JSON stack-frame payload.',
      },
      {
        status: 400,
      }
    )
  }

  const requestOrigin = new URL(request.url).origin
  const sourceOrigin = normalizeOrigin(body.sourceOrigin) || requestOrigin

  if (sourceOrigin !== requestOrigin) {
    return Response.json(
      {
        error: 'Refusing to proxy stack frames for a different preview origin.',
      },
      {
        status: 403,
      }
    )
  }

  let response

  try {
    response = await fetch(
      new URL('/__nextjs_original-stack-frames', requestOrigin),
      {
        body: JSON.stringify({
          frames: Array.isArray(body.frames) ? body.frames : [],
          isServer: Boolean(body.isServer),
          isEdgeServer: Boolean(body.isEdgeServer),
          isAppDirectory: body.isAppDirectory !== false,
        }),
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
          origin: requestOrigin,
          referer: `${requestOrigin}/`,
        },
        method: 'POST',
      }
    )
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      {
        status: 502,
      }
    )
  }

  const responseBody =
    response.status === 204 || response.status === 304
      ? null
      : await response.text()

  return new Response(responseBody, {
    headers: {
      'cache-control': 'no-store',
      'content-type':
        response.headers.get('content-type') || 'application/json; charset=utf-8',
    },
    status: response.status,
  })
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return ''
  }

  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}
