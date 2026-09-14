import {
  processHMR,
  type NextDevBridgeState,
  type ProcessHMREvent,
} from './processor.js'
import {
  createRuntimeErrorObserver,
  type RuntimeErrorEvent,
  type RuntimeErrorObserver,
  type RuntimeErrorObserverOptions,
  type RuntimeErrorState,
} from './runtime.js'

export type NextDevBridgeClientSessionEvent =
  | { type: 'session:connecting'; url: string; attempt: number }
  | { type: 'session:connected'; url: string; attempt: number }
  | {
      type: 'session:reconnected'
      url: string
      attempt: number
      missedUpdates: boolean
    }
  | {
      type: 'session:disconnected'
      url: string
      attempt: number
      opened: boolean
      code: number
      reason: string
      wasClean: boolean
    }

export type NextDevBridgeClientEvent =
  | ProcessHMREvent
  | RuntimeErrorEvent
  | NextDevBridgeClientSessionEvent

export interface NextDevBridgeClientState {
  build: NextDevBridgeState
  runtime: RuntimeErrorState
}

export type NextDevBridgeClientEventListener = (
  event: NextDevBridgeClientEvent,
  state: NextDevBridgeClientState
) => void

export interface ObserveNextDevOptions
  extends Pick<RuntimeErrorObserverOptions, 'sourceMap'> {
  now?: () => Date | number | string
  raw?: boolean
  verbose?: boolean
  rewriteWebSocketURL?: (url: string | URL) => string | URL
}

export interface NextDevBridgeClientObserver {
  stop(): void
  getSnapshot(): NextDevBridgeClientState
  reset(): NextDevBridgeClientState
}

export function observeNextDev(
  listener: NextDevBridgeClientEventListener,
  options: ObserveNextDevOptions = {}
): NextDevBridgeClientObserver {
  let connection: NextDevBridgeState['connection'] = 'idle'
  const handleHMR = processHMR({
    now: options.now,
    raw: options.raw,
    verbose: options.verbose,
  })
  const runtime = createRuntimeErrorObserver(
    (event) => {
      emit(event)
    },
    {
      now: options.now,
      preferHMR: true,
      sourceMap: options.sourceMap,
    }
  )

  if (typeof window === 'undefined' || !window.WebSocket) {
    return createClientObserver(handleHMR, runtime, () => {})
  }

  const NativeWebSocket = window.WebSocket
  const rewriteWebSocketURL = options.rewriteWebSocketURL || ((url) => url)
  const hmrPaths = [
    '/_next/hmr',
    '/_next/webpack-hmr',
    '/_next/turbopack-hmr',
    '__webpack_hmr',
  ]
  let stopped = false
  let hmrAttempt = 0
  let hmrHasConnected = false
  let networkChangedSinceClose = false

  function markNetworkChanged() {
    networkChangedSinceClose = true
  }

  window.addEventListener('offline', markNetworkChanged)
  window.addEventListener('online', markNetworkChanged)

  function emit(event: NextDevBridgeClientEvent) {
    if (!stopped) {
      listener(event, getSnapshot())
    }
  }

  function getSnapshot(): NextDevBridgeClientState {
    const build = handleHMR.getSnapshot()
    build.connection = connection
    return {
      build,
      runtime: runtime.getSnapshot(),
    }
  }

  function isNextHMRSocket(url: string) {
    return hmrPaths.some((path) => url.includes(path))
  }

  function NextDevBridgeWebSocket(
    this: WebSocket,
    url: string | URL,
    protocols?: string | string[]
  ) {
    const originalURL = String(url)
    const rewrittenURL = rewriteWebSocketURL(url)
    const socket =
      protocols === undefined
        ? new NativeWebSocket(rewrittenURL)
        : new NativeWebSocket(rewrittenURL, protocols)

    if (isNextHMRSocket(originalURL) || isNextHMRSocket(String(rewrittenURL))) {
      hmrAttempt += 1
      const attempt = hmrAttempt
      const url = String(rewrittenURL)
      let opened = false

      connection = 'connecting'
      emit({ type: 'session:connecting', url, attempt })
      socket.addEventListener('open', () => {
        opened = true
        connection = 'connected'
        if (hmrHasConnected) {
          emit({
            type: 'session:reconnected',
            url,
            attempt,
            missedUpdates: networkChangedSinceClose,
          })
        } else {
          hmrHasConnected = true
          emit({ type: 'session:connected', url, attempt })
        }
        networkChangedSinceClose = false
      })
      socket.addEventListener('message', (message) => {
        if (typeof message.data !== 'string') {
          return
        }

        runtime.ingestHMR(message.data)
        const { events } = handleHMR(message.data)
        for (const event of events) {
          emit(event)
        }
      })
      socket.addEventListener('close', (event) => {
        connection = 'disconnected'
        if (opened && typeof navigator !== 'undefined' && !navigator.onLine) {
          networkChangedSinceClose = true
        }
        emit({
          type: 'session:disconnected',
          url,
          attempt,
          opened,
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        })
      })
    }

    return socket
  }

  NextDevBridgeWebSocket.prototype = NativeWebSocket.prototype
  Object.assign(NextDevBridgeWebSocket, NativeWebSocket)
  window.WebSocket = NextDevBridgeWebSocket as unknown as typeof WebSocket

  return createClientObserver(handleHMR, runtime, () => {
    stopped = true
    window.removeEventListener('offline', markNetworkChanged)
    window.removeEventListener('online', markNetworkChanged)
    if (window.WebSocket === (NextDevBridgeWebSocket as unknown as typeof WebSocket)) {
      window.WebSocket = NativeWebSocket
    }
  })

  function createClientObserver(
    hmr: typeof handleHMR,
    runtimeObserver: RuntimeErrorObserver,
    cleanup: () => void
  ): NextDevBridgeClientObserver {
    return {
      stop() {
        cleanup()
        runtimeObserver.stop()
      },
      getSnapshot,
      reset() {
        hmr.reset()
        runtimeObserver.reset()
        return getSnapshot()
      },
    }
  }
}
