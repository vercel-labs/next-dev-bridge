#!/usr/bin/env node

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { connect } from '../src/index.ts'
import { applyScenario } from './next-app-scenarios.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const TEST_APP_ROOT = path.join(__dirname, 'next-app')
const PORT = Number(process.env.PORT || 3100)
const HOST = '127.0.0.1'
const DEV_URL = `http://${HOST}:${PORT}`
const HMR_SETTLE_DELAY_MS = 1000
const NEXT_BIN = path.join(
  REPO_ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'next.cmd' : 'next'
)

async function main() {
  if (!fs.existsSync(NEXT_BIN)) {
    throw new Error('Next.js dependencies are not installed. Run "bun install" first.')
  }

  const mode = parseMode(process.argv.slice(2))
  const runRuntime = mode === 'all' || mode === 'runtime-effect'
  const runBuild = mode === 'all' || mode === 'build-errors'

  applyScenario('reset', () => {})

  console.log(`Starting real Next dev server at ${DEV_URL} for ${mode}`)
  const child = spawn(NEXT_BIN, ['dev', '-p', String(PORT), '-H', HOST], {
    cwd: TEST_APP_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  })

  let childOutput = ''
  let observer = null
  const context = {
    observerEvents: [],
    waiters: [],
    waitForObserved: null,
  }
  child.stdout.on('data', (chunk) => {
    childOutput += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    childOutput += chunk.toString()
  })

  const cleanup = async () => {
    applyScenario('reset', () => {})
    if (observer) {
      observer.stop()
    }
    const exited = waitForExit(child, 1200)
    child.kill('SIGTERM')
    if (!(await exited)) {
      child.kill('SIGKILL')
    }
  }

  try {
    if (runBuild) {
      await waitForHttp(`${DEV_URL}/build-errors`, 45000)
    }
    if (runRuntime) {
      await waitForHttp(`${DEV_URL}/runtime-effect`, 45000)
    }
    console.log('Next app is ready; connecting HMR observer')

    observer = connect(
      {
        url: DEV_URL,
      },
      {
        reconnect: false,
      },
      (event) => {
        context.observerEvents.push(event)
        logObservedEvent(event)
        for (const waiter of [...context.waiters]) {
          if (waiter.matches(event)) {
            waiter.resolve(event)
            context.waiters.splice(context.waiters.indexOf(waiter), 1)
          }
        }
      }
    )

    context.waitForObserved = createWaitForObserved(context)

    await context.waitForObserved(
      (event) => event.type === 'session:connected',
      'watching'
    )
    assertSingleConnectionSequence(context.observerEvents)
    const initialBuildOk = await context.waitForObserved(
      (event) => event.type === 'build:ready',
      'initial clean build state'
    )
    logSpecial(
      'TEST HMR READY',
      joinLogParts([
        `initial clean state trigger=${initialBuildOk.trigger}`,
        initialBuildOk.hash ? `hash=${initialBuildOk.hash}` : null,
      ])
    )

    if (runRuntime) {
      await runRuntimeEffectFlow(context)
    }

    if (runBuild) {
      await runBuildErrorFlow(context)
    }

    observer.stop()
    console.log(`Completed ${mode} integration flow`)
  } catch (error) {
    if (error instanceof Error) {
      error.message = `${error.message || '(no error message)'}\n\nNext dev output:\n${childOutput.slice(-4000)}`
    }
    throw error
  } finally {
    await cleanup()
  }
}

function parseMode(argv) {
  const mode = argv[0] || 'all'
  const aliases = {
    all: 'all',
    runtime: 'runtime-effect',
    'runtime-effect': 'runtime-effect',
    build: 'build-errors',
    'build-errors': 'build-errors',
  }

  if (!aliases[mode]) {
    throw new Error(
      `Unknown test scenario "${mode}". Use one of: all, runtime-effect, build-errors.`
    )
  }

  return aliases[mode]
}

