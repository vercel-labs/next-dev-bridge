import {
  mapErrorStack,
  type MappedErrorStack,
  type SourceMapOptions,
  type StackFrame,
} from './source-map.js'

export type RuntimeErrorSource =
  | 'error'
  | 'unhandledrejection'
  | 'reported-error'

export type RuntimeErrorSeverity = 'fatal' | 'recoverable'

export interface RuntimeErrorInfo {
  id: number
  source: RuntimeErrorSource
  severity: RuntimeErrorSeverity
  name: string
  message: string
  stack: string
  at: string
  filename?: string
  line?: number
  column?: number
  mapped?: MappedErrorStack
}

export interface RuntimeErrorState {
  errors: RuntimeErrorInfo[]
}

export type RuntimeErrorEvent =
  | {
      type: 'runtime:error'
      error: RuntimeErrorInfo
      errors: RuntimeErrorInfo[]
    }
  | {
      type: 'runtime:cleared'
      errors: []
    }

export type RuntimeErrorListener = (
  event: RuntimeErrorEvent,
  state: RuntimeErrorState
) => void

export interface RuntimeErrorObserverOptions {
  dedupe?: boolean
  now?: () => Date | number | string
  sourceMap?: SourceMapOptions | false
}

export interface RuntimeErrorObserverScriptOptions {
  dedupe?: boolean
  isAppDirectory?: boolean
  messageType?: string
  readyMessageType?: string
  resetMessageType?: string
  sourceMapEndpoint?: string
  sourceMapFrameRoot?: string
  targetOrigin?: string
}

export interface RuntimeErrorObserver {
  stop(): void
  reset(): RuntimeErrorState
  getSnapshot(): RuntimeErrorState
}

interface RuntimeErrorDraft {
  source: RuntimeErrorSource
  name: string
  message: string
  stack: string
  filename?: string
  line?: number
  column?: number
}

export function observeRuntimeErrors(
  listener?: RuntimeErrorListener,
  options: RuntimeErrorObserverOptions = {}
): RuntimeErrorObserver {
  if (typeof window === 'undefined') {
    return createNoopRuntimeObserver()
  }

  const state: RuntimeErrorState = {
    errors: [],
  }
  const seen = new Set<string>()
  const shouldDedupe = options.dedupe !== false
  let nextId = 1

  async function recordError(draft: RuntimeErrorDraft) {
    const signature = getRuntimeErrorSignature(draft)
    if (shouldDedupe && seen.has(signature)) {
      return
    }
    seen.add(signature)

    const entry: RuntimeErrorInfo = {
      ...draft,
      id: nextId++,
      severity: getRuntimeErrorSeverity(draft.source),
      at: timestamp(options),
    }

    if (options.sourceMap) {
      entry.mapped = await mapErrorStack(
        entry,
        getRuntimeSourceMapOptions(entry, options.sourceMap)
      )
    }

    state.errors = [...state.errors, entry]
    emit(
      {
        type: 'runtime:error',
        error: cloneRuntimeError(entry),
        errors: cloneRuntimeErrors(state.errors),
      },
      state
    )
  }

  function onError(event: ErrorEvent) {
    void recordError(fromErrorEvent(event))
  }

  function onUnhandledRejection(event: PromiseRejectionEvent) {
    void recordError(fromUnhandledRejection(event))
  }

  const originalReportError = window.reportError
  let reportErrorBridge: ((error: unknown) => void) | null = null
  if (typeof originalReportError === 'function') {
    reportErrorBridge = function (error: unknown) {
      void recordError(fromReportedError(error))
      return originalReportError.call(window, error)
    }
    window.reportError = reportErrorBridge
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)

  return {
    stop() {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
      if (reportErrorBridge && window.reportError === reportErrorBridge) {
        window.reportError = originalReportError
      }
    },
    reset() {
      state.errors = []
      seen.clear()
      emit({ type: 'runtime:cleared', errors: [] }, state)
      return cloneRuntimeState(state)
    },
    getSnapshot() {
      return cloneRuntimeState(state)
    },
  }

  function emit(event: RuntimeErrorEvent, nextState: RuntimeErrorState) {
    if (listener) {
      listener(event, cloneRuntimeState(nextState))
    }
  }

  function getRuntimeSourceMapOptions(
    error: RuntimeErrorInfo,
    sourceMap: SourceMapOptions
  ): SourceMapOptions {
    return {
      ...sourceMap,
      fallbackFile: sourceMap.fallbackFile || error.filename,
      sourceOrigin: sourceMap.sourceOrigin || getWindowLocationOrigin(),
    }
  }
}

