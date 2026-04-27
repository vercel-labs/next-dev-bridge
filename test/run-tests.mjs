#!/usr/bin/env bun

import { spawn } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const scenarioArgs = process.argv.slice(2)
const bunBin = process.versions.bun ? process.execPath : 'bun'

await run('unit tests', 'node', [
  path.join(root, 'node_modules', 'vitest', 'vitest.mjs'),
  'run',
  path.join(root, 'test'),
])

await run('package build', bunBin, [
  'run',
  'build',
])

await run('Next dev integration flow', bunBin, [
  path.join(root, 'test', 'next-dev-hmr-test.mjs'),
  ...scenarioArgs,
])

function run(label, command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    })

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }

      const reason = signal ? `signal ${signal}` : `exit code ${code}`
      reject(new Error(`${label} failed with ${reason}`))
    })
  })
}
