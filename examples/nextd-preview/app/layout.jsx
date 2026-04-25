import './globals.css'
import { DevUiHider } from './dev-ui-hider'

const HIDE_NEXT_DEV_PORTAL = `nextjs-portal {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}`

const INSTALL_HIDE_NEXT_DEV_PORTAL = `(function () {
  var id = 'nextd-hide-nextjs-portal'
  if (document.getElementById(id)) return
  var style = document.createElement('style')
  style.id = id
  style.textContent = ${JSON.stringify(HIDE_NEXT_DEV_PORTAL)}
  document.head.appendChild(style)
})()`

export const metadata = {
  title: 'nextd Preview App',
  description: 'Preview app intentionally edited by the nextd web example.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <style
          id="nextd-hide-nextjs-portal"
          dangerouslySetInnerHTML={{ __html: HIDE_NEXT_DEV_PORTAL }}
        />
        <script
          dangerouslySetInnerHTML={{ __html: INSTALL_HIDE_NEXT_DEV_PORTAL }}
        />
      </head>
      <body>
        <DevUiHider />
        {children}
      </body>
    </html>
  )
}
