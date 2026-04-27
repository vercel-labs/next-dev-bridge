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

## Vercel + Sandbox

To deploy the viewer app on Vercel while still running the preview app with
`next dev`, create a Vercel project with:

```text
Root Directory: examples/next-dev-bridge-web
Framework Preset: Next.js
Build Command: default
Output Directory: default
```

No extra environment variable is required for the default Vercel deployment.
When `VERCEL` is defined, the viewer API routes use Sandbox mode automatically.

On first load, the deployed viewer creates an empty Vercel Sandbox, writes the
bundled `preview-fixture` files into it, runs `npm install`, starts that fixture
in Next dev mode through `dev-server.cjs`, and points the iframe at the sandbox
URL.

For non-Vercel testing, `NEXT_DEV_BRIDGE_CONTROL_MODE=sandbox` still forces
Sandbox mode, and `NEXT_DEV_BRIDGE_CONTROL_MODE=local` forces local preview mode.
