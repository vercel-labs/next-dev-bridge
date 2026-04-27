import {
  processHMR,
  type NextoState,
  type ProcessHMREvent,
} from './processor.js'
import {
  observeRuntimeErrors,
  type RuntimeErrorEvent,
  type RuntimeErrorObserver,
  type RuntimeErrorObserverOptions,
  type RuntimeErrorState,
} from './runtime.js'

export type NextoClientEvent = ProcessHMREvent | RuntimeErrorEvent

export interface NextoClientState {
  build: NextoState
  runtime: RuntimeErrorState
}

export type NextoClientEventListener = (
  event: NextoClientEvent,
  state: NextoClientState
) => void

export interface ObserveNextDevOptions
  extends Pick<RuntimeErrorObserverOptions, 'dedupe'> {
  now?: () => Date | number | string
  raw?: boolean
  verbose?: boolean
  rewriteWebSocketURL?: (url: string | URL) => string | URL
}

export interface NextoClientObserver {
  stop(): void
  getSnapshot(): NextoClientState
  reset(): NextoClientState
}

export function observeNextDev(
  listener: NextoClientEventListener,
  options: ObserveNextDevOptions = {}
): NextoClientObserver {
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
      dedupe: options.dedupe,
      now: options.now,
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

  function emit(event: NextoClientEvent) {
    if (!stopped) {
      listener(event, getSnapshot())
    }
  }

  function getSnapshot(): NextoClientState {
    return {
      build: handleHMR.getSnapshot(),
      runtime: runtime.getSnapshot(),
    }
  }

  function isNextHMRSocket(url: string) {
    return hmrPaths.some((path) => url.includes(path))
  }

  function NextoWebSocket(
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

  NextoWebSocket.prototype = NativeWebSocket.prototype
  Object.assign(NextoWebSocket, NativeWebSocket)
  window.WebSocket = NextoWebSocket as unknown as typeof WebSocket

  return createClientObserver(handleHMR, runtime, () => {
    stopped = true
    if (window.WebSocket === (NextoWebSocket as unknown as typeof WebSocket)) {
      window.WebSocket = NativeWebSocket
    }
  })

  function createClientObserver(
    hmr: typeof handleHMR,
    runtimeObserver: RuntimeErrorObserver,
    cleanup: () => void
  ): NextoClientObserver {
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
