#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const TEST_APP_ROOT = path.join(__dirname, 'next-app')
const BUILD_SUBJECT_FILE = path.join(
  TEST_APP_ROOT,
  'app/build-errors/subject.js'
)
const BUILD_SUBJECT_PATH = 'app/build-errors/subject.js'
const RUNTIME_MODE_FILE = path.join(
  TEST_APP_ROOT,
  'app/runtime-errors/runtime-mode.js'
)
const RUNTIME_MODE_PATH = 'app/runtime-errors/runtime-mode.js'
const RUNTIME_EFFECT_FILE = path.join(
  TEST_APP_ROOT,
  'app/runtime-effect/runtime-effect-client.jsx'
)
const RUNTIME_EFFECT_PATH = 'app/runtime-effect/runtime-effect-client.jsx'
const DEFAULT_SEQUENCE_DELAY_MS = 3000

const BUILD_SUBJECT_GOOD = `export const buildErrorMessage = 'The build-error route is healthy.'

export function describeBuildStatus() {
  return 'This text comes from app/build-errors/subject.js. Scenario scripts rewrite this module to trigger and recover from compiler errors.'
}
`

const BUILD_SUBJECT_SYNTAX_ERROR = `export const buildErrorMessage = 'This module contains an intentional syntax error.'

export function describeBuildStatus() {
  return (
}
`

const BUILD_SUBJECT_MISSING_EXPORT = `export const renamedBuildErrorMessage =
  'The page still imports buildErrorMessage, so this creates a missing export build error.'

export function describeBuildStatus() {
  return 'This function remains valid, but the expected named export is gone.'
}
`

const RUNTIME_MODE_GOOD = `export const runtimeMode = 'ok'

export const runtimeNote =
  'The runtime route is healthy. Run bun run scenario -- runtime:multi while this page is open to trigger multiple browser runtime errors.'
`

const RUNTIME_MODE_MULTI = `export const runtimeMode = 'multi'

export const runtimeNote =
  'This scenario schedules two uncaught browser runtime errors from the client component.'
`

const RUNTIME_MODE_RENDER = `export const runtimeMode = 'render'

export const runtimeNote =
  'This scenario throws during client component render.'
`

const RUNTIME_EFFECT_GOOD = `'use client'

import { useEffect, useState } from 'react'

export function RuntimeEffectClient() {
  const [effectRuns, setEffectRuns] = useState(0)

  useEffect(() => {
    setEffectRuns((value) => value + 1)
  }, [])

  return (
    <div className="panel">
      <span className="statusPill">Runtime clean</span>
      <h2>No runtime error</h2>
      <p>
        This component currently has a healthy effect. HMR should report build
        success for this page before any runtime error is introduced.
      </p>

      <div className="runtimeMeter">
        <div className="meterRow">
          <strong>Effect runs</strong>
          <span>{effectRuns}</span>
        </div>
        <div className="meterRow">
          <strong>Runtime source</strong>
          <code>app/runtime-effect/runtime-effect-client.jsx</code>
        </div>
      </div>
    </div>
  )
}
`

const RUNTIME_EFFECT_ERROR = `'use client'

import { useEffect, useState } from 'react'

export function RuntimeEffectClient() {
  const [effectRuns, setEffectRuns] = useState(0)
  const [manualErrors, setManualErrors] = useState(0)

  useEffect(() => {
    setEffectRuns((value) => value + 1)

    const timer = setTimeout(() => {
      throw new Error('Runtime effect thrown error: useEffect fired after HMR.')
    }, 250)

    return () => clearTimeout(timer)
  }, [])

  function throwManualRuntimeError() {
    const nextCount = manualErrors + 1
    setManualErrors(nextCount)

    setTimeout(() => {
      throw new Error(
        \`Manual runtime effect error #\${nextCount}: button-triggered runtime failure.\`
      )
    }, 0)
  }

  return (
    <div className="panel">
      <span className="statusPill dangerPill">Runtime error armed</span>
      <h2>Throwing useEffect installed</h2>
      <p>
        This HMR update compiled successfully. The browser effect now throws a
        runtime error after hydration.
      </p>
      <button
        className="runtimeActionButton"
        onClick={throwManualRuntimeError}
        type="button"
      >
        Throw another runtime error ({manualErrors})
      </button>

      <div className="runtimeMeter">
        <div className="meterRow">
          <strong>Effect runs</strong>
          <span>{effectRuns}</span>
        </div>
        <div className="meterRow">
          <strong>Runtime source</strong>
          <code>app/runtime-effect/runtime-effect-client.jsx</code>
        </div>
      </div>
    </div>
  )
}
`