function createWaitForObserved(context) {
  return function waitForObserved(matches, label, options = {}) {
    const timeoutMs = options.timeoutMs || 30000
    const startIndex = options.fromNow ? context.observerEvents.length : 0
    const existing = context.observerEvents.slice(startIndex).find(matches)
    if (existing) {
      return Promise.resolve(existing)
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Timed out waiting for ${label}. Saw: ${context.observerEvents
              .map((event) => event.type)
              .join(', ')}`
          )
        )
      }, timeoutMs)

      context.waiters.push({
        matches,
        resolve(event) {
          clearTimeout(timer)
          resolve(event)
        },
      })
    })
  }
}

async function runRuntimeEffectFlow(context) {
  logScenarioHeader('runtime-effect:baseline', [
    'request /runtime-effect while it is healthy',
    'expect the page to render without a build error',
  ])
  await requestIgnoringErrors(`${DEV_URL}/runtime-effect`)

  logScenarioHeader('runtime-effect:error', [
    'edit the client effect to throw after hydration',
    'expect one clean HMR build for the runtime page update',
  ])
  const runtimeBuildOk = context.waitForObserved(
    (event) => event.type === 'build:ready',
    'runtime effect error build success',
    { fromNow: true }
  )
  applyLoggedScenario('runtime-effect:error')
  await requestIgnoringErrors(`${DEV_URL}/runtime-effect`)
  const runtimeBuildOkEvent = await runtimeBuildOk
  logSpecial(
    'RUNTIME BUILD READY',
    joinLogParts([
      `throwing effect compiled trigger=${runtimeBuildOkEvent.trigger}`,
      runtimeBuildOkEvent.hash ? `hash=${runtimeBuildOkEvent.hash}` : null,
    ])
  )

  logScenarioHeader('runtime-effect:recover', [
    'remove the throwing effect',
    'expect clean HMR build after recovery',
  ])
  const runtimeRecoverBuildOk = context.waitForObserved(
    (event) => event.type === 'build:ready',
    'runtime effect recovery build success',
    { fromNow: true }
  )
  applyLoggedScenario('runtime-effect:recover')
  await requestIgnoringErrors(`${DEV_URL}/runtime-effect`)
  const runtimeRecoverBuildOkEvent = await runtimeRecoverBuildOk
  logSpecial(
    'RUNTIME BUILD READY',
    joinLogParts([
      `throwing effect removed trigger=${runtimeRecoverBuildOkEvent.trigger}`,
      runtimeRecoverBuildOkEvent.hash
        ? `hash=${runtimeRecoverBuildOkEvent.hash}`
        : null,
    ])
  )
}

async function runBuildErrorFlow(context) {
  logScenarioHeader('build:syntax', [
    'edit /build-errors dependency to contain a syntax error',
    'expect HMR build:error with a formatted code frame',
  ])
  const shown = context.waitForObserved(
    (event) =>
      isErrorEvent(event) &&
      event.errors.some((error) =>
        error.includes('Expression expected')
      ),
    'syntax HMR error',
    { fromNow: true }
  )
  applyLoggedScenario('build:syntax')
  await requestIgnoringErrors(`${DEV_URL}/build-errors`)
  const shownEvent = await shown
  assertFormattedErrors(shownEvent, 'syntax')
  await delay(HMR_SETTLE_DELAY_MS)

  logScenarioHeader('build:missing-export', [
    'replace syntax error with a valid module missing an imported export',
    'expect HMR build:error update with import trace',
  ])
  const updated = context.waitForObserved(
    (event) =>
      isErrorEvent(event) &&
      event.errors.some((error) =>
        error.includes('Export buildErrorMessage')
      ),
    'missing export HMR error',
    { fromNow: true }
  )
  applyLoggedScenario('build:missing-export')
  await requestIgnoringErrors(`${DEV_URL}/build-errors`)
  const updatedEvent = await updated
  assertFormattedErrors(updatedEvent, 'missing export')
  await delay(HMR_SETTLE_DELAY_MS)

  logScenarioHeader('build:recover', [
    'restore the build-errors dependency',
    'expect build:recovered with zero HMR errors',
  ])
  const cleared = context.waitForObserved(
    (event) => event.type === 'build:recovered',
    'fresh build recovery',
    { fromNow: true }
  )
  applyLoggedScenario('build:recover')
  await requestIgnoringErrors(`${DEV_URL}/build-errors`)
  const clearedEvent = await cleared
  if (clearedEvent.errors.length !== 0) {
    throw new Error(
      `Expected recovered error array to be empty, got ${clearedEvent.errors.length}`
    )
  }
}

function isErrorEvent(event) {
  return event.type === 'build:error'
}

function logObservedEvent(event) {
  if (event.type === 'build:compiling') {
    console.log(`>>> [COMPILING] build=${event.buildId}`)
  }

  if (event.type === 'build:ready') {
    console.log(
      `>>> [READY] trigger=${event.trigger}${event.hash ? ` hash=${event.hash}` : ''} warnings=${event.warnings.length}`
    )
  }

  if (event.type === 'build:error') {
    logSpecial(
      'BUILD ERROR',
      `count=${event.errors.length} trigger=${event.trigger}${event.hash ? ` hash=${event.hash}` : ''} change=${event.change}`
    )
    for (let index = 0; index < event.errors.length; index += 1) {
      console.log(indent(`error ${index + 1}:\n${event.errors[index]}`, '  '))
    }
  }

  if (event.type === 'build:recovered') {
    logSpecial(
      'BUILD RECOVERED',
      `count=${event.errors.length} trigger=${event.trigger}${event.hash ? ` hash=${event.hash}` : ''} warnings=${event.warnings.length}`
    )
  }
}

function applyLoggedScenario(name) {
  applyScenario(name, () => {})
}

function logScenarioHeader(label, details = []) {
  const line = '>>> ============================================================'
  console.log('')
  console.log(line)
  console.log(`>>> [SCENARIO] ${label}`)
  for (const detail of details) {
    console.log(`>>>   ${detail}`)
  }
  console.log(line)
}

function logSpecial(label, message) {
  console.log(`>>> [${label}] ${message}`)
}

function joinLogParts(parts) {
  return parts.filter(Boolean).join(' ')
}

function assertFormattedErrors(event, label) {
  if (!event.errors || event.errors.length < 1) {
    throw new Error(`Expected at least one error for ${label}`)
  }
  if (!event.errors[0]) {
    throw new Error(`Expected error text for ${label}`)
  }
}

function assertSingleConnectionSequence(events) {
  const connectionEvents = events.filter((event) =>
    [
      'session:connecting',
      'session:connected',
      'session:disconnected',
      'session:error',
    ].includes(event.type)
  )
  const eventTypes = connectionEvents.map((event) => event.type)

  if (
    eventTypes.length !== 2 ||
    eventTypes[0] !== 'session:connecting' ||
    eventTypes[1] !== 'session:connected'
  ) {
    throw new Error(
      `Expected one connection event sequence, got: ${eventTypes.join(', ')}`
    )
  }
}

function waitForHttp(url, timeoutMs) {
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const response = await requestIgnoringErrors(url)
        if (response.statusCode && response.statusCode < 500) {
          resolve()
          return
        }
      } catch {}

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`))
        return
      }

      setTimeout(tick, 500)
    }

    tick()
  })
}

function requestIgnoringErrors(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume()
      res.on('end', () => resolve({ statusCode: res.statusCode }))
    })
    req.on('error', reject)
    req.setTimeout(5000, () => {
      req.destroy(new Error(`Request timed out: ${url}`))
    })
  })
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

function indent(value, prefix) {
  return String(value)
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')
}

function formatTopLevelFailure(label, reason) {
  if (reason instanceof Error) {
    const details = [
      `${label}: ${reason.name || 'Error'}${reason.message ? `: ${reason.message}` : ''}`,
    ]
    if (reason.stack) {
      details.push(reason.stack)
    }
    if (reason.cause) {
      details.push(`Cause: ${reason.cause.stack || reason.cause.message || reason.cause}`)
    }
    return details.join('\n')
  }

  return `${label}: ${JSON.stringify(reason)}`
}

main().catch((error) => {
  console.error(formatTopLevelFailure('Integration flow failed', error))
  process.exitCode = 1
})
