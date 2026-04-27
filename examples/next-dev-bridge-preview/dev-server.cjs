#!/usr/bin/env node
'use strict'

const http = require('node:http')
const next = require('next')

const HIDE_NEXT_PORTAL = `nextjs-portal {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}`
const HIDE_NEXT_PORTAL_STYLE = `<style id="next-dev-bridge-hide-nextjs-portal-server">${HIDE_NEXT_PORTAL}</style>`
const HIDE_NEXT_PORTAL_SCRIPT = `<script id="next-dev-bridge-hide-nextjs-portal-server-script">${createHideNextPortalScript()}</script>`
const HIDE_NEXT_PORTAL_INJECTION = `${HIDE_NEXT_PORTAL_STYLE}${HIDE_NEXT_PORTAL_SCRIPT}`
const APP_ROUTER_PORTAL_MARKERS = [
  'id="next-dev-bridge-hide-nextjs-portal"',
  'id="next-dev-bridge-runtime-error-observer"',
]

const port = Number(readArg(['-p', '--port'], process.env.PORT || 3000))
const hostname = readArg(
  ['-H', '--hostname'],
  process.env.HOSTNAME || process.env.HOST || '0.0.0.0'
)

let handle = (_request, response) => {
  response.statusCode = 503
  response.end('Next dev server is starting.')
}

const server = http.createServer((request, response) => {
  request.headers['accept-encoding'] = 'identity'
  injectNextPortalStyle(response)
  handle(request, response)
})
const app = next({
  dev: true,
  dir: __dirname,
  hostname,
  httpServer: server,
  port,
})

app
  .prepare()
  .then(() => {
    handle = app.getRequestHandler()

    server.listen(port, hostname, () => {
      console.log(`> Ready on http://${hostname}:${port}`)
    })
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })

function injectNextPortalStyle(response) {
  const write = response.write.bind(response)
  const writeHead = response.writeHead.bind(response)
  const setHeader = response.setHeader.bind(response)
  const end = response.end.bind(response)
  const chunks = []
  let passthrough = false

  response.setHeader = function patchedSetHeader(name, value) {
    if (String(name).toLowerCase() === 'content-length') {
      return response
    }

    return setHeader(name, value)
  }

  response.writeHead = function patchedWriteHead(
    statusCode,
    statusMessage,
    headers
  ) {
    if (typeof statusMessage === 'object' && statusMessage !== null) {
      headers = statusMessage
      statusMessage = undefined
    }

    if (headers) {
      delete headers['content-length']
      delete headers['Content-Length']
    }

    if (headers === undefined && statusMessage === undefined) {
      return writeHead(statusCode)
    }

    return statusMessage === undefined
      ? writeHead(statusCode, headers)
      : writeHead(statusCode, statusMessage, headers)
  }

  response.write = function patchedWrite(chunk, encoding, callback) {
    if (typeof encoding === 'function') {
      callback = encoding
      encoding = undefined
    }

    if (shouldPassThrough(chunk)) {
      passthrough = true
      return write(chunk, encoding, callback)
    }

    chunks.push(toBuffer(chunk, encoding))
    callback?.()
    return true
  }

  response.end = function patchedEnd(chunk, encoding, callback) {
    if (typeof encoding === 'function') {
      callback = encoding
      encoding = undefined
    }

    if (passthrough) {
      return end(chunk, encoding, callback)
    }

    if (chunk !== undefined && chunk !== null) {
      chunks.push(toBuffer(chunk, encoding))
    }

    const text = Buffer.concat(chunks).toString('utf8')
    const contentType = String(response.getHeader('content-type') || '')
    const looksLikeHtml =
      contentType.includes('text/html') ||
      /^\s*<!doctype html/i.test(text) ||
      /^\s*<html/i.test(text)

    const nextText = shouldInjectIntoHtml(text, looksLikeHtml)
      ? text.replace(/<head([^>]*)>/i, `<head$1>${HIDE_NEXT_PORTAL_INJECTION}`)
      : text

    if (nextText !== text && !response.headersSent) {
      response.removeHeader('content-length')
    }

    return end(nextText, encoding, callback)
  }

  function shouldPassThrough(chunk) {
    const contentType = String(response.getHeader('content-type') || '')

    return Boolean(
      chunk &&
        contentType &&
        !contentType.includes('text/html') &&
        !contentType.startsWith('text/plain')
    )
  }

  function toBuffer(chunk, encoding) {
    if (Buffer.isBuffer(chunk)) {
      return chunk
    }

    if (ArrayBuffer.isView(chunk)) {
      return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    }

    if (chunk instanceof ArrayBuffer) {
      return Buffer.from(chunk)
    }

    return Buffer.from(String(chunk), encoding || 'utf8')
  }
}

