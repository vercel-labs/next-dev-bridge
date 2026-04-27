export const NEXT_DEV_BRIDGE_HIDE_NEXT_PORTAL = `nextjs-portal {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}`

export function installNextPortalGuard() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  if (window.__NEXT_DEV_BRIDGE_HIDE_NEXT_PORTAL_GUARD__) {
    window.__NEXT_DEV_BRIDGE_HIDE_NEXT_PORTAL_GUARD__.apply()
    return
  }

  let pending = false

  function ensureNextPortalStyle() {
    const head = document.head || document.getElementsByTagName('head')[0]

    if (!head) {
      return
    }

    let style =
      document.getElementById('next-dev-bridge-hide-nextjs-portal') ||
      document.getElementById('next-dev-bridge-hide-nextjs-portal-server') ||
      document.getElementById('next-dev-bridge-hide-nextjs-portal-runtime-style')

    if (!style) {
      style = document.createElement('style')
      style.id = 'next-dev-bridge-hide-nextjs-portal-runtime-style'
      style.setAttribute('data-next-dev-bridge', 'hide-nextjs-portal')
      head.appendChild(style)
    }

    if (style.textContent !== NEXT_DEV_BRIDGE_HIDE_NEXT_PORTAL) {
      style.textContent = NEXT_DEV_BRIDGE_HIDE_NEXT_PORTAL
    }
  }

  function hideNextPortals() {
    const portals = document.getElementsByTagName('nextjs-portal')

    for (let index = 0; index < portals.length; index += 1) {
      portals[index].style.setProperty('display', 'none', 'important')
      portals[index].style.setProperty('visibility', 'hidden', 'important')
      portals[index].style.setProperty('opacity', '0', 'important')
      portals[index].style.setProperty('pointer-events', 'none', 'important')
    }
  }

  function apply() {
    ensureNextPortalStyle()
    hideNextPortals()
  }

  function scheduleApply() {
    if (pending) {
      return
    }

    pending = true

    const run = () => {
      pending = false
      apply()
    }

    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(run)
    } else {
      window.setTimeout(run, 16)
    }
  }

  let observer = null

  apply()

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true })
  }

  if (window.MutationObserver) {
    observer = new MutationObserver(scheduleApply)
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    })
  }

  const intervalId = window.setInterval(apply, 1000)

  window.__NEXT_DEV_BRIDGE_HIDE_NEXT_PORTAL_GUARD__ = {
    apply,
    cleanup() {
      observer?.disconnect()
      window.clearInterval(intervalId)
      delete window.__NEXT_DEV_BRIDGE_HIDE_NEXT_PORTAL_GUARD__
    },
  }
}
