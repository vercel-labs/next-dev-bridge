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

  const internalOrigin = getInternalOrigin(request)
  const requestOrigins = getRequestOrigins(request)
  const sourceOrigin =
    normalizeOrigin(body.sourceOrigin) || requestOrigins[0] || internalOrigin

  if (!isAllowedSourceOrigin(sourceOrigin, requestOrigins)) {
    return Response.json(
      {
        error: 'Refusing to proxy stack frames for a different preview origin.',
      },
      {
        status: 403,
      }
    )
  }

  const frames = Array.isArray(body.frames) ? body.frames : []
  const result = await fetchOriginalStackFrames({
    origins: getOriginalStackFrameOrigins(request, internalOrigin, sourceOrigin),
    payload: {
      frames,
      isServer: Boolean(body.isServer),
      isEdgeServer: Boolean(body.isEdgeServer),
      isAppDirectory: body.isAppDirectory !== false,
    },
    sourceOrigin,
  })

  if (!result.ok) {
    return Response.json(rejectFrames(frames, result.reason), {
      headers: {
        'cache-control': 'no-store',
      },
      status: 200,
    })
  }

  return new Response(result.body, {
    headers: {
      'cache-control': 'no-store',
      'content-type': result.contentType || 'application/json; charset=utf-8',
    },
    status: result.status,
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

function getRequestOrigins(request) {
  const requestUrl = new URL(request.url)
  const origins = new Set([requestUrl.origin])

  addOrigin(origins, request.headers.get('origin'))
  addOrigin(origins, request.headers.get('referer'))

  const protocols = splitHeader(request.headers.get('x-forwarded-proto'))
  const hosts = [
    ...splitHeader(request.headers.get('x-forwarded-host')),
    ...splitHeader(request.headers.get('host')),
  ]
  const fallbackProtocol = requestUrl.protocol.replace(/:$/, '') || 'http'

  for (const host of hosts) {
    const cleanHost = host.trim()
    if (!cleanHost) {
      continue
    }

    for (const protocol of protocols.length > 0 ? protocols : [fallbackProtocol]) {
      const cleanProtocol = normalizeProtocol(protocol)
      if (cleanProtocol) {
        addOrigin(origins, `${cleanProtocol}://${cleanHost}`)
      }
    }
  }

  return [...origins]
}

function getInternalOrigin(request) {
  const requestUrl = new URL(request.url)
  const configuredOrigin = normalizeOrigin(
    process.env.NEXT_DEV_BRIDGE_INTERNAL_ORIGIN
  )

  if (configuredOrigin) {
    return configuredOrigin
  }

  const localHost = splitHeader(request.headers.get('host')).find((host) =>
    isLocalHostHeader(host)
  )

  if (localHost) {
    return `http://${localHost}`
  }

  if (isLocalHostname(requestUrl.hostname)) {
    return requestUrl.origin
  }

  if (requestUrl.hostname.endsWith('.vercel.run')) {
    return `http://127.0.0.1:${process.env.PORT || '3000'}`
  }

  return requestUrl.origin
}

function getOriginalStackFrameOrigins(request, internalOrigin, sourceOrigin) {
  const origins = new Set()
  addOrigin(origins, process.env.NEXT_DEV_BRIDGE_INTERNAL_ORIGIN)
  addOrigin(origins, internalOrigin)
  addOrigin(origins, new URL(request.url).origin)
  addOrigin(origins, sourceOrigin)
  return [...origins]
}

async function fetchOriginalStackFrames({ origins, payload, sourceOrigin }) {
  const body = JSON.stringify(payload)
  const failures = []

  for (const origin of origins) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    try {
      const response = await fetch(
        new URL('/__nextjs_original-stack-frames', origin),
        {
          body,
          cache: 'no-store',
          headers: {
            'content-type': 'application/json',
            origin: sourceOrigin,
            referer: `${sourceOrigin}/`,
          },
          method: 'POST',
          signal: controller.signal,
        }
      )
      const responseBody =
        response.status === 204 || response.status === 304
          ? null
          : await response.text()

      if (response.ok) {
        return {
          body: responseBody,
          contentType: response.headers.get('content-type'),
          ok: true,
          status: response.status,
        }
      }

      failures.push(`${origin} returned ${response.status}: ${responseBody}`)
    } catch (error) {
      failures.push(
        `${origin} failed: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    ok: false,
    reason:
      failures.join('; ') || 'Failed to reach Next dev stack-frame endpoint.',
  }
}

function rejectFrames(frames, reason) {
  return frames.map(() => ({
    status: 'rejected',
    reason,
  }))
}

function addOrigin(origins, value) {
  const origin = normalizeOrigin(value)
  if (origin) {
    origins.add(origin)
  }
}

function splitHeader(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function normalizeProtocol(value) {
  const protocol = String(value || '').replace(/:$/, '')
  return protocol === 'http' || protocol === 'https' ? protocol : ''
}

function isAllowedSourceOrigin(sourceOrigin, requestOrigins) {
  if (requestOrigins.includes(sourceOrigin)) {
    return true
  }

  let source
  try {
    source = new URL(sourceOrigin)
  } catch {
    return false
  }

  if (isLocalHostname(source.hostname)) {
    return requestOrigins.some((origin) => isLocalHostname(new URL(origin).hostname))
  }

  if (source.hostname.endsWith('.vercel.run')) {
    return requestOrigins.some((origin) => {
      const request = new URL(origin)
      return (
        request.hostname === source.hostname ||
        request.hostname.endsWith('.vercel.run') ||
        isLocalHostname(request.hostname)
      )
    })
  }

  return false
}

function isLocalHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

function isLocalHostHeader(host) {
  try {
    return isLocalHostname(new URL(`http://${host}`).hostname)
  } catch {
    return false
  }
}