const RUNTIME_EFFECT_RECOVER = `'use client'

import { useEffect, useState } from 'react'

export function RuntimeEffectClient() {
  const [effectRuns, setEffectRuns] = useState(0)

  useEffect(() => {
    setEffectRuns((value) => value + 1)
  }, [])

  return (
    <div className="panel">
      <span className="statusPill">Runtime recovered</span>
      <h2>Throwing effect removed</h2>
      <p>
        The component was rewritten without the throwing effect. The runtime
        error state is now clear.
      </p>

      <div className="runtimeMeter">
        <div className="meterRow">
          <strong>Effect runs</strong>
          <span>{effectRuns}</span>
        </div>
        <div className="meterRow">
          <strong>Runtime source</strong>
          <code>app/runtime-effect/runtime-effect-client.jsx</code>
        </div>
      </div>
    </div>
  )
}
`

const scenarios = {
  reset: {
    description: 'Restore both test pages to a healthy state.',
    route: '/',
    edits: [
      {
        path: BUILD_SUBJECT_PATH,
        file: BUILD_SUBJECT_FILE,
        content: BUILD_SUBJECT_GOOD,
      },
      {
        path: RUNTIME_MODE_PATH,
        file: RUNTIME_MODE_FILE,
        content: RUNTIME_MODE_GOOD,
      },
      {
        path: RUNTIME_EFFECT_PATH,
        file: RUNTIME_EFFECT_FILE,
        content: RUNTIME_EFFECT_GOOD,
      },
    ],
  },
  'build:syntax': {
    description: 'Replace the build test module with an intentional syntax error.',
    route: '/build-errors',
    edits: [
      {
        path: BUILD_SUBJECT_PATH,
        file: BUILD_SUBJECT_FILE,
        content: BUILD_SUBJECT_SYNTAX_ERROR,
      },
    ],
  },
  'build:missing-export': {
    description:
      'Replace the syntax error with a valid module that omits the named export imported by the page.',
    route: '/build-errors',
    edits: [
      {
        path: BUILD_SUBJECT_PATH,
        file: BUILD_SUBJECT_FILE,
        content: BUILD_SUBJECT_MISSING_EXPORT,
      },
    ],
  },
  'build:recover': {
    description: 'Restore the build test module.',
    route: '/build-errors',
    edits: [
      {
        path: BUILD_SUBJECT_PATH,
        file: BUILD_SUBJECT_FILE,
        content: BUILD_SUBJECT_GOOD,
      },
    ],
  },
  'runtime:multi': {
    description: 'Schedule two uncaught browser runtime errors.',
    route: '/runtime-errors',
    edits: [
      {
        path: RUNTIME_MODE_PATH,
        file: RUNTIME_MODE_FILE,
        content: RUNTIME_MODE_MULTI,
      },
      {
        path: BUILD_SUBJECT_PATH,
        file: BUILD_SUBJECT_FILE,
        content: BUILD_SUBJECT_GOOD,
      },
    ],
  },
  'runtime:render': {
    description: 'Throw during client component render.',
    route: '/runtime-errors',
    edits: [
      {
        path: RUNTIME_MODE_PATH,
        file: RUNTIME_MODE_FILE,
        content: RUNTIME_MODE_RENDER,
      },
      {
        path: BUILD_SUBJECT_PATH,
        file: BUILD_SUBJECT_FILE,
        content: BUILD_SUBJECT_GOOD,
      },
    ],
  },
  'runtime:recover': {
    description: 'Restore the runtime test module.',
    route: '/runtime-errors',
    edits: [
      {
        path: RUNTIME_MODE_PATH,
        file: RUNTIME_MODE_FILE,
        content: RUNTIME_MODE_GOOD,
      },
      {
        path: BUILD_SUBJECT_PATH,
        file: BUILD_SUBJECT_FILE,
        content: BUILD_SUBJECT_GOOD,
      },
    ],
  },
  'runtime-effect:clean': {
    description: 'Restore the runtime-effect page to a clean useEffect.',
    route: '/runtime-effect',
    edits: [
      {
        path: RUNTIME_EFFECT_PATH,
        file: RUNTIME_EFFECT_FILE,
        content: RUNTIME_EFFECT_GOOD,
      },
      {
        path: BUILD_SUBJECT_PATH,
        file: BUILD_SUBJECT_FILE,
        content: BUILD_SUBJECT_GOOD,
      },
    ],
  },
  'runtime-effect:error': {
    description:
      'Add a useEffect that throws a runtime error.',
    route: '/runtime-effect',
    edits: [
      {
        path: RUNTIME_EFFECT_PATH,
        file: RUNTIME_EFFECT_FILE,
        content: RUNTIME_EFFECT_ERROR,
      },
      {
        path: BUILD_SUBJECT_PATH,
        file: BUILD_SUBJECT_FILE,
        content: BUILD_SUBJECT_GOOD,
      },
    ],
  },
  'runtime-effect:recover': {
    description: 'Remove the throwing useEffect from the runtime-effect page.',
    route: '/runtime-effect',
    edits: [
      {
        path: RUNTIME_EFFECT_PATH,
        file: RUNTIME_EFFECT_FILE,
        content: RUNTIME_EFFECT_RECOVER,
      },
      {
        path: BUILD_SUBJECT_PATH,
        file: BUILD_SUBJECT_FILE,
        content: BUILD_SUBJECT_GOOD,
      },
    ],
  },
}

