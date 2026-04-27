import {
  mapErrorStack,
  type MappedErrorStack,
  type StackFrame,
} from './source-map.js'

export type RuntimeErrorSource = 'error' | 'unhandledrejection'

export interface RuntimeErrorInfo {
  id: number
  source: RuntimeErrorSource
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
}

export interface RuntimeErrorObserverScriptOptions {
  dedupe?: boolean
  isAppDirectory?: boolean
  messageType?: string
  minResetAfterErrorMs?: number
  readyMessageType?: string
  resetOnRefresh?: boolean
  resetMessageType?: string
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
      at: timestamp(options),
    }

    entry.mapped = await mapErrorStack(entry)

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

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)

  return {
    stop() {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
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
  return [error.source, error.name, error.message, error.stack].join('\n')
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
  const minResetAfterErrorMs = options.minResetAfterErrorMs ?? 1000
  const readyMessageType = options.readyMessageType || 'next-dev-bridge:runtime-ready'
  const resetMessageType = options.resetMessageType || 'next-dev-bridge:runtime-reset'
  const targetOrigin = options.targetOrigin || '*'
  const shouldDedupe = options.dedupe !== false
  const shouldResetOnRefresh = options.resetOnRefresh !== false
  const isAppDirectory = options.isAppDirectory !== false

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
  let resetAfterRefreshTimer: ReturnType<typeof setTimeout> | null = null
  let lastRuntimeErrorAt = 0

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
    const signature = [
      draft.source,
      draft.name,
      draft.message,
      draft.stack,
    ].join('\n')

    if (shouldDedupe && seen.has(signature)) {
      return
    }
    seen.add(signature)

    const entry = {
      ...draft,
      id: nextId++,
      at: new Date().toISOString(),
    } as RuntimeErrorInfo
    lastRuntimeErrorAt = Date.now()

    entry.mapped = await mapStackBearingError(entry)

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

  function scheduleResetAfterRefresh() {
    if (
      !shouldResetOnRefresh ||
      state.errors.length === 0 ||
      Date.now() - lastRuntimeErrorAt < minResetAfterErrorMs
    ) {
      return
    }

    if (resetAfterRefreshTimer) {
      clearTimeout(resetAfterRefreshTimer)
    }

    resetAfterRefreshTimer = setTimeout(() => {
      resetAfterRefreshTimer = null
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          reset()
        })
      })
    }, 0)
  }

  function onError(event: ErrorEvent) {
    void recordError(fromErrorEvent(event))
  }

  function onUnhandledRejection(event: PromiseRejectionEvent) {
    void recordError(fromUnhandledRejection(event))
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
    if (resetAfterRefreshTimer) {
      clearTimeout(resetAfterRefreshTimer)
      resetAfterRefreshTimer = null
    }
    delete (window as any)[symbol]
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)
  window.addEventListener('message', onMessage)
  patchWebSocketForRefresh()

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
    const frames = parseStack(error.stack)

    return {
      message: error.message,
      stack: error.stack,
      frames,
      mappedFrames: frames.length > 0 ? await mapStackFrames(frames) : [],
    }
  }

  async function mapStackFrames(frames: StackFrame[]) {
    try {
      const response = await fetch('/__nextjs_original-stack-frames', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          frames,
          isServer: false,
          isEdgeServer: false,
          isAppDirectory,
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

  function safeStringify(value: unknown) {
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }

  function patchWebSocketForRefresh() {
    if (!shouldResetOnRefresh || !(window as any).WebSocket) {
      return
    }

    const nativeWebSocket = window.WebSocket
    if ((nativeWebSocket as any).__nextDevBridgeRuntimePatched) {
      return
    }

    function NextDevBridgeRuntimeWebSocket(
      this: WebSocket,
      url: string | URL,
      protocols?: string | string[]
    ) {
      const socket =
        protocols === undefined
          ? new nativeWebSocket(url)
          : new nativeWebSocket(url, protocols)
      const urlText = String(url)
      const isNextHmr =
        urlText.includes('/_next/webpack-hmr') ||
        urlText.includes('/_next/turbopack-hmr') ||
        urlText.includes('__webpack_hmr')

      if (isNextHmr) {
        socket.addEventListener('message', (event) => {
          if (typeof event.data !== 'string') {
            return
          }

          try {
            const payload = JSON.parse(event.data)
            const isSettled = payload?.type === 'built'
            const hasErrors =
              Array.isArray(payload?.errors) && payload.errors.length > 0

            if (isSettled && !hasErrors) {
              scheduleResetAfterRefresh()
            }
          } catch {}
        })
      }

      return socket
    }

    NextDevBridgeRuntimeWebSocket.prototype = nativeWebSocket.prototype
    Object.assign(NextDevBridgeRuntimeWebSocket, nativeWebSocket)
    ;(NextDevBridgeRuntimeWebSocket as any).__nextDevBridgeRuntimePatched = true
    window.WebSocket = NextDevBridgeRuntimeWebSocket as any
  }
}
