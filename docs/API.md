# nexto API

`nexto` exposes one Node API and one browser API for the common paths:

```ts
import { connect } from 'nexto'
import { observeNextDev } from 'nexto/client'
```

Use `connect()` from `nexto` in Node to attach to a running Next dev server. Use `observeNextDev()` from `nexto/client` inside the preview browser or iframe to observe HMR build state and browser runtime errors from one event stream.

## connect

```ts
const connection = connect(next, options, listener)
```

`connect()` opens the Next dev websocket, processes incoming HMR messages, and emits normalized events.

```ts
import { connect } from 'nexto'

const connection = connect(
  {
    url: 'http://localhost:3000',
  },
  {
    reconnect: false,
  },
  (event, state) => {
    console.log(event.type, state.phase)
  }
)
```

`next` can be a URL string or an object:

```ts
connect('http://localhost:3000', listener)

connect({
  url: 'http://localhost:3000',
})
```

`options` controls the connection, not the Next instance:

```ts
connect(next, {
  reconnect: true,
  maxReconnects: Infinity,
  verbose: false,
  raw: false,
})
```

The returned connection supports:

```ts
connection.getSnapshot()
connection.stop()
connection.on('event', listener)
```

Call `connection.stop()` when the owning process is shutting down or no longer
needs the observer:

```ts
process.once('SIGINT', () => {
  connection.stop()
  process.exit(130)
})
```

## observeNextDev

```ts
const observer = observeNextDev(listener, options)
```

`observeNextDev()` is the preferred browser API. It wraps the Next HMR websocket, installs browser runtime error listeners, and emits normalized build/runtime events. Runtime errors include decoded frames when Next.js can resolve them.

```ts
import { observeNextDev } from 'nexto/client'

const observer = observeNextDev(
  (event, state) => {
    if (event.type === 'build:error') {
      console.log(event.errors)
    }

    if (event.type === 'runtime:error') {
      console.log(event.error.message)
      console.log(event.error.mapped?.mappedFrames)
    }

    window.parent.postMessage(
      {
        type: 'nexto:event',
        event,
        state,
      },
      '*'
    )
  }
)
```

Call `observer.stop()` when the host UI tears down the preview:

```ts
window.addEventListener('pagehide', () => {
  observer.stop()
})
```

For iframe runtimes that rewrite websocket URLs, pass `rewriteWebSocketURL` and let nexto process the rewritten socket messages:

```ts
observeNextDev(listener, {
  rewriteWebSocketURL(url) {
    return rewriteToSandboxWebSocket(url)
  },
})
```

## v0 Frame Runtime

For the v0 frame runtime, keep the existing websocket URL rewrite and parent `postMessage` shape. Let `observeNextDev()` own HMR message processing and browser runtime error capture.

```ts
import { observeNextDev } from 'nexto/client'

type ParentMessage = Record<string, unknown>

interface FrameObserverOptions {
  rewriteWebSocketURL?: (url: string | URL) => string | URL
  sendToParent?: (message: ParentMessage) => void
}

export function installNextoFrameObserver(options: FrameObserverOptions = {}) {
  const sendToParent =
    options.sendToParent ||
    ((message) => {
      window.parent.postMessage({ __v0_remote__: 1, ...message }, '*')
    })

  return observeNextDev(
    (event, state) => {
      sendToParent({
        type: 'nexto:event',
        event,
        state,
      })

      // Optional compatibility bridge for an existing v0 parent listener.
      if (event.type === 'build:error') {
        sendToParent({ type: 'hmr_state', state: 'built', hasErrors: true })
      }

      if (event.type === 'build:ready' || event.type === 'build:recovered') {
        sendToParent({ type: 'hmr_state', state: 'built', hasErrors: false })
      }
    },
    {
      rewriteWebSocketURL: options.rewriteWebSocketURL,
    }
  )
}
```

