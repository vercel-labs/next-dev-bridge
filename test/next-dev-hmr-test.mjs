#!/usr/bin/env node

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
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
    chrome: null,
    chromeUserDataDir: null,
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
    if (context.chrome) {
      context.chrome.kill('SIGTERM')
      await waitForExit(context.chrome, 1000)
    }
    if (context.chromeUserDataDir) {
      fs.rmSync(context.chromeUserDataDir, { recursive: true, force: true })
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
      await resetRuntimeEvents()
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
    const initialBuildOk = await context.waitForObserved(
      (event) => event.type === 'build:ready',
      'initial clean build state'
    )
    logSpecial(
      'TEST HMR READY',
      `initial clean state trigger=${initialBuildOk.trigger} hash=${initialBuildOk.hash || 'n/a'}`
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
    'open /runtime-effect in headless Chrome',
    'expect clean HMR build state and no runtime errors',
  ])

  context.chromeUserDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'next-hmr-runtime-chrome-')
  )
  context.chrome = startHeadlessChrome(
    `${DEV_URL}/runtime-effect`,
    context.chromeUserDataDir
  )
  const initialRuntimeClear = await waitForRuntimeEvent(
    (event) =>
      event.kind === 'clear' &&
      event.message.includes('mounted with no runtime error'),
    'initial runtime clean event'
  )
  logRuntimeEvent('RUNTIME ERROR GONE', initialRuntimeClear, 0)

  logScenarioHeader('runtime-effect:error', [
    'edit the client effect to call console.error and throw',
    'expect one clean HMR build followed by 2 runtime errors',
  ])
  const runtimeBuildOk = context.waitForObserved(
    (event) => event.type === 'build:ready',
    'runtime effect error build success',
    { fromNow: true }
  )
  const runtimeErrors = waitForRuntimeEvents(
    (event) =>
      event.kind === 'error' &&
      (String(event.message || '').includes('Runtime effect console error') ||
        String(event.message || '').includes('Runtime effect thrown error')),
    'runtime console.error and thrown error',
    { count: 2, fromNow: true }
  )
  const runtimeErrorSignals = Promise.all([runtimeBuildOk, runtimeErrors])
  applyLoggedScenario('runtime-effect:error')
  await requestIgnoringErrors(`${DEV_URL}/runtime-effect`)
  const [runtimeBuildOkEvent, runtimeErrorEvents] = await runtimeErrorSignals
  logSpecial(
    'RUNTIME BUILD READY',
    `throwing effect compiled trigger=${runtimeBuildOkEvent.trigger} hash=${runtimeBuildOkEvent.hash || 'n/a'}`
  )
  assertRuntimeErrorCategories(runtimeErrorEvents)
  logRuntimeEvents('RUNTIME ERRORS RECEIVED', runtimeErrorEvents)

  logScenarioHeader('runtime-effect:recover', [
    'remove the throwing effect',
    'expect clean HMR build and runtime error clear event',
  ])
  const runtimeRecoverBuildOk = context.waitForObserved(
    (event) => event.type === 'build:ready',
    'runtime effect recovery build success',
    { fromNow: true }
  )
  const runtimeClear = waitForRuntimeEvent(
    (event) =>
      event.kind === 'clear' &&
      String(event.message || '').includes('Runtime effect error removed'),
    'runtime error clear',
    { fromNow: true }
  )
  const runtimeRecoverySignals = Promise.all([
    runtimeRecoverBuildOk,
    runtimeClear,
  ])
  applyLoggedScenario('runtime-effect:recover')
  await requestIgnoringErrors(`${DEV_URL}/runtime-effect`)
  const [runtimeRecoverBuildOkEvent, runtimeClearEvent] =
    await runtimeRecoverySignals
  logSpecial(
    'RUNTIME BUILD READY',
    `throwing effect removed trigger=${runtimeRecoverBuildOkEvent.trigger} hash=${runtimeRecoverBuildOkEvent.hash || 'n/a'}`
  )
  logRuntimeEvent('RUNTIME ERROR GONE', runtimeClearEvent, 0)
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

function logRuntimeEvent(label, event, count) {
  logSpecial(
    label,
    `count=${count} id=${event.id || 'n/a'} source=${event.source || 'runtime-effect'} message="${event.message}"`
  )
}