export function createRuntimeErrorObserverScript(
  options: RuntimeErrorObserverScriptOptions = {}
) {
  return `;(${runtimeErrorObserverScript.toString()})(${serializeScriptOptions(
    options
  )});`
}

function createNoopRuntimeObserver(): RuntimeErrorObserver {
  const emptyState = { errors: [] }
  return {
    stop() {},
    reset() {
      return emptyState
    },
    getSnapshot() {
      return emptyState
    },
  }
}

function fromErrorEvent(event: ErrorEvent): RuntimeErrorDraft {
  const error = toErrorShape(event.error, event.message || 'Uncaught error')
  const filename = event.filename || undefined
  const line = normalizePosition(event.lineno)
  const column = normalizePosition(event.colno)

  return {
    source: 'error',
    name: error.name,
    message: error.message,
    stack:
      error.stack ||
      createLocationStack(error.message, filename, line, column),
    filename,
    line,
    column,
  }
}

function fromUnhandledRejection(
  event: PromiseRejectionEvent
): RuntimeErrorDraft {
  const error = toErrorShape(event.reason, 'Unhandled promise rejection')

  return {
    source: 'unhandledrejection',
    name: error.name,
    message: error.message,
    stack: error.stack,
  }
}

function fromReportedError(error: unknown): RuntimeErrorDraft {
  const shape = toErrorShape(error, 'Reported runtime error')

  return {
    source: 'reported-error',
    name: shape.name,
    message: shape.message,
    stack: shape.stack,
  }
}

function toErrorShape(value: unknown, fallbackMessage: string) {
  if (value instanceof Error) {
    return {
      name: value.name || 'Error',
      message: value.message || fallbackMessage,
      stack: value.stack || '',
    }
  }

  if (value && typeof value === 'object') {
    const record = value as { name?: unknown; message?: unknown; stack?: unknown }
    return {
      name: typeof record.name === 'string' ? record.name : 'Error',
      message:
        typeof record.message === 'string'
          ? record.message
          : safeStringify(value) || fallbackMessage,
      stack: typeof record.stack === 'string' ? record.stack : '',
    }
  }

  return {
    name: 'Error',
    message:
      typeof value === 'string'
        ? value
        : value == null
          ? fallbackMessage
          : String(value),
    stack: '',
  }
}

function normalizePosition(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function createLocationStack(
  message: string,
  filename?: string,
  line?: number,
  column?: number
) {
  if (!filename || !line || !column) {
    return ''
  }

  return `${message}\n    at <anonymous> (${filename}:${line}:${column})`
}

function timestamp(options: RuntimeErrorObserverOptions) {
  const value = options.now ? options.now() : new Date()
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'number') {
    return new Date(value).toISOString()
  }
  return String(value)
}

function getRuntimeErrorSignature(error: RuntimeErrorDraft) {
  const source = error.source === 'reported-error' ? 'error' : error.source

  return [source, error.name, error.message, error.stack].join('\n')
}

function getRuntimeErrorSeverity(
  source: RuntimeErrorSource
): RuntimeErrorSeverity {
  return source === 'reported-error' ? 'fatal' : 'recoverable'
}

function cloneRuntimeState(state: RuntimeErrorState): RuntimeErrorState {
  return {
    errors: cloneRuntimeErrors(state.errors),
  }
}

function cloneRuntimeErrors(errors: RuntimeErrorInfo[]) {
  return errors.map(cloneRuntimeError)
}