In the v0 repo, this replaces the manual `hmr_state` JSON parsing inside the `WebSocket` patch. If the frame runtime already rewrites websocket URLs for a sandbox host, pass that rewrite as `rewriteWebSocketURL`.

## processHMR

```ts
const handleHMR = processHMR(options)
const result = handleHMR(rawMessage, listener)
```

`processHMR()` is the lower-level HMR processor used by `observeNextDev()`. Use it only when you already own websocket interception and do not want nexto to install runtime error listeners.

```ts
import { processHMR } from 'nexto/client'

const handleHMR = processHMR()

ws.addEventListener('message', (messageEvent) => {
  const { events, state } = handleHMR(messageEvent.data)

  for (const event of events) {
    window.parent.postMessage(
      {
        type: 'nexto:event',
        event,
        state,
      },
      '*'
    )
  }
})
```

Most browser integrations should use `observeNextDev()` instead of composing `processHMR()` manually.

## observeRuntimeErrors

```ts
const runtime = observeRuntimeErrors(listener, options)
```

`observeRuntimeErrors()` is the lower-level runtime-only observer used by `observeNextDev()`. Use it only when you do not need HMR build state.

```ts
import { observeRuntimeErrors } from 'nexto/client'

const runtime = observeRuntimeErrors(
  (event, state) => {
    window.parent.postMessage(
      {
        type: 'nexto:runtime',
        event,
        state,
      },
      '*'
    )
  }
)

runtime.reset()
runtime.stop()
```

Runtime errors are not carried by HMR build messages. In a Next preview iframe, prefer `observeNextDev()` when you need both build and runtime events.

For v0-style iframe injection where you need a plain script instead of a React component or bundled client module, use `createRuntimeErrorObserverScript()`:

```ts
import { createRuntimeErrorObserverScript } from 'nexto/client'

const script = createRuntimeErrorObserverScript({
  resetOnRefresh: true,
  targetOrigin: 'https://your-parent-app.test',
})
```

The script posts `nexto:runtime`, `nexto:runtime-ready`, and listens for `nexto:runtime-reset`. With `resetOnRefresh` enabled, it clears captured runtime errors after a successful iframe-side HMR refresh settles, matching Next's overlay behavior more closely than clearing from a parent-side build event.

nexto sends captured runtime stack frames to Next.js as-is and uses the decoded
frames when Next can resolve them.

## Events

Common event types:

```ts
'build:ready'
'build:error'
'build:recovered'
'runtime:error'
'runtime:cleared'
'observer:error'
'session:connecting'
'session:connected'
'session:disconnected'
'session:error'
```

`observeNextDev()` emits build, observer, and runtime events. `processHMR()` only emits build and observer events. `connect()` also emits session events because it owns the Node websocket connection.

Next's raw `building` signal is intentionally not emitted as a public event
because it is low-level and can fire for route/request work, not only meaningful
source changes. It still updates `state.phase` to `compiling` until the next
settled build message arrives.

Build settled events expose readable message arrays:

```ts
if (event.type === 'build:error') {
  console.log(event.errors.length)
  console.log(event.errors[0])
}

if (event.type === 'build:ready' || event.type === 'build:recovered') {
  console.log(event.warnings.length)
}
```

`connect()` and `processHMR()` expose the build state directly:

```ts
{
  connection: 'idle' | 'connecting' | 'connected' | 'disconnected',
  phase: 'idle' | 'compiling' | 'ok' | 'error',
  building: boolean,
  hasErrors: boolean,
  hash: string | null,
  errors: string[],
  warnings: string[],
  rawErrors: unknown[],
  rawWarnings: unknown[],
}
```

Use array lengths for counts:

```ts
const errorCount = state.errors.length
const warningCount = event.warnings.length
```

`observeNextDev()` groups browser state by source:

```ts
{
  build: NextoState,
  runtime: {
    errors: RuntimeErrorInfo[],
  },
}
```
