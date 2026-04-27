import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const LOCAL_PREVIEW_ORIGIN =
  process.env.NEXT_DEV_BRIDGE_LOCAL_PREVIEW_ORIGIN ||
  process.env.NEXT_DEV_BRIDGE_PREVIEW_ORIGIN ||
  'http://127.0.0.1:3001'
const SANDBOX_PORT = Number(process.env.NEXT_DEV_BRIDGE_SANDBOX_PORT || 3000)
const SANDBOX_ROOT =
  process.env.NEXT_DEV_BRIDGE_SANDBOX_ROOT || '/vercel/sandbox'
const SANDBOX_PREVIEW_ROOT =
  process.env.NEXT_DEV_BRIDGE_SANDBOX_PREVIEW_ROOT ||
  `${SANDBOX_ROOT}/preview`
const SANDBOX_RUNTIME =
  process.env.NEXT_DEV_BRIDGE_SANDBOX_RUNTIME || 'node24'
const SANDBOX_TIMEOUT_MS = Number(
  process.env.NEXT_DEV_BRIDGE_SANDBOX_TIMEOUT_MS || 60 * 60 * 1000
)
const SANDBOX_VCPUS = Number(process.env.NEXT_DEV_BRIDGE_SANDBOX_VCPUS || 2)
const PROBE_TIMEOUT_MS = Number(
  process.env.NEXT_DEV_BRIDGE_PROBE_TIMEOUT_MS || 10_000
)
const PROBE_FETCH_TIMEOUT_MS = Number(
  process.env.NEXT_DEV_BRIDGE_PROBE_FETCH_TIMEOUT_MS || 5000
)
const PROBE_RETRY_DELAY_MS = Number(
  process.env.NEXT_DEV_BRIDGE_PROBE_RETRY_DELAY_MS || 200
)
const PROBE_DEFAULT_ATTEMPTS = Number(
  process.env.NEXT_DEV_BRIDGE_PROBE_DEFAULT_ATTEMPTS || 4
)
const FIXTURE_VERSION =
  '2026-04-27-skip-layout-html-hide-nextjs-portal-probe-route'
const FIXTURE_VERSION_FILE = '.next-dev-bridge-fixture-version'
const SESSION_COOKIE = 'next-dev-bridge-sandbox'
const COOKIE_MAX_AGE_SECONDS = Math.max(
  60,
  Math.floor(SANDBOX_TIMEOUT_MS / 1000)
)

let activeSession = null

export function shouldUseSandbox() {
  const mode = process.env.NEXT_DEV_BRIDGE_CONTROL_MODE

  if (mode === 'sandbox') {
    return true
  }

  if (mode === 'local') {
    return false
  }

  return Boolean(process.env.VERCEL)
}

export async function getPreviewSession(request, options = {}) {
  if (!shouldUseSandbox()) {
    return {
      mode: 'local',
      previewOrigin: LOCAL_PREVIEW_ORIGIN,
      targetUrl: LOCAL_PREVIEW_ORIGIN,
    }
  }

  const requestedSandboxId = getRequestedSandboxId(request)

  if (options.forceNew && requestedSandboxId) {
    await stopSandboxById(requestedSandboxId)
  }

  if (!options.forceNew) {
    const existing = await getExistingSandboxSession(requestedSandboxId)
    if (existing) {
      return existing
    }
  }

  return createSandboxSession()
}

export async function stopPreviewSession(request) {
  if (!shouldUseSandbox()) {
    return {
      mode: 'local',
      stopped: false,
    }
  }

  const sandboxId = getRequestedSandboxId(request) || activeSession?.sandboxId
  if (!sandboxId) {
    return {
      mode: 'sandbox',
      stopped: false,
    }
  }

  await stopSandboxById(sandboxId)
  if (activeSession?.sandboxId === sandboxId) {
    activeSession = null
  }

  return {
    mode: 'sandbox',
    sandboxId,
    stopped: true,
  }
}

export async function getScenarioPayloadsForRequest(request) {
  let session = await getPreviewSession(request)

  if (session.mode === 'local') {
    return {
      session,
      scenarios: getLocalScenarioPayloads(),
    }
  }

  try {
    return {
      session,
      scenarios: await getScenarioPayloadsFromSandbox(session.sandbox),
    }
  } catch (error) {
    if (!isSandboxStoppedError(error)) {
      throw error
    }

    clearActiveSession(session.sandboxId)
    session = await createSandboxSession()

    return {
      session,
      scenarios: await getScenarioPayloadsFromSandbox(session.sandbox),
    }
  }
}