function cloneRuntimeError(error: RuntimeErrorInfo): RuntimeErrorInfo {
  return {
    ...error,
    mapped: error.mapped
      ? {
          ...error.mapped,
          frames: [...error.mapped.frames],
          mappedFrames: [...error.mapped.mappedFrames],
        }
      : undefined,
  }
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function getWindowLocationOrigin() {
  try {
    return window.location.origin
  } catch {
    return undefined
  }
}

function serializeScriptOptions(options: RuntimeErrorObserverScriptOptions) {
  return JSON.stringify(options)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function runtimeErrorObserverScript(rawOptions: RuntimeErrorObserverScriptOptions) {
  const symbol = Symbol.for('__next_dev_bridge_runtime_observer__')
  const existing = (window as any)[symbol]
  const options = rawOptions || {}
  const messageType = options.messageType || 'next-dev-bridge:runtime'
  const readyMessageType = options.readyMessageType || 'next-dev-bridge:runtime-ready'
  const resetMessageType = options.resetMessageType || 'next-dev-bridge:runtime-reset'
  const targetOrigin = options.targetOrigin || '*'
  const shouldDedupe = options.dedupe !== false
  const isAppDirectory = options.isAppDirectory !== false
  const sourceMapEndpoint =
    typeof options.sourceMapEndpoint === 'string' && options.sourceMapEndpoint
      ? options.sourceMapEndpoint
      : ''
  const sourceMapFrameRoot =
    typeof options.sourceMapFrameRoot === 'string' && options.sourceMapFrameRoot
      ? options.sourceMapFrameRoot.replace(/\/+$/, '')
      : ''

  if (existing) {
    post(readyMessageType, {
      existing: true,
      href: window.location.href,
      windowId: existing.windowId,
    })
    return
  }

  let nextId = 1
  const windowId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const state = { errors: [] as RuntimeErrorInfo[] }
  const seen = new Set<string>()

  function post(type: string, payload: Record<string, unknown>) {
    if (window.parent === window) {
      return
    }

    window.parent.postMessage(
      {
        type,
        ...payload,
      },
      targetOrigin
    )
  }

  async function recordError(draft: RuntimeErrorDraft) {
    const signature = getRuntimeErrorSignature(draft)

    if (shouldDedupe && seen.has(signature)) {
      return
    }
    seen.add(signature)

    const entry = {
      ...draft,
      id: nextId++,
      severity: getRuntimeErrorSeverity(draft.source),
      at: new Date().toISOString(),
    } as RuntimeErrorInfo

    state.errors = [...state.errors, entry]
    post(messageType, {
      event: {
        type: 'runtime:error',
        error: entry,
        errors: state.errors,
      },
      state,
      href: window.location.href,
      windowId,
    })

    if (sourceMapEndpoint) {
      void mapStackBearingError(entry)
        .then((mapped) => {
          if (!state.errors.some((error) => error.id === entry.id)) {
            return
          }

          entry.mapped = mapped
          state.errors = state.errors.map((error) =>
            error.id === entry.id ? entry : error
          )
          post(messageType, {
            event: {
              type: 'runtime:error',
              error: entry,
              errors: state.errors,
            },
            state,
            href: window.location.href,
            windowId,
          })
        })
        .catch(() => {})
    }
  }

  function reset() {
    if (state.errors.length === 0) {
      seen.clear()
      return
    }

    state.errors = []
    seen.clear()
    post(messageType, {
      event: {
        type: 'runtime:cleared',
        errors: [],
      },
      state,
      href: window.location.href,
      windowId,
    })
  }

  function onError(event: ErrorEvent) {
    void recordError(fromErrorEvent(event))
  }

  function onUnhandledRejection(event: PromiseRejectionEvent) {
    void recordError(fromUnhandledRejection(event))
  }

  const originalReportError = window.reportError
  let reportErrorBridge: ((error: unknown) => void) | null = null
  if (typeof originalReportError === 'function') {
    reportErrorBridge = function (error: unknown) {
      void recordError(fromReportedError(error))
      return originalReportError.call(window, error)
    }
    window.reportError = reportErrorBridge
  }

  function onMessage(event: MessageEvent) {
    const payload = event.data
    if (!payload || typeof payload !== 'object') {
      return
    }

    if ((payload as { type?: unknown }).type === resetMessageType) {
      reset()
    }
  }

  function stop() {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
    window.removeEventListener('message', onMessage)
    if (reportErrorBridge && window.reportError === reportErrorBridge) {
      window.reportError = originalReportError
    }
    delete (window as any)[symbol]
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)
  window.addEventListener('message', onMessage)

  ;(window as any)[symbol] = {
    windowId,
    getSnapshot() {
      return { errors: state.errors.slice() }
    },
    reset,
    stop,
  }

  post(readyMessageType, {
    existing: false,
    href: window.location.href,
    windowId,
  })

  function fromErrorEvent(event: ErrorEvent): RuntimeErrorDraft {
    const error = toErrorShape(event.error, event.message || 'Uncaught error')
    const filename = event.filename || undefined
    const line = normalizePosition(event.lineno)
    const column = normalizePosition(event.colno)

    return {
      source: 'error',
      name: error.name,
      message: error.message,
      stack:
        error.stack ||
        createLocationStack(error.message, filename, line, column),
      filename,
      line,
      column,
    }
  }

  function fromUnhandledRejection(
    event: PromiseRejectionEvent
  ): RuntimeErrorDraft {
    const error = toErrorShape(event.reason, 'Unhandled promise rejection')

    return {
      source: 'unhandledrejection',
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }

  function fromReportedError(error: unknown): RuntimeErrorDraft {
    const shape = toErrorShape(error, 'Reported runtime error')

    return {
      source: 'reported-error',
      name: shape.name,
      message: shape.message,
      stack: shape.stack,
    }
  }

  function toErrorShape(value: unknown, fallbackMessage: string) {
    if (value instanceof Error) {
      return {
        name: value.name || 'Error',
        message: value.message || fallbackMessage,
        stack: value.stack || '',
      }
    }

    if (value && typeof value === 'object') {
      const record = value as {
        name?: unknown
        message?: unknown
        stack?: unknown
      }

      return {
        name: typeof record.name === 'string' ? record.name : 'Error',
        message:
          typeof record.message === 'string'
            ? record.message
            : safeStringify(value) || fallbackMessage,
        stack: typeof record.stack === 'string' ? record.stack : '',
      }
    }

    return {
      name: 'Error',
      message:
        typeof value === 'string'
          ? value
          : value == null
            ? fallbackMessage
            : String(value),
      stack: '',
    }
  }

  async function mapStackBearingError(error: RuntimeErrorInfo) {
    const frames = normalizeStackFrames(parseStack(error.stack), error.filename)

    return {
      message: error.message,
      stack: error.stack,
      frames,
      mappedFrames: frames.length > 0 ? await mapStackFrames(frames) : [],
    }
  }

  async function mapStackFrames(frames: StackFrame[]) {
    const frameVariants = getStackFrameVariants(frames)
    let lastMappedFrames: unknown[] | null = null

    for (const variantFrames of frameVariants) {
      const result = await requestMappedStackFrames(variantFrames)
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

  async function requestMappedStackFrames(frames: StackFrame[]) {
    try {
      const isCrossOriginSourceMapEndpoint = isCrossOriginURL(sourceMapEndpoint)
      const requestInit: RequestInit = {
        body: JSON.stringify({
          frames,
          isServer: false,
          isEdgeServer: false,
          isAppDirectory,
          sourceOrigin: window.location.origin,
        }),
        cache: 'no-store',
        credentials: isCrossOriginSourceMapEndpoint ? 'omit' : 'same-origin',
        method: 'POST',
        mode: isCrossOriginSourceMapEndpoint ? 'cors' : 'same-origin',
      }

      if (!isCrossOriginSourceMapEndpoint) {
        requestInit.headers = {
          'content-type': 'application/json',
        }
      }

      const response = await fetch(sourceMapEndpoint, {
        ...requestInit,
      })

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

  function alignMappedFrames(frames: StackFrame[], mappedFrames: any[]) {
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
      status: 'rejected',
      reason,
    }))
  }

  function normalizeStackFrames(
    frames: StackFrame[],
    fallbackFile?: string
  ): StackFrame[] {
    return frames.map((frame) => ({
      ...frame,
      file: normalizeStackFrameFile(frame.file, fallbackFile),
    }))
  }

  function getStackFrameVariants(frames: StackFrame[]) {
    const variants: StackFrame[][] = []
    const seen = new Set<string>()
    addStackFrameVariant(variants, seen, frames)

    for (const transformFile of [
      getNextDevGeneratedFrameFile,
      getTurbopackFrameFile,
      getAbsoluteFrameFile,
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

  function normalizeStackFrameFile(file: unknown, fallbackFile?: string) {
    if (typeof file !== 'string' || file.length === 0) {
      return undefined
    }

    const nextAssetPath = getNextAssetPath(file)
    if (nextAssetPath) {
      return formatNextAssetFrameFile(nextAssetPath)
    }

    if (isAbsoluteOrVirtualFrameFile(file)) {
      return file
    }

    if (fallbackFile && getBasename(fallbackFile) === getBasename(file)) {
      const fallbackNextAssetPath = getNextAssetPath(fallbackFile)
      return fallbackNextAssetPath
        ? formatNextAssetFrameFile(fallbackNextAssetPath)
        : fallbackFile
    }

    const normalizedFile = file.startsWith('_next/') ? `/${file}` : file
    if (normalizedFile.startsWith('/_next/')) {
      return formatNextAssetFrameFile(normalizedFile)
    }

    if (isLikelyNextChunkFile(normalizedFile)) {
      return formatNextAssetFrameFile(`/_next/static/chunks/${normalizedFile}`)
    }

    return file
  }

  function formatNextAssetFrameFile(nextAssetPath: string) {
    if (!sourceMapFrameRoot) {
      return nextAssetPath
    }

    return `${sourceMapFrameRoot}/${nextAssetPath.replace(
      /^\/_next\/static\/?/,
      ''
    )}`
  }

  function getNextDevGeneratedFrameFile(file: string) {
    const nextAssetPath = getNextAssetPathFromFrameFile(file)
    if (!nextAssetPath) return null

    return `.next/dev/static/${nextAssetPath.replace(
      /^\/_next\/static\/?/,
      ''
    )}`
  }

  function getTurbopackFrameFile(file: string) {
    const nextAssetPath = getNextAssetPathFromFrameFile(file)
    if (!nextAssetPath) return null

    return nextAssetPath.replace(/^\/+/, '')
  }

  function getAbsoluteFrameFile(file: string) {
    const nextAssetPath = getNextAssetPathFromFrameFile(file)
    if (!nextAssetPath) return null

    try {
      return new URL(nextAssetPath, window.location.origin).href
    } catch {
      return null
    }
  }

  function getNextAssetPathFromFrameFile(file: string) {
    const pathname = getStackFramePathname(file)
    if (pathname.startsWith('/_next/static/')) {
      return pathname
    }

    const nextDevStaticPath = getPathAfterSegment(
      pathname,
      '/.next/dev/static/'
    )
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

  function hasMeaningfulMappedFrame(mappedFrames: unknown[]) {
    for (const frame of mappedFrames) {
      const originalStackFrame = getOriginalStackFrame(frame)
      if (!originalStackFrame || originalStackFrame.ignored === true) continue

      const file = getNonEmptyString(originalStackFrame.file)
      if (!file || isGeneratedNextFrameFile(file)) continue

      return true
    }

    return false
  }

  function getOriginalStackFrame(frame: unknown) {
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

  function isRecord(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null
  }

  function isCrossOriginURL(value: string) {
    try {
      return new URL(value, window.location.href).origin !== window.location.origin
    } catch {
      return false
    }
  }

  function parseStack(stack: string): StackFrame[] {
    return String(stack)
      .split('\n')
      .map(parseStackLine)
      .filter(Boolean) as StackFrame[]
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

  function normalizePosition(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : undefined
  }

  function createLocationStack(
    message: string,
    filename?: string,
    line?: number,
    column?: number
  ) {
    if (!filename || !line || !column) {
      return ''
    }

    return `${message}\n    at <anonymous> (${filename}:${line}:${column})`
  }

  function getRuntimeErrorSignature(error: RuntimeErrorDraft) {
    const source = error.source === 'reported-error' ? 'error' : error.source

    return [source, error.name, error.message, error.stack].join('\n')
  }

  function getRuntimeErrorSeverity(
    source: RuntimeErrorSource
  ): RuntimeErrorSeverity {
    return source === 'reported-error' ? 'fatal' : 'recoverable'
  }

  function safeStringify(value: unknown) {
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }

}
