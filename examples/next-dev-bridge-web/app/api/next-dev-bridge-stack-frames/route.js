export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  })
}

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
        headers: corsHeaders(),
        status: 400,
      }
    )
  }

  const sourceOrigin = normalizeOrigin(body.sourceOrigin)
  if (!sourceOrigin || !isAllowedSourceOrigin(sourceOrigin, request.url)) {
    return Response.json(
      {
        error: 'Refusing to proxy stack frames for this preview origin.',
      },
      {
        headers: corsHeaders(),
        status: 403,
      }
    )
  }

  let response

  try {
    response = await fetch(
      new URL('/__nextjs_original-stack-frames', sourceOrigin),
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
          origin: sourceOrigin,
          referer: `${sourceOrigin}/`,
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
        headers: corsHeaders(),
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
      ...corsHeaders(),
      'content-type':
        response.headers.get('content-type') || 'application/json; charset=utf-8',
    },
    status: response.status,
  })
}

function corsHeaders() {
  return {
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'OPTIONS, POST',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  }
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

function isAllowedSourceOrigin(sourceOrigin, requestUrl) {
  const source = new URL(sourceOrigin)
  const request = new URL(requestUrl)
  const configuredPreviewOrigin = normalizeOrigin(
    process.env.NEXT_DEV_BRIDGE_PREVIEW_ORIGIN
  )

  if (configuredPreviewOrigin && source.origin === configuredPreviewOrigin) {
    return true
  }

  if (source.hostname.endsWith('.vercel.run')) {
    return source.protocol === 'https:'
  }

  if (source.hostname === 'localhost' || source.hostname === '127.0.0.1') {
    return (
      source.protocol === 'http:' &&
      (request.hostname === 'localhost' || request.hostname === '127.0.0.1')
    )
  }

  return false
}