export async function applyScenarioEditForRequest(request, body) {
  const session = await getPreviewSession(request)

  if (session.mode === 'local') {
    if (typeof body.scenario === 'string') {
      applyLocalScenario(body.scenario)
    } else if (
      typeof body.path === 'string' &&
      typeof body.content === 'string'
    ) {
      writeLocalScenarioFile(body.path, body.content)
    } else {
      throw new BadRequestError('Expected { scenario } or { path, content }.')
    }

    const scenarios = getLocalScenarioPayloads()
    const probe = await probePreviewRoute(
      session,
      getProbeRequest(body, scenarios)
    )

    return {
      probe,
      session,
      scenarios,
    }
  }

  try {
    return await applySandboxScenarioEdit(session, body)
  } catch (error) {
    if (!isSandboxStoppedError(error)) {
      throw error
    }

    clearActiveSession(session.sandboxId)
    return applySandboxScenarioEdit(await createSandboxSession(), body)
  }
}

export function getPublicSession(session) {
  return {
    mode: session.mode,
    previewOrigin: session.previewOrigin,
    sandboxId: session.sandboxId,
    status: session.status,
    targetUrl: session.targetUrl,
  }
}

export function createSessionCookie(session) {
  if (!session.sandboxId) {
    return null
  }

  return `${SESSION_COOKIE}=${encodeURIComponent(
    session.sandboxId
  )}; Path=/; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SECONDS}`
}

export class BadRequestError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BadRequestError'
    this.statusCode = 400
  }
}

export function isSandboxStoppedError(error) {
  const status = error?.response?.status || error?.status
  const code = error?.json?.error?.code || error?.code || ''
  const text = [
    code,
    error?.message,
    error?.text,
    error?.json?.error?.message,
  ]
    .filter(Boolean)
    .join('\n')

  return (
    status === 410 ||
    code === 'sandbox_stopped' ||
    text.includes('sandbox_stopped') ||
    text.includes('no longer available')
  )
}

async function applySandboxScenarioEdit(session, body) {
  if (typeof body.scenario === 'string') {
    await runCheckedCommand(session.sandbox, `apply ${body.scenario}`, {
      cmd: 'node',
      args: ['scenarios.cjs', body.scenario],
      cwd: SANDBOX_PREVIEW_ROOT,
    })
  } else if (
    typeof body.path === 'string' &&
    typeof body.content === 'string'
  ) {
    await runCheckedCommand(session.sandbox, `write ${body.path}`, {
      cmd: 'node',
      args: [
        '-e',
        `const { writeScenarioFile } = require('./scenarios.cjs')
const [relativePath, content] = process.argv.slice(1)
writeScenarioFile(relativePath, content)`,
        body.path,
        body.content,
      ],
      cwd: SANDBOX_PREVIEW_ROOT,
    })
  } else {
    throw new BadRequestError('Expected { scenario } or { path, content }.')
  }

  const scenarios = await getScenarioPayloadsFromSandbox(session.sandbox)
  const probe = await probePreviewRoute(
    session,
    getProbeRequest(body, scenarios)
  )

  return {
    probe,
    session,
    scenarios,
  }
}

async function getScenarioPayloadsFromSandbox(sandbox) {
  const result = await runCheckedCommand(sandbox, 'load scenarios', {
    cmd: 'node',
    args: [
      '-e',
      `const { getScenarioPayloads } = require('./scenarios.cjs')
process.stdout.write(JSON.stringify(getScenarioPayloads()))`,
    ],
    cwd: SANDBOX_PREVIEW_ROOT,
  })

  return JSON.parse(await result.stdout())
}

async function getExistingSandboxSession(requestedSandboxId) {
  const sandboxId = requestedSandboxId || activeSession?.sandboxId
  if (!sandboxId) {
    return null
  }

  try {
    const { Sandbox } = await importSandbox()
    const sandbox = await Sandbox.get({ sandboxId })
    return ensureSandboxSession(sandbox)
  } catch {
    clearActiveSession(sandboxId)
    return null
  }
}

function clearActiveSession(sandboxId) {
  if (!sandboxId || activeSession?.sandboxId === sandboxId) {
    activeSession = null
  }
}

async function createSandboxSession() {
  const { Sandbox } = await importSandbox()
  const sandbox = await Sandbox.create({
    ports: [SANDBOX_PORT],
    resources: {
      vcpus: SANDBOX_VCPUS,
    },
    runtime: SANDBOX_RUNTIME,
    timeout: SANDBOX_TIMEOUT_MS,
  })

  await writePreviewFixtureToSandbox(sandbox)
  return ensureSandboxSession(sandbox)
}

