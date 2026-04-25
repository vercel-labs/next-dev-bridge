'use client'

import { useEffect } from 'react'

const DEV_UI_SELECTORS = [
  'nextjs-portal',
  'nextjs-toast',
  'nextjs-static-indicator-toast-wrapper',
  'nextjs-dev-tools-indicator',
  'script[data-nextjs-dev-overlay]',
  '#data-devtools-indicator',
  '#panel-route',
  '.dev-tools-indicator-menu',
  '.dev-tools-indicator-inner',
  '.dev-tools-indicator-item',
  '[data-nextjs-toast]',
  '[data-nextjs-dialog]',
  '[data-nextjs-dialog-overlay]',
  '[data-nextjs-error-overlay]',
  '[data-nextjs-dev-tools-button]',
  '[data-nextjs-dev-overlay]',
  '[data-nextjs-build-indicator]',
  '[data-nextjs-route-type]',
  '[data-segment-explorer]',
  '#__next-build-watcher',
  '#__next-prerender-indicator',
]

const HIDE_DEV_UI_CSS = `${DEV_UI_SELECTORS.join(',')} {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}`

export function DevUiHider() {
  useEffect(() => {
    const hide = () => {
      hideNextDevUi(document)

      for (const element of document.querySelectorAll('*')) {
        if (element.shadowRoot) {
          hideNextDevUi(element.shadowRoot)
        }
      }
    }

    hide()

    const observer = new MutationObserver(hide)
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    })

    const timer = setInterval(hide, 250)

    return () => {
      observer.disconnect()
      clearInterval(timer)
    }
  }, [])

  return null
}

function hideNextDevUi(root) {
  installHideStyle(root)

  const selector = DEV_UI_SELECTORS.join(',')
  for (const node of root.querySelectorAll(selector)) {
    node.setAttribute('data-nextd-hidden-dev-ui', 'true')
    node.style.setProperty('display', 'none', 'important')
    node.style.setProperty('visibility', 'hidden', 'important')
    node.style.setProperty('opacity', '0', 'important')
    node.style.setProperty('pointer-events', 'none', 'important')
  }
}

function installHideStyle(root) {
  if (root.getElementById?.('nextd-hide-dev-ui')) {
    return
  }

  const style = document.createElement('style')
  style.id = 'nextd-hide-dev-ui'
  style.textContent = HIDE_DEV_UI_CSS
  const target = root.head || root.documentElement || root
  target.appendChild(style)
}
