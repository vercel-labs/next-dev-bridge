# next-dev-bridge API

`next-dev-bridge` exposes browser APIs, a CLI, and a Node API for the common
paths:

```ts
import { observeNextDev } from 'next-dev-bridge/client'
import { connect } from 'next-dev-bridge'
```

Use `observeNextDev()` from `next-dev-bridge/client` inside the preview browser
or iframe. It provides one event stream for connection, build, and runtime
state, including a browser fallback for older Next.js releases. Use the CLI for
a quick terminal view. Use `connect()` from `next-dev-bridge` in Node when
another process needs to attach to a running Next dev server.

## observeNextDev

```ts
const observer = observeNextDev(listener, options)
```

`observeNextDev()` is the preferred browser API. It wraps the existing Next HMR
WebSocket and emits normalized connection, build, and runtime events. When Next
publishes a `runtimeErrors` message, the bridge uses its formatted stack and
boundary metadata. Browser error listeners remain as an automatic fallback for
Next versions that do not publish this message.

```ts
import { observeNextDev } from 'next-dev-bridge/client'

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
        type: 'next-dev-bridge:event',
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

For iframe runtimes that rewrite websocket URLs, pass `rewriteWebSocketURL` and let next-dev-bridge process the rewritten socket messages:

```ts
observeNextDev(listener, {
  rewriteWebSocketURL(url) {
    return rewriteToSandboxWebSocket(url)
  },
})
```

## Iframe integration

An iframe shell can forward normalized events and state to its parent while
letting `observeNextDev()` own HMR message processing, connection observation,
and browser runtime error capture.

```ts
import { observeNextDev } from 'next-dev-bridge/client'

type ParentMessage = Record<string, unknown>

interface FrameObserverOptions {
  rewriteWebSocketURL?: (url: string | URL) => string | URL
  sendToParent?: (message: ParentMessage) => void
}

export function installFrameObserver(
  options: FrameObserverOptions = {}
) {
  const sendToParent =
    options.sendToParent ||
    ((message) => {
      window.parent.postMessage(message, '*')
    })

  return observeNextDev(
    (event, state) => {
      sendToParent({
        type: 'next-dev-bridge:event',
        event,
        state,
      })
    },
    {
      rewriteWebSocketURL: options.rewriteWebSocketURL,
    }
  )
}
```

## processHMR

```ts
const handleHMR = processHMR(options)
const result = handleHMR(rawMessage, listener)
```

`processHMR()` is the lower-level HMR processor used by `observeNextDev()`. Use it only when you already own websocket interception and do not want next-dev-bridge to install runtime error listeners.

```ts
import { processHMR } from 'next-dev-bridge/client'

const handleHMR = processHMR()

ws.addEventListener('message', (messageEvent) => {
  const { events, state } = handleHMR(messageEvent.data)

  for (const event of events) {
    window.parent.postMessage(
      {
        type: 'next-dev-bridge:event',
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
import { observeRuntimeErrors } from 'next-dev-bridge/client'

const runtime = observeRuntimeErrors(
  (event, state) => {
    window.parent.postMessage(
      {
        type: 'next-dev-bridge:runtime',
        event,
        state,
      },
      '*'
    )
  },
  {
    sourceMap: {
      endpoint: '/__nextjs_original-stack-frames',
    },
  }
)

runtime.reset()
runtime.stop()
```

Runtime errors use a separate HMR `runtimeErrors` message rather than the
build messages. In a Next preview iframe, prefer `observeNextDev()` when you
need both build and runtime events.

`observeRuntimeErrors()` captures `window.error` and `unhandledrejection`.
`observeNextDev()` combines that fallback with incoming `runtimeErrors` HMR
messages. Next-provided errors use `source: 'nextjs'`, retain optional boundary
metadata, and map Next's reported `fatal` value to `isFatal`.

Source mapping is opt-in. Pass `sourceMap` to send captured stack frames to
Next.js for decoding. Omit `sourceMap`, or pass `sourceMap: false`, to capture
runtime errors without making source-map requests.

Each error also carries a `severity` field. For Next HMR runtime state, the
reported `fatal` boolean maps directly to `isFatal` and to either
`severity: 'fatal'` or `severity: 'recoverable'`; boundary metadata is preserved
when present. Browser fallback errors use `isFatal: false` because older Next
versions do not expose whether the UI was replaced. An empty HMR snapshot emits
`runtime:cleared`, but the transport-level clear does not by itself confirm a
successful application render.

For iframe injection where you need a plain script instead of a bundled client
module, use `createRuntimeErrorObserverScript()`:

```ts
import { createRuntimeErrorObserverScript } from 'next-dev-bridge/client'

const script = createRuntimeErrorObserverScript({
  sourceMapEndpoint: '/__nextjs_original-stack-frames',
  targetOrigin: 'https://your-parent-app.test',
})
```

The script posts `next-dev-bridge:runtime`, `next-dev-bridge:runtime-ready`, and listens for `next-dev-bridge:runtime-reset`. Omit `sourceMapEndpoint` to skip source-map requests from the self-contained script. This standalone observer uses browser error events; use `observeNextDev()` when HMR fatality is required.

When source mapping is enabled, next-dev-bridge sends captured runtime stack frames to Next.js and uses the decoded frames when Next can resolve them. If Next returns generated chunk frames, next-dev-bridge tries alternate generated frame file shapes before falling back to the last response.

## CLI

Start your Next.js app first:

```sh
next dev
```

Then observe it with `connect-next`:

```sh
connect-next http://localhost:3000
```

Useful options:

```sh
connect-next 3000
connect-next observe http://localhost:3000 --verbose
connect-next http://localhost:3000 --no-reconnect
```

The CLI attaches to the running dev server. It does not start Next.js for you.

## connect

```ts
const connection = connect(next, options, listener)
```

`connect()` opens the Next dev websocket and processes incoming HMR messages.
It always recognizes runtime snapshots: newer Next.js versions therefore emit
`runtime:error` and `runtime:cleared` without browser injection, while older
versions continue emitting the existing build and session events. No version
configuration is required.

```ts
import { connect } from 'next-dev-bridge'

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

## Events

Common event types:

```ts
'build:started'
'build:ready'
'build:error'
'build:recovered'
'runtime:error'
'runtime:cleared'
'observer:error'
'session:connecting'
'session:connected'
'session:disconnected'
'session:reconnected'
'session:error'
```

`observeNextDev()` emits connection, build, observer, and runtime events.
`processHMR()` emits build and observer events. `connect()` emits session and
build events, and also runtime events whenever they are present on the Next.js
HMR stream.

Next's `building` signal becomes `build:started`. It can represent route or
request work in addition to source edits, so consumers should use it as a
compilation-state transition rather than proof that a file changed.

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
  build: NextDevBridgeState,
  runtime: {
    errors: RuntimeErrorInfo[],
  },
}
```
