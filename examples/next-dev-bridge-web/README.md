# next-dev-bridge web example

Run the example with:

```bash
bun run example:web
```

Open `http://localhost:3000`.

The command starts three local processes:

- Next viewer app on `http://localhost:3000`.
- Next preview app on `http://localhost:3001`.
- next-dev-bridge control server on `http://localhost:3010`.

The control server owns file edits and the `next-dev-bridge` HMR subscription, so the UI
can still recover the preview app after an intentional compile error. The viewer
loads the preview app in an iframe. The preview app hides its own Next dev
overlay and devtools indicator so cross-origin iframe restrictions do not block
the UI.
