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
`next dev`, create a Vercel project from the repository root:

```text
Root Directory: repo root (leave empty in Vercel)
Framework Preset: Next.js
Install Command: bun install && bun x --no-install tsc -p tsconfig.json && bun install --cwd examples/next-dev-bridge-web
Build Command: bun run --cwd examples/next-dev-bridge-web build
Output Directory: examples/next-dev-bridge-web/.next
```

The repository root includes a `vercel.json` with those settings. The project
must use the repository root as its Vercel Root Directory because the web app
depends on `next-dev-bridge` through `file:../..`. If the Root Directory is
`examples/next-dev-bridge-web`, Vercel will not allow the build to read
`../..`, and Bun cannot install the local package.

The install command installs the library dependencies, builds the library
`dist/` output, and then installs the web app so Bun can copy the local
`next-dev-bridge` package into the web app's `node_modules`.

No extra environment variable is required for the default Vercel deployment.
When `VERCEL` is defined, the viewer API routes use Sandbox mode automatically.

On first load, the deployed viewer creates an empty Vercel Sandbox, writes the
library package to the sandbox root and the bundled `preview-fixture` files to
`preview/`, runs `npm install && npm run build` for the library, installs the
preview fixture with `next-dev-bridge` resolved through `file:..`, starts that
fixture in Next dev mode through `dev-server.cjs`, and points the iframe at the
sandbox URL.

For non-Vercel testing, `NEXT_DEV_BRIDGE_CONTROL_MODE=sandbox` still forces
Sandbox mode, and `NEXT_DEV_BRIDGE_CONTROL_MODE=local` forces local preview mode.