function logRuntimeEvents(label, events) {
  logSpecial(label, `count=${events.length}`)

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    console.log(indent(formatRuntimeErrorBlock(event, index), '    '))
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

function assertRuntimeErrorCategories(events) {
  const categories = new Set(events.map((event) => event.category))

  if (!categories.has('console.error')) {
    throw new Error(
      `Expected a console.error runtime event. Got: ${[...categories].join(', ')}`
    )
  }

  if (!categories.has('window.error')) {
    throw new Error(
      `Expected a window.error runtime event. Got: ${[...categories].join(', ')}`
    )
  }
}

function assertFormattedErrors(event, label) {
  if (!event.errors || event.errors.length < 1) {
    throw new Error(`Expected at least one error for ${label}`)
  }
  if (!event.errors[0]) {
    throw new Error(`Expected error text for ${label}`)
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

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        try {
          resolve({
            statusCode: res.statusCode,
            body: body ? JSON.parse(body) : null,
          })
        } catch (error) {
          reject(error)
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

async function resetRuntimeEvents() {
  await requestJson(`${DEV_URL}/api/runtime-events`, {
    method: 'DELETE',
  })
}

function waitForRuntimeEvent(matches, label, options = {}) {
  const timeoutMs = options.timeoutMs || 30000
  const startedAt = Date.now()
  let lastEvents = []
  let lastPollError = null
  let baselineId = 0

  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const response = await requestJson(`${DEV_URL}/api/runtime-events`)
        const events = response.body.events || []

        if (options.fromNow && baselineId === 0) {
          baselineId = events.reduce(
            (maxId, event) => Math.max(maxId, event.id || 0),
            0
          )
        }

        lastEvents = events
        const event = events.find((candidate) => {
          if (options.fromNow && candidate.id <= baselineId) {
            return false
          }

          try {
            return matches(candidate)
          } catch (error) {
            lastPollError = error
            return false
          }
        })

        if (event) {
          resolve(event)
          return
        }
      } catch (error) {
        lastPollError = error
      }

      if (Date.now() - startedAt > timeoutMs) {
        const diagnostics = [
          `Timed out waiting for ${label}. Runtime events: ${JSON.stringify(
            lastEvents
          )}`,
        ]
        if (lastPollError) {
          diagnostics.push(
            `Last poll error: ${lastPollError.stack || lastPollError.message || lastPollError}`
          )
        }
        reject(
          new Error(diagnostics.join('\n'))
        )
        return
      }

      setTimeout(tick, 250)
    }

    tick()
  })
}

function waitForRuntimeEvents(matches, label, options = {}) {
  const timeoutMs = options.timeoutMs || 30000
  const expectedCount = options.count || 1
  const startedAt = Date.now()
  let lastEvents = []
  let lastPollError = null
  let baselineId = 0

  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const response = await requestJson(`${DEV_URL}/api/runtime-events`)
        const events = response.body.events || []

        if (options.fromNow && baselineId === 0) {
          baselineId = events.reduce(
            (maxId, event) => Math.max(maxId, event.id || 0),
            0
          )
        }

        lastEvents = events
        const matchingEvents = events.filter((candidate) => {
          if (options.fromNow && candidate.id <= baselineId) {
            return false
          }

          try {
            return matches(candidate)
          } catch (error) {
            lastPollError = error
            return false
          }
        })

        if (matchingEvents.length >= expectedCount) {
          resolve(matchingEvents.slice(0, expectedCount))
          return
        }
      } catch (error) {
        lastPollError = error
      }

      if (Date.now() - startedAt > timeoutMs) {
        const diagnostics = [
          `Timed out waiting for ${label}. Runtime events: ${JSON.stringify(
            lastEvents
          )}`,
        ]
        if (lastPollError) {
          diagnostics.push(
            `Last poll error: ${lastPollError.stack || lastPollError.message || lastPollError}`
          )
        }
        reject(
          new Error(diagnostics.join('\n'))
        )
        return
      }

      setTimeout(tick, 250)
    }

    tick()
  })
}

function startHeadlessChrome(url, userDataDir) {
  const chromePath = findChromePath()
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--no-first-run',
      `--user-data-dir=${userDataDir}`,
      url,
    ],
    {
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  )

  child.stderr.on('data', () => {})
  return child
}

function findChromePath() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'google-chrome',
    'chromium',
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (candidate.includes('/') && fs.existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error(
    'No Chrome/Chromium binary found. Set CHROME_BIN to run the runtime browser test.'
  )
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

function formatRuntimeErrorBlock(event, index) {
  const lines = [
    `runtime error ${index + 1} [${event.category || 'runtime'}] id=${event.id} source=${event.source || 'runtime-effect'}`,
    '  message:',
    indent(event.message, '    '),
  ]
  const mappedFrames = formatMappedFrames(event.mappedFrames)

  if (mappedFrames) {
    lines.push(mappedFrames)
  }

  return lines.join('\n')
}

function formatMappedFrames(mappedFrames) {
  if (!Array.isArray(mappedFrames) || mappedFrames.length === 0) {
    return ''
  }

  const resolvedFrames = mappedFrames
    .filter((entry) => entry.status === 'fulfilled')
    .map((entry) => entry.value)
    .filter((value) => value && value.originalStackFrame)

  const visibleFrames = resolvedFrames
    .filter((value) => !value.originalStackFrame.ignored)
    .slice(0, 5)

  if (visibleFrames.length === 0) {
    const rejectedReasons = mappedFrames
      .filter((entry) => entry.status === 'rejected')
      .map((entry) => entry.reason)
      .filter(Boolean)

    if (rejectedReasons.length > 0) {
      return `  sourcemap failed:\n${rejectedReasons
        .slice(0, 3)
        .map((reason) => `    ${reason}`)
        .join('\n')}`
    }

    return ''
  }

  const lines = ['  sourcemapped trace:']
  for (const value of visibleFrames) {
    const frame = value.originalStackFrame
    lines.push(
      `    at ${frame.methodName || '<anonymous>'} (${frame.file}:${frame.line1}:${frame.column1 ?? 1})`
    )
  }

  const firstCodeFrame = visibleFrames.find((value) => value.originalCodeFrame)
  if (firstCodeFrame?.originalCodeFrame) {
    lines.push('  code frame:')
    lines.push(indent(firstCodeFrame.originalCodeFrame, '    '))
  }

  return lines.join('\n')
}

main().catch((error) => {
  console.error(formatTopLevelFailure('Integration flow failed', error))
  process.exitCode = 1
})
