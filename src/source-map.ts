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

type StackFrameRequestResult = {
  mappedFrames: SourceMappedStackFrame[]
  shouldTryNextVariant: boolean
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
  const normalizedFrames = normalizeStackFrames(frames, options)
  const frameVariants = getStackFrameVariants(normalizedFrames, options)
  let lastMappedFrames: SourceMappedStackFrame[] | null = null

  for (const variantFrames of frameVariants) {
    const result = await requestMappedStackFrames(variantFrames, options)
    if (hasMeaningfulMappedFrame(result.mappedFrames)) {
      return alignMappedFrames(frames, result.mappedFrames)
    }
    lastMappedFrames = result.mappedFrames
    if (!result.shouldTryNextVariant) {
      break
    }
  }

  return lastMappedFrames ?? rejectFrames(frames, 'No stack frames to map.')
}

async function requestMappedStackFrames(
  frames: StackFrame[],
  options: SourceMapOptions
): Promise<StackFrameRequestResult> {
  try {
    const requestFetch = options.fetch || fetch
    const endpoint = getOriginalStackFramesURL(options)
    const isCrossOriginEndpoint = isCrossOriginURL(endpoint)
    const headers = new Headers(options.headers)
    const requestInit: RequestInit = {
      ...options.requestInit,
      method: 'POST',
      body: JSON.stringify({
        frames,
        isServer: Boolean(options.isServer),
        isEdgeServer: Boolean(options.isEdgeServer),
        isAppDirectory: options.isAppDirectory !== false,
        sourceOrigin: normalizeOriginValue(options.sourceOrigin),
      }),
    }

    if (!isCrossOriginEndpoint) {
      headers.set('content-type', 'application/json')
    }

    if (hasHeaders(headers)) {
      requestInit.headers = headers
    }

    const response = await requestFetch(endpoint, requestInit)

    if (!response.ok || response.status === 204) {
      const reason = await response.text().catch(() => '')
      return {
        mappedFrames: rejectFrames(
          frames,
          reason || 'No original stack frame response from Next dev server.'
        ),
        shouldTryNextVariant: false,
      }
    }

    const mappedFrames = await response.json()
    if (!Array.isArray(mappedFrames)) {
      return {
        mappedFrames: rejectFrames(
          frames,
          'Invalid original stack frame response from Next dev server.'
        ),
        shouldTryNextVariant: false,
      }
    }

    return {
      mappedFrames: alignMappedFrames(frames, mappedFrames),
      shouldTryNextVariant: true,
    }
  } catch (error) {
    return {
      mappedFrames: rejectFrames(
        frames,
        error instanceof Error ? error.message : String(error)
      ),
      shouldTryNextVariant: false,
    }
  }
}

function alignMappedFrames(
  frames: StackFrame[],
  mappedFrames: SourceMappedStackFrame[]
) {
  return frames.map(
    (_frame, index) =>
      mappedFrames[index] || {
        status: 'rejected',
        reason: 'No original stack frame response for frame.',
      }
  )
}

function rejectFrames(frames: StackFrame[], reason: string) {
  return frames.map(() => ({
    status: 'rejected' as const,
    reason,
  }))
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

function getStackFrameVariants(
  frames: StackFrame[],
  options: Pick<SourceMapOptions, 'sourceOrigin'>
) {
  const variants: StackFrame[][] = []
  const seen = new Set<string>()
  addStackFrameVariant(variants, seen, frames)

  for (const transformFile of [
    getNextDevGeneratedFrameFile,
    getTurbopackFrameFile,
    (file: string) => getAbsoluteFrameFile(file, options.sourceOrigin),
  ]) {
    const variant = transformStackFrameFiles(frames, transformFile)
    if (variant) {
      addStackFrameVariant(variants, seen, variant)
    }
  }

  return variants
}

function addStackFrameVariant(
  variants: StackFrame[][],
  seen: Set<string>,
  frames: StackFrame[]
) {
  const key = JSON.stringify(frames.map((frame) => frame.file))
  if (seen.has(key)) return

  seen.add(key)
  variants.push(frames)
}

function transformStackFrameFiles(
  frames: StackFrame[],
  transformFile: (file: string) => string | null
) {
  let changed = false
  const nextFrames = frames.map((frame) => {
    if (typeof frame.file !== 'string') return frame

    const nextFile = transformFile(frame.file)
    if (!nextFile || nextFile === frame.file) return frame

    changed = true
    return {
      ...frame,
      file: nextFile,
    }
  })

  return changed ? nextFrames : null
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

function getNextDevGeneratedFrameFile(file: string) {
  const nextAssetPath = getNextAssetPathFromFrameFile(file)
  if (!nextAssetPath) return null

  return `.next/dev/static/${nextAssetPath.replace(/^\/_next\/static\/?/, '')}`
}

function getTurbopackFrameFile(file: string) {
  const nextAssetPath = getNextAssetPathFromFrameFile(file)
  if (!nextAssetPath) return null

  return nextAssetPath.replace(/^\/+/, '')
}

function getAbsoluteFrameFile(
  file: string,
  sourceOrigin?: string | URL
) {
  if (!sourceOrigin) return null

  const nextAssetPath = getNextAssetPathFromFrameFile(file)
  if (!nextAssetPath) return null

  try {
    return new URL(nextAssetPath, sourceOrigin).href
  } catch {
    return null
  }
}

function getNextAssetPathFromFrameFile(file: string) {
  const pathname = getStackFramePathname(file)
  if (pathname.startsWith('/_next/static/')) {
    return pathname
  }

  const nextDevStaticPath = getPathAfterSegment(pathname, '/.next/dev/static/')
  if (nextDevStaticPath) {
    return `/_next/static/${nextDevStaticPath}`
  }

  return ''
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

function getStackFramePathname(file: string) {
  try {
    return new URL(file).pathname
  } catch {}

  if (file.startsWith('/')) {
    return file
  }

  return `/${file}`
}

function getPathAfterSegment(pathname: string, segment: string) {
  const index = pathname.indexOf(segment)
  if (index === -1) return ''
  return pathname.slice(index + segment.length)
}

function hasMeaningfulMappedFrame(mappedFrames: SourceMappedStackFrame[]) {
  for (const frame of mappedFrames) {
    const originalStackFrame = getOriginalStackFrame(frame)
    if (!originalStackFrame || originalStackFrame.ignored === true) continue

    const file = getNonEmptyString(originalStackFrame.file)
    if (!file || isGeneratedNextFrameFile(file)) continue

    return true
  }

  return false
}

function getOriginalStackFrame(frame: SourceMappedStackFrame) {
  if (!isRecord(frame)) return null
  if (frame.status !== 'fulfilled') return null
  if (!isRecord(frame.value)) return null
  if (!isRecord(frame.value.originalStackFrame)) return null

  return frame.value.originalStackFrame
}

function isGeneratedNextFrameFile(file: string) {
  const pathname = getStackFramePathname(file)
  return (
    /\/(?:_next\/static|\.next\/dev\/static)\/chunks\//.test(pathname) ||
    pathname.includes('/next/dist/compiled/')
  )
}

function getNonEmptyString(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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

function isCrossOriginURL(value: string | URL) {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return new URL(String(value), window.location.href).origin !== window.location.origin
  } catch {
    return false
  }
}

function hasHeaders(headers: Headers) {
  let hasHeader = false
  headers.forEach(() => {
    hasHeader = true
  })

  return hasHeader
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