async function ensureSandboxSession(sandbox) {
  const fixtureUpdated = await ensureSandboxPrepared(sandbox)
  const devCommandId = await ensurePreviewDevServer(sandbox, {
    forceRestart: fixtureUpdated,
  })
  const previewOrigin = sandbox.domain(SANDBOX_PORT)

  activeSession = {
    mode: 'sandbox',
    sandbox,
    sandboxId: sandbox.sandboxId,
    status: sandbox.status,
    previewOrigin,
    targetUrl: previewOrigin,
    devCommandId,
  }

  return activeSession
}

async function ensureSandboxPrepared(sandbox) {
  let fixtureUpdated = false
  const fixtureCheck = await sandbox.runCommand({
    cmd: 'sh',
    args: [
      '-lc',
      `test -f ${shellQuote(
        `${SANDBOX_PREVIEW_ROOT}/package.json`
      )} && test -f ${shellQuote(
        `${SANDBOX_PREVIEW_ROOT}/scenarios.cjs`
      )} && test "$(cat ${shellQuote(
        `${SANDBOX_PREVIEW_ROOT}/${FIXTURE_VERSION_FILE}`
      )} 2>/dev/null)" = ${shellQuote(FIXTURE_VERSION)}`,
    ],
    cwd: SANDBOX_ROOT,
  })

  if (fixtureCheck.exitCode !== 0) {
    await writePreviewFixtureToSandbox(sandbox)
    fixtureUpdated = true
  }

  const check = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-lc', 'test -x node_modules/.bin/next'],
    cwd: SANDBOX_PREVIEW_ROOT,
  })

  if (check.exitCode === 0) {
    if (fixtureUpdated) {
      await runCheckedCommand(sandbox, 'reset preview fixture', {
        cmd: 'node',
        args: ['scenarios.cjs', 'reset'],
        cwd: SANDBOX_PREVIEW_ROOT,
      })
    }
    return fixtureUpdated
  }

  await runCheckedCommand(sandbox, 'install dependencies', {
    cmd: 'npm',
    args: ['install'],
    cwd: SANDBOX_PREVIEW_ROOT,
  })
  await runCheckedCommand(sandbox, 'reset preview fixture', {
    cmd: 'node',
    args: ['scenarios.cjs', 'reset'],
    cwd: SANDBOX_PREVIEW_ROOT,
  })
  return true
}

