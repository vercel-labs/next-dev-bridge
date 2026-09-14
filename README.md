# next-dev-bridge

Bridge a running Next.js dev server to readable build/runtime state events.

`next-dev-bridge` is focused on the dev overlay use case: know when a Next app has build
errors, when those errors update, when they recover, and, in the browser, when
runtime errors happen. It normalizes the noisy HMR transport into a smaller set
of events that are easier to render in a CLI, iframe shell, or custom dev UI.

The observer supports the HMR endpoints used by Next.js 16.2 and 16.3, and
consumes richer runtime error state when it is available in newer releases.

## Install

```sh
npm install next-dev-bridge
```

The package is ESM and supports Node.js 18+.

For local development in this repo, use Bun:

```sh
bun install
bun run build
bun run test:unit
```

## CLI

Start your Next.js app first:

```sh
next dev
```

Then observe it with `connect-next`:

```sh
connect-next http://localhost:3000
```

The CLI attaches to the running dev server. It does not start Next.js for you.

Useful options:

```sh
connect-next 3000
connect-next observe http://localhost:3000 --verbose
connect-next http://localhost:3000 --no-reconnect
```

## Browser API

Use `observeNextDev()` inside the preview page or iframe when you need browser
runtime fallback for Next.js versions that do not publish runtime state over
HMR.

```ts
import { observeNextDev } from 'next-dev-bridge/client'

const observer = observeNextDev(
  (event, state) => {
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

Stop the browser observer when the host UI tears down the preview:

```ts
window.addEventListener('pagehide', () => {
  observer.stop()
})
```

When Next.js publishes `runtimeErrors` over HMR, next-dev-bridge uses that
source-mapped WebSocket state as the authoritative runtime source. It maps
Next's `fatal` boolean to `isFatal` and `severity` and also preserves Next's
boundary metadata. A `runtime:cleared` event means the producer's
reported snapshot is empty; it does not by itself prove that the application
rendered successfully. Older Next.js builds fall back to browser error events
and report `isFatal: false` because they do not expose boundary metadata.

For iframe runtimes that already rewrite websocket URLs, keep that rewrite and
pass it to next-dev-bridge:

```ts
observeNextDev(listener, {
  rewriteWebSocketURL(url) {
    return rewriteToSandboxWebSocket(url)
  },
})
```

## Lower-Level HMR Processor

Use `processHMR()` only when you already intercept Next.js HMR websocket
messages yourself and want next-dev-bridge to normalize them.

```ts
import { processHMR } from 'next-dev-bridge/client'

const handleHMR = processHMR()

ws.addEventListener('message', (messageEvent) => {
  const { events, state } = handleHMR(messageEvent.data)

  for (const event of events) {
    console.log(event.type, state.phase)
  }
})
```

Most browser integrations should use `observeNextDev()` instead.

## Node API

Use `connect()` when you want to observe a running Next.js dev server from Node.

```ts
import { connect } from 'next-dev-bridge'

const connection = connect(
  { url: 'http://localhost:3000' },
  { reconnect: true },
  (event, state) => {
    if (event.type === 'build:error') {
      console.log(`build errors: ${event.errors.length}`)
      console.log(event.errors[0])
    }

    if (event.type === 'build:recovered') {
      console.log('build recovered')
    }

    if (event.type === 'runtime:error') {
      console.log(event.error.isFatal, event.error.message)
    }
  }
)
```

`connect()` emits session events because it owns the websocket connection, plus
normalized build events from the Next.js HMR stream. It also emits runtime
events automatically when Next.js publishes them. Older versions send no such
message, so their existing build behavior is unchanged and browser integrations
can continue using `observeNextDev()` as a runtime fallback.

Stop the connection when your own process is shutting down:

```ts
process.once('SIGINT', () => {
  connection.stop()
  process.exit(130)
})
```

Common events:

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

## Examples

Runnable usage lives under [`examples/`](examples/). The repo includes a
test-oriented Next.js preview app and a local web shell that can apply edits,
show the preview in an iframe, and render next-dev-bridge events.

```sh
bun run example:web
```

The project website is a dependency-free static page in [`site/index.html`](site/index.html).
It does not run the example or start a Next.js application.

Run unit tests:

```sh
bun run test:unit
```

Run the full local test flow:

```sh
bun run test
```

## API Reference

See [docs/API.md](docs/API.md) for the full event shapes and integration notes.
