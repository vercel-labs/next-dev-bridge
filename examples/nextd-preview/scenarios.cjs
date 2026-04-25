#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const APP_ROOT = fs.existsSync(path.join(process.cwd(), 'app'))
  ? process.cwd()
  : __dirname
const BUILD_SUBJECT_PATH = 'app/build-errors/subject.js'
const RUNTIME_MODE_PATH = 'app/runtime-errors/runtime-mode.js'
const RUNTIME_EFFECT_PATH = 'app/runtime-effect/runtime-effect-client.jsx'
const BUILD_SUBJECT_FILE = path.join(APP_ROOT, BUILD_SUBJECT_PATH)
const RUNTIME_MODE_FILE = path.join(APP_ROOT, RUNTIME_MODE_PATH)
const RUNTIME_EFFECT_FILE = path.join(APP_ROOT, RUNTIME_EFFECT_PATH)

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
  'The runtime route is healthy. Apply runtime:multi while this page is open to trigger multiple browser runtime errors.'
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
import { reportRuntimeEvent } from './runtime-reporter'

export function RuntimeEffectClient() {
  const [effectRuns, setEffectRuns] = useState(0)

  useEffect(() => {
    setEffectRuns((value) => value + 1)
    reportRuntimeEvent(
      'clear',
      'Runtime effect page mounted with no runtime error.'
    )
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
import { installRuntimeEventReporter } from './runtime-reporter'

export function RuntimeEffectClient() {
  const [effectRuns, setEffectRuns] = useState(0)

  useEffect(() => {
    installRuntimeEventReporter()
    setEffectRuns((value) => value + 1)

    console.error(
      new Error('Runtime effect console error: useEffect reported a console failure.')
    )

    const timer = setTimeout(() => {
      throw new Error('Runtime effect thrown error: useEffect fired after HMR.')
    }, 250)

    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="panel">
      <span className="statusPill dangerPill">Runtime error armed</span>
      <h2>Throwing useEffect installed</h2>
      <p>
        This HMR update compiled successfully. The browser effect now emits a
        console.error and throws a runtime error after hydration.
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

const RUNTIME_EFFECT_RECOVER = `'use client'

import { useEffect, useState } from 'react'
import { reportRuntimeEvent } from './runtime-reporter'

export function RuntimeEffectClient() {
  const [effectRuns, setEffectRuns] = useState(0)

  useEffect(() => {
    setEffectRuns((value) => value + 1)
    reportRuntimeEvent(
      'clear',
      'Runtime effect error removed after HMR recovery.'
    )
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
    description: 'Restore the example app to a healthy state.',
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
    description: 'Replace the build module with an intentional syntax error.',
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
    description: 'Replace the syntax error with a valid module missing an export.',
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
    description: 'Restore the build module.',
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
    ],
  },
  'runtime-effect:error': {
    description: 'Add a useEffect that logs console.error and throws.',
    route: '/runtime-effect',
    edits: [
      {
        path: RUNTIME_EFFECT_PATH,
        file: RUNTIME_EFFECT_FILE,
        content: RUNTIME_EFFECT_ERROR,
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
    ],
  },
}

function applyScenario(name, log = console.log) {
  const scenario = scenarios[name]
  if (!scenario) {
    throw new Error(`Unknown example scenario "${name}".`)
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
  const filePath = getAllowedScenarioFiles().get(relativePath)

  if (!filePath) {
    throw new Error(`Cannot write unknown scenario file "${relativePath}".`)
  }

  writeFile(filePath, String(content))
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content)
}

if (require.main === module) {
  const scenario = process.argv[2] || 'reset'
  applyScenario(scenario)
}

module.exports = {
  applyScenario,
  getAllowedScenarioFiles,
  getScenarioPayloads,
  scenarios,
  writeScenarioFile,
}