async function ensurePreviewDevServer(sandbox, options = {}) {
  if (options.forceRestart) {
    await stopSandboxPreviewDevServer(sandbox)
  }

  if (!options.forceRestart && (await isSandboxPortOpen(sandbox))) {
    return activeSession?.sandboxId === sandbox.sandboxId
      ? activeSession.devCommandId
      : null
  }

  const previewOrigin = sandbox.domain(SANDBOX_PORT)
  const command = await sandbox.runCommand({
    cmd: 'node',
    args: ['dev-server.cjs', '-p', String(SANDBOX_PORT), '-H', '0.0.0.0'],
    cwd: SANDBOX_PREVIEW_ROOT,
    detached: true,
    env: {
      NEXT_DEV_BRIDGE_PREVIEW_ORIGIN: previewOrigin,
      NEXT_DEV_BRIDGE_WEB_ORIGIN:
        process.env.NEXT_DEV_BRIDGE_WEB_ORIGIN || process.env.VERCEL_URL || '',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  })

  await waitForSandboxPort(sandbox)
  await waitForPreviewOrigin(previewOrigin)

  return command.cmdId
}

async function stopSandboxPreviewDevServer(sandbox) {
  await sandbox.runCommand({
    cmd: 'sh',
    args: [
      '-lc',
      `pkill -f ${shellQuote(`[d]ev-server.cjs -p ${SANDBOX_PORT}`)} || true`,
    ],
    cwd: SANDBOX_PREVIEW_ROOT,
  })
  await delay(500)
}

async function isSandboxPortOpen(sandbox) {
  const check = await sandbox.runCommand({
    cmd: 'node',
    args: [
      '-e',
      `const net = require('node:net')
const socket = net.connect(${SANDBOX_PORT}, '127.0.0.1')
socket.once('connect', () => {
  socket.destroy()
  process.exit(0)
})
socket.once('error', () => process.exit(1))
setTimeout(() => {
  socket.destroy()
  process.exit(1)
}, 500).unref()`,
    ],
    cwd: SANDBOX_PREVIEW_ROOT,
  })

  return check.exitCode === 0
}

async function waitForSandboxPort(sandbox) {
  const deadline = Date.now() + 60_000

  while (Date.now() < deadline) {
    if (await isSandboxPortOpen(sandbox)) {
      return
    }

    await delay(1000)
  }

  throw new Error('Timed out waiting for the sandbox preview port.')
}

async function waitForPreviewOrigin(previewOrigin) {
  const deadline = Date.now() + 60_000

  while (Date.now() < deadline) {
    try {
      const response = await fetch(previewOrigin, {
        cache: 'no-store',
        method: 'HEAD',
      })

      if (response.status < 500) {
        return
      }
    } catch {}

    await delay(1000)
  }

  throw new Error('Timed out waiting for the sandbox preview URL.')
}

async function probePreviewRoute(session, probe) {
  const normalizedPath = normalizeProbePath(probe?.path || probe)
  if (!normalizedPath) {
    return null
  }

  const expectation = probe?.expectation || ''
  const deadline = Date.now() + PROBE_TIMEOUT_MS
  let attempts = 0
  let lastResult = null

  while (Date.now() < deadline) {
    attempts += 1

    try {
      const response = await fetchWithTimeout(
        new URL(normalizedPath, session.targetUrl)
      )
      const result = await readProbeResponse(response, normalizedPath)
      lastResult = result

      if (result.error) {
        return result
      }

      if (expectation && matchesProbeExpectation(response, expectation)) {
        return result
      }

      if (!expectation && attempts >= PROBE_DEFAULT_ATTEMPTS) {
        return result
      }
    } catch {
      if (!expectation && attempts >= PROBE_DEFAULT_ATTEMPTS) {
        return lastResult
      }
    }

    await delay(PROBE_RETRY_DELAY_MS)
  }

  return lastResult
}

async function fetchWithTimeout(url) {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    PROBE_FETCH_TIMEOUT_MS
  )

  try {
    return await fetch(url, {
      cache: 'no-store',
      headers: {
        'x-next-dev-bridge-probe': '1',
      },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

function matchesProbeExpectation(response, expectation) {
  if (expectation === 'error') {
    return response.status >= 500
  }

  if (expectation === 'ready') {
    return response.status < 500
  }

  return true
}

async function readProbeResponse(response, probePath) {
  const result = {
    ok: response.status < 500,
    path: probePath,
    status: response.status,
  }

  if (response.status < 500) {
    return result
  }

  const text = await response.text().catch(() => '')
  const error = extractNextDataError(text)
  return {
    ...result,
    error: error || {
      message: `Preview returned HTTP ${response.status}.`,
      name: 'PreviewBuildError',
    },
  }
}

function extractNextDataError(html) {
  const match = String(html).match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/
  )
  if (!match) {
    return null
  }

  try {
    const payload = JSON.parse(match[1])
    const error = payload?.err
    if (!error) {
      return null
    }

    return {
      message:
        typeof error.message === 'string'
          ? error.message
          : 'Preview returned a build error.',
      name: typeof error.name === 'string' ? error.name : 'PreviewBuildError',
      stack: typeof error.stack === 'string' ? error.stack : '',
    }
  } catch {
    return null
  }
}

function getProbeRequest(body, scenarios) {
  if (body.skipProbe === true) {
    return null
  }

  const explicitPath = normalizeProbePath(body.probePath)
  const scenario =
    typeof body.scenario === 'string'
      ? scenarios.find((entry) => entry.name === body.scenario)
      : null
  const path = explicitPath || scenario?.route

  return {
    expectation: getProbeExpectation(body, scenario),
    path,
  }
}

function getProbeExpectation(body, scenario) {
  if (body.probeExpectation === 'error' || body.probeExpectation === 'ready') {
    return body.probeExpectation
  }

  if (!scenario) {
    return ''
  }

  if (
    scenario.name === 'build:syntax' ||
    scenario.name === 'build:missing-export'
  ) {
    return 'error'
  }

  if (scenario.name === 'build:recover' || scenario.name === 'reset') {
    return 'ready'
  }

  return ''
}

function normalizeProbePath(value) {
  if (typeof value !== 'string') {
    return ''
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  try {
    const url = new URL(trimmed, 'http://next-dev-bridge.local')
    return `${url.pathname || '/'}${url.search}`
  } catch {
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  }
}

async function runCheckedCommand(sandbox, label, params) {
  const result = await sandbox.runCommand(params)
  if (result.exitCode === 0) {
    return result
  }

  const stderr = await result.stderr().catch(() => '')
  const stdout = await result.stdout().catch(() => '')
  const output = [stderr, stdout].filter(Boolean).join('\n').trim()
  throw new Error(
    `${label} failed with exit code ${result.exitCode}${
      output ? `:\n${output}` : '.'
    }`
  )
}

async function stopSandboxById(sandboxId) {
  try {
    const { Sandbox } = await importSandbox()
    const sandbox = await Sandbox.get({ sandboxId })
    await sandbox.stop()
  } catch {}
}

async function importSandbox() {
  try {
    return await import('@vercel/sandbox')
  } catch (error) {
    throw new Error(
      `Unable to load @vercel/sandbox. Install it in the web example before using sandbox mode. ${error.message}`
    )
  }
}

async function writePreviewFixtureToSandbox(sandbox) {
  const files = getPreviewFixtureFiles().map((file) => ({
    path: `${SANDBOX_PREVIEW_ROOT}/${file.relativePath}`,
    content: file.content,
  }))

  files.push({
    path: `${SANDBOX_PREVIEW_ROOT}/${FIXTURE_VERSION_FILE}`,
    content: `${FIXTURE_VERSION}\n`,
  })

  await sandbox.writeFiles(files)
}

function getPreviewFixtureFiles() {
  const root = getPreviewFixtureRoot()
  return readFixtureFiles(root, root)
}

function getPreviewFixtureRoot() {
  const candidates = [
    path.resolve(process.cwd(), 'preview-fixture'),
    path.resolve(
      process.cwd(),
      'examples',
      'next-dev-bridge-web',
      'preview-fixture'
    ),
  ]
  const fixtureRoot = candidates.find((candidate) => fs.existsSync(candidate))

  if (!fixtureRoot) {
    throw new Error('Cannot find examples/next-dev-bridge-web/preview-fixture.')
  }

  return fixtureRoot
}

function readFixtureFiles(directory, root) {
  const files = []

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.DS_Store' || entry.name === 'node_modules') {
      continue
    }

    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...readFixtureFiles(absolutePath, root))
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    files.push({
      content: fs.readFileSync(absolutePath),
      relativePath: path.relative(root, absolutePath).split(path.sep).join('/'),
    })
  }

  return files
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function getRequestedSandboxId(request) {
  if (!request) {
    return ''
  }

  const url = new URL(request.url)
  const queryValue = url.searchParams.get('sandbox')
  if (queryValue) {
    return queryValue
  }

  const headerValue = request.headers.get('x-next-dev-bridge-sandbox')
  if (headerValue) {
    return headerValue
  }

  return getCookieValue(request.headers.get('cookie') || '', SESSION_COOKIE)
}

function getCookieValue(cookieHeader, name) {
  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=')
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join('='))
    }
  }

  return ''
}

