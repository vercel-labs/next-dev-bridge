#!/usr/bin/env node
'use strict'

const http = require('node:http')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  applyScenario,
  getScenarioPayloads,
  writeScenarioFile,
} = require('../next-dev-bridge-preview/scenarios.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const PORT = Number(process.env.NEXT_DEV_BRIDGE_CONTROL_PORT || 3010)
const HOST = process.env.NEXT_DEV_BRIDGE_CONTROL_HOST || '127.0.0.1'
const TARGET_URL = process.env.NEXT_DEV_BRIDGE_TARGET_URL || 'http://127.0.0.1:3001'

let nextDevBridgePromise = null

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host}`)

  try {
    if (req.method === 'GET' && url.pathname === '/api/test-edits') {
      sendJson(res, {
        scenarios: getScenarioPayloads(),
      })
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/test-edits') {
      const body = await readJson(req)

      if (typeof body.scenario === 'string') {
        applyScenario(body.scenario, () => {})
      } else if (
        typeof body.path === 'string' &&
        typeof body.content === 'string'
      ) {
        writeScenarioFile(body.path, body.content)
      } else {
        sendJson(
          res,
          {
            error: 'Expected { scenario } or { path, content }.',
          },
          400
        )
        return
      }

      sendJson(res, {
        ok: true,
        scenarios: getScenarioPayloads(),
      })
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/next-dev-bridge-events') {
      await streamNextDevBridgeEvents(req, res, url)
      return
    }

    sendJson(res, { error: 'Not found' }, 404)
  } catch (error) {
    sendJson(
      res,
      {
        error: error?.message || String(error),
      },
      500
    )
  }
})

server.listen(PORT, HOST, () => {
  console.log(`next-dev-bridge web control server listening on http://${HOST}:${PORT}`)
  console.log(`editing and observing preview app at ${TARGET_URL}`)
})

process.once('SIGINT', () => shutdown(130))
process.once('SIGTERM', () => shutdown(143))

function setCorsHeaders(res) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
}

function sendJson(res, payload, statusCode = 200) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
  })
  res.end(JSON.stringify(payload))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      if (!body) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(body))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

async function streamNextDevBridgeEvents(req, res, url) {
  const { connect } = await loadNextDevBridge()
  const target = url.searchParams.get('target') || TARGET_URL
  let observer = null
  let heartbeat = null

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })

  const send = (name, payload) => {
    if (res.destroyed) {
      return
    }

    res.write(`event: ${name}\n`)
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  observer = connect(
    {
      url: target,
    },
    {
      reconnect: false,
    },
    (event, state) => {
      send('next-dev-bridge', { event, state })
    }
  )

  send('ready', {
    target,
    state: observer.getSnapshot(),
  })

  heartbeat = setInterval(() => {
    send('ping', { at: new Date().toISOString() })
  }, 15000)

  req.on('close', () => {
    clearInterval(heartbeat)
    if (observer) {
      observer.stop()
    }
  })
}

function loadNextDevBridge() {
  if (!nextDevBridgePromise) {
    nextDevBridgePromise = import(pathToFileURL(path.join(ROOT, 'dist/index.js')).href)
  }

  return nextDevBridgePromise
}

function shutdown(code) {
  server.close(() => {
    process.exit(code)
  })
}