async function runCli(argv) {
  const [command = 'list', ...rest] = argv

  if (command === 'list' || command === '--help' || command === '-h') {
    printHelp()
    return
  }

  if (command === 'sequence') {
    const delayMs = readDelay(rest)
    await runSequence(delayMs)
    return
  }

  applyScenario(command)
}

function applyScenario(name, log = console.log) {
  const scenario = scenarios[name]
  if (!scenario) {
    throw new Error(
      `Unknown test scenario "${name}". Run "bun run scenario -- list".`
    )
  }

  for (const edit of scenario.edits) {
    writeFile(edit.file, edit.content)
  }
  log(`Applied scenario "${name}": ${scenario.description}`)
}

function getScenarioPayloads() {
  return Object.entries(scenarios).map(([name, scenario]) => ({
    name,
    description: scenario.description,
    route: scenario.route,
    edits: scenario.edits.map((edit) => ({
      path: edit.path,
      content: edit.content,
    })),
  }))
}

function getAllowedScenarioFiles() {
  const files = new Map()

  for (const scenario of Object.values(scenarios)) {
    for (const edit of scenario.edits) {
      files.set(edit.path, edit.file)
    }
  }

  return files
}

function writeScenarioFile(relativePath, content) {
  const files = getAllowedScenarioFiles()
  const filePath = files.get(relativePath)

  if (!filePath) {
    throw new Error(`Cannot write unknown scenario file "${relativePath}".`)
  }

  writeFile(filePath, String(content))
}

async function runSequence(delayMs = DEFAULT_SEQUENCE_DELAY_MS) {
  const steps = [
    ['reset', 'healthy baseline'],
    ['build:syntax', 'build syntax error'],
    ['build:missing-export', 'updated build error'],
    ['build:recover', 'build recovery'],
    ['runtime-effect:error', 'runtime effect error'],
    ['runtime-effect:recover', 'runtime effect recovery'],
  ]

  for (let index = 0; index < steps.length; index += 1) {
    const [scenario, label] = steps[index]
    applyScenario(scenario)

    if (index < steps.length - 1) {
      console.log(`Waiting ${delayMs}ms before ${label} -> next step...`)
      await sleep(delayMs)
    }
  }
}

function readDelay(args) {
  const delayArg = args.find((arg) => arg.startsWith('--delay='))
  if (!delayArg) {
    return DEFAULT_SEQUENCE_DELAY_MS
  }

  const delayMs = Number(delayArg.slice('--delay='.length))
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error(`Invalid sequence delay: ${delayArg}`)
  }
  return delayMs
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function printHelp() {
  console.log(`Next test scenarios:

  reset                  Restore both test pages
  build:syntax           Create a syntax build error
  build:missing-export   Create a missing export build error
  build:recover          Recover the build-errors page
  runtime:multi          Schedule two browser runtime errors
  runtime:render         Throw during client render
  runtime:recover        Recover the runtime-errors page
  runtime-effect:clean   Restore the runtime-effect page to a clean effect
  runtime-effect:error   Add a thrown useEffect error
  runtime-effect:recover Remove the throwing useEffect
  sequence               Run reset -> build errors -> recovery -> runtime errors -> recovery

Examples:
  bun run scenario -- build:syntax
  bun run scenario -- sequence --delay=2500
`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error.stack || error.message)
    process.exitCode = 1
  })
}

export {
  BUILD_SUBJECT_FILE,
  RUNTIME_EFFECT_FILE,
  RUNTIME_MODE_FILE,
  applyScenario,
  getAllowedScenarioFiles,
  getScenarioPayloads,
  runSequence,
  scenarios,
  writeScenarioFile,
}