function getLocalScenarioPayloads() {
  const scenarioFile = getLocalScenarioFile()
  const result = runLocalNode([
    '-e',
    `const { getScenarioPayloads } = require(process.argv[1])
process.stdout.write(JSON.stringify(getScenarioPayloads()))`,
    scenarioFile,
  ])

  return JSON.parse(result.stdout)
}

function applyLocalScenario(name) {
  runLocalNode([getLocalScenarioFile(), name])
}

function writeLocalScenarioFile(relativePath, content) {
  runLocalNode([
    '-e',
    `const { writeScenarioFile } = require(process.argv[1])
const [, scenarioFile, relativePath, content] = process.argv
writeScenarioFile(relativePath, content)`,
    getLocalScenarioFile(),
    relativePath,
    content,
  ])
}

function getLocalScenarioFile() {
  const candidates = [
    path.resolve(process.cwd(), '..', 'next-dev-bridge-preview', 'scenarios.cjs'),
    path.resolve(
      process.cwd(),
      'examples',
      'next-dev-bridge-preview',
      'scenarios.cjs'
    ),
  ]
  const scenarioFile = candidates.find((candidate) => fs.existsSync(candidate))

  if (!scenarioFile) {
    throw new Error('Cannot find examples/next-dev-bridge-preview/scenarios.cjs.')
  }

  return scenarioFile
}

function runLocalNode(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: path.dirname(getLocalScenarioFile()),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status === 0) {
    return result
  }

  const output = [result.stderr, result.stdout].filter(Boolean).join('\n').trim()
  throw new Error(
    `Local scenario command failed with exit code ${result.status}${
      output ? `:\n${output}` : '.'
    }`
  )
}
