import './globals.css'

import { createRuntimeErrorObserverScript } from 'nexto/client'

const HIDE_NEXT_PORTAL = `nextjs-portal {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}`

const RUNTIME_ERROR_OBSERVER_SCRIPT = createRuntimeErrorObserverScript({
  minResetAfterErrorMs: 1000,
  sourceMap: true,
})

export const metadata = {
  title: 'nexto Preview App',
  description: 'Preview app intentionally edited by the nexto web example.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <style
          id="nexto-hide-nextjs-portal"
          dangerouslySetInnerHTML={{ __html: HIDE_NEXT_PORTAL }}
        />
        <script
          id="nexto-runtime-error-observer"
          dangerouslySetInnerHTML={{ __html: RUNTIME_ERROR_OBSERVER_SCRIPT }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
