export interface StackFrame {
  file?: string
  methodName?: string
  arguments?: unknown[]
  line1?: number
  column1?: number
  [key: string]: unknown
}

export type SourceMappedStackFrame =
  | {
      status: 'fulfilled'
      value: {
        originalStackFrame?: {
          file?: string
          methodName?: string
          line1?: number
          column1?: number
          ignored?: boolean
          [key: string]: unknown
        }
        originalCodeFrame?: string
        [key: string]: unknown
      }
    }
  | {
      status: 'rejected'
      reason: string
    }
  | Record<string, unknown>

export interface SourceMapOptions {
  endpoint?: string | URL
  fetch?: typeof fetch
  isAppDirectory?: boolean
  isEdgeServer?: boolean
  isServer?: boolean
  url?: string | URL
}

export interface MappedErrorStack {
  message: string
  stack: string
  frames: StackFrame[]
  mappedFrames: SourceMappedStackFrame[]
}

export async function mapErrorStack(
  error: unknown,
  options: SourceMapOptions = {}
): Promise<MappedErrorStack> {
  const message = getErrorMessage(error)
  const stack = getErrorStack(error)
  const frames = parseStack(stack)

  return {
    message,
    stack,
    frames,
    mappedFrames:
      frames.length > 0 ? await mapStackFrames(frames, options) : [],
  }
}

export async function mapStackFrames(
  frames: StackFrame[],
  options: SourceMapOptions = {}
): Promise<SourceMappedStackFrame[]> {
  try {
    const requestFetch = options.fetch || fetch
    const response = await requestFetch(getOriginalStackFramesURL(options), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        frames,
        isServer: Boolean(options.isServer),
        isEdgeServer: Boolean(options.isEdgeServer),
        isAppDirectory: options.isAppDirectory !== false,
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
    if (!Array.isArray(mappedFrames)) {
      return frames.map(() => ({
        status: 'rejected',
        reason: 'Invalid original stack frame response from Next dev server.',
      }))
    }

    return frames.map(
      (_frame, index) =>
        mappedFrames[index] || {
          status: 'rejected',
          reason: 'No original stack frame response for frame.',
        }
    )
  } catch (error) {
    return frames.map(() => ({
      status: 'rejected',
      reason: error instanceof Error ? error.message : String(error),
    }))
  }
}

export function parseStack(stack: string): StackFrame[] {
  return String(stack)
    .split('\n')
    .map(parseStackLine)
    .filter(Boolean)
}

function parseStackLine(line: string): StackFrame | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('at ')) {
    return null
  }

  const withoutAt = trimmed.slice(3)
  let methodName = '<anonymous>'
  let location = withoutAt
  const openParen = withoutAt.indexOf('(')
  const closeParen = withoutAt.endsWith(')') ? withoutAt.length - 1 : -1

  if (openParen !== -1 && closeParen !== -1 && closeParen > openParen) {
    methodName = withoutAt.slice(0, openParen).trim() || '<anonymous>'
    location = withoutAt.slice(openParen + 1, closeParen)
  }

  const locationMatch = /^(.*):(\d+):(\d+)$/.exec(location)
  if (!locationMatch) {
    return null
  }

  return {
    file: locationMatch[1],
    methodName,
    arguments: [],
    line1: Number(locationMatch[2]),
    column1: Number(locationMatch[3]),
  }
}

function getOriginalStackFramesURL(options: SourceMapOptions) {
  if (options.endpoint) {
    return options.endpoint
  }

  if (options.url) {
    return new URL('/__nextjs_original-stack-frames', options.url)
  }

  if (typeof window !== 'undefined') {
    return new URL('/__nextjs_original-stack-frames', window.location.href)
  }

  return new URL('/__nextjs_original-stack-frames', 'http://localhost:3000')
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '')
  }

  return typeof error === 'string' ? error : ''
}

function getErrorStack(error: unknown) {
  if (error instanceof Error) {
    return error.stack || ''
  }

  if (error && typeof error === 'object' && 'stack' in error) {
    return String((error as { stack?: unknown }).stack || '')
  }

  return typeof error === 'string' ? error : ''
}
