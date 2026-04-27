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
  fallbackFile?: string | URL
  frameRoot?: string | URL
  fetch?: typeof fetch
  headers?: HeadersInit
  isAppDirectory?: boolean
  isEdgeServer?: boolean
  isServer?: boolean
  requestInit?: Omit<RequestInit, 'body' | 'headers' | 'method'>
  sourceOrigin?: string | URL
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
  const frames = normalizeStackFrames(parseStack(stack), options)

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
    const normalizedFrames = normalizeStackFrames(frames, options)
    const requestFetch = options.fetch || fetch
    const headers = new Headers(options.headers)
    headers.set('content-type', 'application/json')

    const response = await requestFetch(getOriginalStackFramesURL(options), {
      ...options.requestInit,
      method: 'POST',
      headers,
      body: JSON.stringify({
        frames: normalizedFrames,
        isServer: Boolean(options.isServer),
        isEdgeServer: Boolean(options.isEdgeServer),
        isAppDirectory: options.isAppDirectory !== false,
        sourceOrigin: normalizeOriginValue(options.sourceOrigin),
      }),
    })

    if (!response.ok || response.status === 204) {
      const reason = await response.text().catch(() => '')
      return normalizedFrames.map(() => ({
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

export function normalizeStackFrames(
  frames: StackFrame[],
  options: Pick<SourceMapOptions, 'fallbackFile' | 'frameRoot' | 'url'> = {}
): StackFrame[] {
  return frames.map((frame) => ({
    ...frame,
    file: normalizeStackFrameFile(frame.file, options),
  }))
}

function normalizeStackFrameFile(
  file: unknown,
  options: Pick<SourceMapOptions, 'fallbackFile' | 'frameRoot' | 'url'>
) {
  if (typeof file !== 'string' || file.length === 0) {
    return undefined
  }

  const nextAssetPath = getNextAssetPath(file)
  if (nextAssetPath) {
    return formatNextAssetFrameFile(nextAssetPath, options.frameRoot)
  }

  if (isAbsoluteOrVirtualFrameFile(file)) {
    return file
  }

  const fallbackFile = String(options.fallbackFile || '')
  if (fallbackFile && getBasename(fallbackFile) === getBasename(file)) {
    const fallbackNextAssetPath = getNextAssetPath(fallbackFile)
    return fallbackNextAssetPath
      ? formatNextAssetFrameFile(fallbackNextAssetPath, options.frameRoot)
      : fallbackFile
  }

  const normalizedFile = file.startsWith('_next/') ? `/${file}` : file
  if (normalizedFile.startsWith('/_next/')) {
    return formatNextAssetFrameFile(normalizedFile, options.frameRoot)
  }

  if (isLikelyNextChunkFile(normalizedFile)) {
    return formatNextAssetFrameFile(
      `/_next/static/chunks/${normalizedFile}`,
      options.frameRoot
    )
  }

  return file
}

function formatNextAssetFrameFile(nextAssetPath: string, frameRoot?: string | URL) {
  if (!frameRoot) {
    return nextAssetPath
  }

  const root = String(frameRoot).replace(/\/+$/, '')
  const relativeAssetPath = nextAssetPath.replace(/^\/_next\/static\/?/, '')

  return `${root}/${relativeAssetPath}`
}

function getNextAssetPath(file: string) {
  if (file.startsWith('/_next/')) {
    return file
  }

  if (file.startsWith('_next/')) {
    return `/${file}`
  }

  try {
    const url = new URL(file)
    return url.pathname.startsWith('/_next/') ? url.pathname : ''
  } catch {
    return ''
  }
}

function isAbsoluteOrVirtualFrameFile(file: string) {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(file)
}

function isLikelyNextChunkFile(file: string) {
  return (
    !file.includes('/') &&
    file.endsWith('.js') &&
    (file.startsWith('_') ||
      file.includes('._.') ||
      file.startsWith('node_modules_') ||
      file.startsWith('turbopack-'))
  )
}

function getBasename(file: string) {
  return file.split('?')[0].split(/[\\/]/).pop() || file
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

function normalizeOriginValue(value: string | URL | undefined) {
  if (!value) {
    return undefined
  }

  try {
    return new URL(String(value)).origin
  } catch {
    return undefined
  }
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
