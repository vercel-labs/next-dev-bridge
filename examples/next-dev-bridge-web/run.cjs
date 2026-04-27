#!/usr/bin/env node
'use strict'

const path = require('node:path')
const { spawn } = require('node:child_process')

const WEB_ROOT = __dirname
const REPO_ROOT = path.resolve(WEB_ROOT, '..', '..')
const PREVIEW_ROOT = path.join(REPO_ROOT, 'examples', 'next-dev-bridge-preview')
const NEXT_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'next')
const CONTROL_PORT = process.env.NEXT_DEV_BRIDGE_CONTROL_PORT || '3010'
const WEB_PORT = process.env.PORT || '3000'
const PREVIEW_PORT = process.env.NEXT_DEV_BRIDGE_PREVIEW_PORT || '3001'
const TARGET_URL = `http://127.0.0.1:${PREVIEW_PORT}`
const runner = process.argv[0]
const processes = createProcessGroup()

processes.start('control', runner, [path.join(WEB_ROOT, 'server.cjs')], {
  cwd: REPO_ROOT,
  env: {
    ...process.env,
    NEXT_DEV_BRIDGE_CONTROL_PORT: CONTROL_PORT,
    NEXT_DEV_BRIDGE_TARGET_URL: TARGET_URL,
  },
  stdio: 'inherit',
})

processes.start('web', NEXT_BIN, ['dev', '-p', WEB_PORT], {
  cwd: WEB_ROOT,
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_DEV_BRIDGE_CONTROL_PORT: CONTROL_PORT,
    NEXT_DEV_BRIDGE_PREVIEW_ORIGIN: TARGET_URL,
  },
  stdio: 'inherit',
})

processes.start('preview', NEXT_BIN, ['dev', '-p', PREVIEW_PORT], {
  cwd: PREVIEW_ROOT,
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
  },
  stdio: 'inherit',
})

processes.installSignalHandlers()

function createProcessGroup() {
  const detached = process.platform !== 'win32'
  const children = []
  let shuttingDown = false

  return {
    installSignalHandlers,
    start,
    shutdown,
  }

  function start(name, command, args, options) {
    const child = spawn(command, args, {
      ...options,
      detached,
    })

    child.nextDevBridgeName = name
    children.push(child)

    child.on('exit', (code, signal) => {
      if (shuttingDown) {
        return
      }

      shutdown(code || (signal ? 1 : 0))
    })

    return child
  }

  function installSignalHandlers() {
    process.once('SIGINT', () => shutdown(130, 'SIGINT'))
    process.once('SIGTERM', () => shutdown(143, 'SIGTERM'))
    process.once('SIGHUP', () => shutdown(129, 'SIGHUP'))
    process.once('SIGQUIT', () => shutdown(131, 'SIGQUIT'))
    process.once('exit', () => terminateAll('SIGTERM'))
  }

  function shutdown(code, signal = 'SIGTERM') {
    shuttingDown = true
    terminateAll(signal)

    setTimeout(() => {
      terminateAll('SIGKILL')
      process.exit(code)
    }, 800).unref()
  }

  function terminateAll(signal) {
    for (const child of children) {
      terminateChild(child, signal)
    }
  }

  function terminateChild(child, signal) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
      return
    }

    try {
      if (detached) {
        process.kill(-child.pid, signal)
      } else {
        child.kill(signal)
      }
    } catch {
      try {
        child.kill(signal)
      } catch {}
    }
  }
}
