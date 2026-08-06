# next-dev-bridge web example

Run the example with:

```bash
bun run example:web
```

Open `http://localhost:3000`.

The command starts two local processes:

- Next viewer app on `http://localhost:3000`.
- Next preview app on `http://localhost:3001`, through
  `examples/next-dev-bridge-preview/dev-server.cjs`.

The viewer app owns the control API through its own `app/api/*` route handlers.
Those routes write test edits into the preview app and stream normalized
`next-dev-bridge` events to the browser. The viewer loads the preview app in an
iframe. The preview app hides its own Next dev overlay and devtools indicator so
cross-origin iframe restrictions do not block the UI.

The preview should not be started with plain `next dev` when testing the iframe
error UI. Use `bun run example:web`, or start the preview manually with:

```bash
cd examples/next-dev-bridge-preview
node dev-server.cjs -p 3001 -H 127.0.0.1
```

The wrapper still runs Next in dev mode, but it can inject the portal-hiding
style into Next's internal compiler-error HTML before the iframe receives it.

This is a development example, not the project website. The public site is the
dependency-free [`site/index.html`](../../site/index.html); it does not start a
Next.js server, create a sandbox, or run this viewer.

Set `NEXT_DEV_BRIDGE_CONTROL_MODE=sandbox` to exercise Sandbox mode locally, or
`NEXT_DEV_BRIDGE_CONTROL_MODE=local` to force the default local preview mode.
