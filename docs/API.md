# nextd API

`nextd` exposes two runtime APIs:

```ts
import { connect, processHMR } from 'nextd'
```

Use `connect()` in Node to attach to a running Next dev server. Use `processHMR()` anywhere, including an iframe/browser websocket interception, to turn raw Next HMR messages into readable dev-state events.

## connect

```ts
const connection = connect(next, options, listener)
```

`connect()` opens the Next dev websocket, processes incoming HMR messages, and emits normalized events.

```ts
import { connect } from 'nextd'

const connection = connect(
  {
    url: 'http://localhost:3000',
    path: '/_next/webpack-hmr',
  },
  {
    reconnect: false,
  },
  (event, state) => {
    console.log(event.type, state.phase)
  }
)

connection.stop()
```

`next` can be a URL string or an object:

```ts
connect('http://localhost:3000', listener)

connect({
  url: 'http://localhost:3000',
  path: '/_next/webpack-hmr',
  id: 'optional-app-router-id',
  headers: { cookie: 'name=value' },
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

## processHMR

```ts
const handleHMR = processHMR(options)
const result = handleHMR(rawMessage, listener)
```

`processHMR()` is transport-independent. It does not open a websocket. It accepts raw HMR payloads as JSON strings or objects and returns normalized events plus the latest state.

```ts
import { processHMR } from 'nextd/processor'

const handleHMR = processHMR()

ws.addEventListener('message', (messageEvent) => {
  const { events, state } = handleHMR(messageEvent.data)

  for (const event of events) {
    window.parent.postMessage(
      {
        type: 'nextd:event',
        event,
        state,
      },
      '*'
    )
  }
})
```

This is the intended shape for iframe websocket interception, such as wrapping `window.WebSocket` and passing each Next HMR message into the returned function.

## Events

Common event types:

```ts
'build:compiling'
'build:ready'
'build:error'
'build:recovered'
'observer:error'
'session:connecting'
'session:connected'
'session:disconnected'
'session:error'
```

`processHMR()` only emits build and observer events. `connect()` also emits session events because it owns the websocket connection.

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

The `state` object tracks the current dev state:

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
