import './globals.css'

import { createRuntimeErrorObserverScript } from 'next-dev-bridge/client'

const HIDE_NEXT_PORTAL = `nextjs-portal {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}`

const RUNTIME_ERROR_OBSERVER_SCRIPT = createRuntimeErrorObserverScript({
  minResetAfterErrorMs: 1000,
})

export const metadata = {
  title: 'next-dev-bridge Preview App',
  description: 'Preview app intentionally edited by the next-dev-bridge web example.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <style
          id="next-dev-bridge-hide-nextjs-portal"
          dangerouslySetInnerHTML={{ __html: HIDE_NEXT_PORTAL }}
        />
        <script
          id="next-dev-bridge-runtime-error-observer"
          dangerouslySetInnerHTML={{ __html: RUNTIME_ERROR_OBSERVER_SCRIPT }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
