import './globals.css'

import { createRuntimeErrorObserverScript } from 'next-dev-bridge/client'

const HIDE_NEXT_PORTAL = `nextjs-portal {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}`
const STACK_FRAME_PROXY_ENDPOINT = '/api/next-dev-bridge-stack-frames'
const SOURCE_MAP_FRAME_ROOT = `${process.cwd()}/.next/dev/static`
const STACK_FRAME_PROXY_SCRIPT = createStackFrameProxyScript(
  STACK_FRAME_PROXY_ENDPOINT,
  SOURCE_MAP_FRAME_ROOT
)

const RUNTIME_ERROR_OBSERVER_SCRIPT = createRuntimeErrorObserverScript({
  minResetAfterErrorMs: 1000,
  sourceMapEndpoint: STACK_FRAME_PROXY_ENDPOINT,
  sourceMapFrameRoot: SOURCE_MAP_FRAME_ROOT,
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
        {STACK_FRAME_PROXY_SCRIPT ? (
          <script
            id="next-dev-bridge-stack-frame-proxy"
            dangerouslySetInnerHTML={{ __html: STACK_FRAME_PROXY_SCRIPT }}
          />
        ) : null}
        <script
          id="next-dev-bridge-runtime-error-observer"
          dangerouslySetInnerHTML={{ __html: RUNTIME_ERROR_OBSERVER_SCRIPT }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}

function createStackFrameProxyScript(endpoint, frameRoot) {
  if (!endpoint) {
    return ''
  }

  return `;(function (endpoint, frameRoot) {
  var guard = '__NEXT_DEV_BRIDGE_STACK_FRAME_PROXY__'
  if (window[guard] || !window.fetch) {
    return
  }

  var nativeFetch = window.fetch.bind(window)
  window[guard] = true

  window.fetch = function nextDevBridgeFetch(input, init) {
    var url = typeof input === 'string' ? input : input && input.url
    if (
      url !== '/__nextjs_original-stack-frames' &&
      !String(url || '').endsWith('/__nextjs_original-stack-frames')
    ) {
      return nativeFetch(input, init)
    }

    var body = init && init.body
    if (typeof body !== 'string') {
      return nativeFetch(input, init)
    }

    try {
      var payload = JSON.parse(body)
      payload.frames = Array.isArray(payload.frames)
        ? payload.frames.map(normalizeFrame)
        : []
      payload.sourceOrigin = window.location.origin

      return nativeFetch(endpoint, {
        body: JSON.stringify(payload),
        cache: 'no-store',
        credentials: 'omit',
        method: 'POST',
        mode: 'cors',
      })
    } catch (error) {
      return nativeFetch(input, init)
    }
  }

  function normalizeFrame(frame) {
    if (!frame || typeof frame !== 'object') {
      return frame
    }

    var nextFrame = Object.assign({}, frame)
    nextFrame.file = normalizeFile(nextFrame.file)
    return nextFrame
  }

  function normalizeFile(file) {
    if (typeof file !== 'string' || !file) {
      return file
    }

    var nextAssetPath = getNextAssetPath(file)
    if (nextAssetPath) {
      return formatNextAssetFrameFile(nextAssetPath)
    }

    if (/^[a-zA-Z][a-zA-Z\\d+.-]*:/.test(file)) {
      return file
    }

    var normalizedFile = file.indexOf('_next/') === 0 ? '/' + file : file
    if (normalizedFile.indexOf('/_next/') === 0) {
      return formatNextAssetFrameFile(normalizedFile)
    }

    if (
      normalizedFile.indexOf('/') === -1 &&
      normalizedFile.slice(-3) === '.js' &&
      (normalizedFile.indexOf('_') === 0 ||
        normalizedFile.indexOf('._.') !== -1 ||
        normalizedFile.indexOf('node_modules_') === 0 ||
        normalizedFile.indexOf('turbopack-') === 0)
    ) {
      return formatNextAssetFrameFile('/_next/static/chunks/' + normalizedFile)
    }

    return file
  }

  function formatNextAssetFrameFile(nextAssetPath) {
    if (!frameRoot) {
      return nextAssetPath
    }

    return (
      String(frameRoot).replace(/\\/+$/, '') +
      '/' +
      nextAssetPath.replace(/^\\/_next\\/static\\/?/, '')
    )
  }

  function getNextAssetPath(file) {
    if (file.indexOf('/_next/') === 0) {
      return file
    }

    if (file.indexOf('_next/') === 0) {
      return '/' + file
    }

    try {
      var url = new URL(file)
      return url.pathname.indexOf('/_next/') === 0 ? url.pathname : ''
    } catch (error) {
      return ''
    }
  }
})(${JSON.stringify(endpoint)}, ${JSON.stringify(frameRoot)});`
}
