# next-dev-bridge web example

Run the example with:

```bash
bun run example:web
```

Open `http://localhost:3000`.

The command starts two local processes:

- Next viewer app on `http://localhost:3000`.
- Next preview app on `http://localhost:3001`.

The viewer app owns the control API through its own `app/api/*` route handlers.
Those routes write test edits into the preview app and stream normalized
`next-dev-bridge` events to the browser. The viewer loads the preview app in an
iframe. The preview app hides its own Next dev overlay and devtools indicator so
cross-origin iframe restrictions do not block the UI.

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
with `next dev`, and points the iframe at the sandbox URL.

For non-Vercel testing, `NEXT_DEV_BRIDGE_CONTROL_MODE=sandbox` still forces
Sandbox mode, and `NEXT_DEV_BRIDGE_CONTROL_MODE=local` forces local preview mode.
