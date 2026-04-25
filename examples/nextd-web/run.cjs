#!/usr/bin/env node
'use strict'

const path = require('node:path')
const { spawn } = require('node:child_process')

const WEB_ROOT = __dirname
const REPO_ROOT = path.resolve(WEB_ROOT, '..', '..')
const PREVIEW_ROOT = path.join(REPO_ROOT, 'examples', 'nextd-preview')
const NEXT_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'next')
const CONTROL_PORT = process.env.NEXTD_CONTROL_PORT || '3010'
const WEB_PORT = process.env.PORT || '3000'
const PREVIEW_PORT = process.env.NEXTD_PREVIEW_PORT || '3001'
const TARGET_URL = `http://127.0.0.1:${PREVIEW_PORT}`
const runner = process.argv[0]
let shuttingDown = false

const children = [
  spawn(runner, [path.join(WEB_ROOT, 'server.cjs')], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NEXTD_CONTROL_PORT: CONTROL_PORT,
      NEXTD_TARGET_URL: TARGET_URL,
    },
    stdio: 'inherit',
  }),
  spawn(NEXT_BIN, ['dev', '-p', WEB_PORT], {
    cwd: WEB_ROOT,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
      NEXTD_CONTROL_PORT: CONTROL_PORT,
      NEXTD_PREVIEW_ORIGIN: TARGET_URL,
    },
    stdio: 'inherit',
  }),
  spawn(NEXT_BIN, ['dev', '-p', PREVIEW_PORT], {
    cwd: PREVIEW_ROOT,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: 'inherit',
  }),
]

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return
    }

    shutdown(code || (signal ? 1 : 0))
  })
}

process.once('SIGINT', () => shutdown(130))
process.once('SIGTERM', () => shutdown(143))

function shutdown(code) {
  shuttingDown = true

  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGKILL')
      }
    }
    process.exit(code)
  }, 800).unref()
}
