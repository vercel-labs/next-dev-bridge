import {
  processHMR,
  type NextDevBridgeState,
  type ProcessHMREvent,
} from './processor.js'
import {
  observeRuntimeErrors,
  type RuntimeErrorEvent,
  type RuntimeErrorObserver,
  type RuntimeErrorObserverOptions,
  type RuntimeErrorState,
} from './runtime.js'

export type NextDevBridgeClientEvent = ProcessHMREvent | RuntimeErrorEvent

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
  const handleHMR = processHMR({
    now: options.now,
    raw: options.raw,
    verbose: options.verbose,
  })
  const runtime = observeRuntimeErrors(
    (event) => {
      emit(event)
    },
    {
      now: options.now,
      sourceMap: options.sourceMap,
    }
  )

  if (typeof window === 'undefined' || !window.WebSocket) {
    return createClientObserver(handleHMR, runtime, () => {})
  }

  const NativeWebSocket = window.WebSocket
  const rewriteWebSocketURL = options.rewriteWebSocketURL || ((url) => url)
  const hmrPaths = [
    '/_next/webpack-hmr',
    '/_next/turbopack-hmr',
    '__webpack_hmr',
  ]
  let stopped = false

  function emit(event: NextDevBridgeClientEvent) {
    if (!stopped) {
      listener(event, getSnapshot())
    }
  }

  function getSnapshot(): NextDevBridgeClientState {
    return {
      build: handleHMR.getSnapshot(),
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
      socket.addEventListener('message', (message) => {
        if (typeof message.data !== 'string') {
          return
        }

        const { events } = handleHMR(message.data)
        for (const event of events) {
          emit(event)
        }
      })
    }

    return socket
  }

  NextDevBridgeWebSocket.prototype = NativeWebSocket.prototype
  Object.assign(NextDevBridgeWebSocket, NativeWebSocket)
  window.WebSocket = NextDevBridgeWebSocket as unknown as typeof WebSocket

  return createClientObserver(handleHMR, runtime, () => {
    stopped = true
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