function shouldInjectIntoHtml(text, looksLikeHtml) {
  return (
    looksLikeHtml &&
    text.includes('<head') &&
    !text.includes('id="next-dev-bridge-hide-nextjs-portal-server"') &&
    !APP_ROUTER_PORTAL_MARKERS.some((marker) => text.includes(marker))
  )
}

function createHideNextPortalScript() {
  return `(function () {
  if (window.__NEXT_DEV_BRIDGE_HIDE_NEXT_PORTAL_GUARD__) {
    window.__NEXT_DEV_BRIDGE_HIDE_NEXT_PORTAL_GUARD__.apply()
    return
  }

  var css = ${JSON.stringify(HIDE_NEXT_PORTAL)}
  var pending = false

  function ensureStyle() {
    var head = document.head || document.getElementsByTagName('head')[0]

    if (!head) {
      return
    }

    var style =
      document.getElementById('next-dev-bridge-hide-nextjs-portal') ||
      document.getElementById('next-dev-bridge-hide-nextjs-portal-server') ||
      document.getElementById('next-dev-bridge-hide-nextjs-portal-runtime-style')

    if (!style) {
      style = document.createElement('style')
      style.id = 'next-dev-bridge-hide-nextjs-portal-runtime-style'
      style.setAttribute('data-next-dev-bridge', 'hide-nextjs-portal')
      head.appendChild(style)
    }

    if (style.textContent !== css) {
      style.textContent = css
    }
  }

  function hidePortals() {
    var portals = document.getElementsByTagName('nextjs-portal')

    for (var index = 0; index < portals.length; index += 1) {
      portals[index].style.setProperty('display', 'none', 'important')
      portals[index].style.setProperty('visibility', 'hidden', 'important')
      portals[index].style.setProperty('opacity', '0', 'important')
      portals[index].style.setProperty('pointer-events', 'none', 'important')
    }
  }

  function apply() {
    ensureStyle()
    hidePortals()
  }

  function scheduleApply() {
    if (pending) {
      return
    }

    pending = true
    var run = function () {
      pending = false
      apply()
    }

    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(run)
    } else {
      window.setTimeout(run, 16)
    }
  }

  apply()

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true })
  }

  var observer = null

  if (window.MutationObserver) {
    observer = new MutationObserver(scheduleApply)
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    })
  }

  var intervalId = window.setInterval(apply, 1000)

  window.__NEXT_DEV_BRIDGE_HIDE_NEXT_PORTAL_GUARD__ = {
    apply: apply,
    cleanup: function () {
      if (observer) {
        observer.disconnect()
      }
      window.clearInterval(intervalId)
      delete window.__NEXT_DEV_BRIDGE_HIDE_NEXT_PORTAL_GUARD__
    },
  }
})()`
}

function readArg(names, fallback) {
  for (let index = 0; index < process.argv.length; index += 1) {
    if (names.includes(process.argv[index]) && process.argv[index + 1]) {
      return process.argv[index + 1]
    }
  }

  return fallback
}
