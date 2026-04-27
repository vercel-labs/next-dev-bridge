'use client'

import { useEffect, useRef, useState } from 'react'
import { CircularLoading } from 'respinner'

const PREVIEW_ROUTES = [
  { path: '/build-errors', label: 'Build errors', scenario: 'build:syntax' },
  {
    path: '/runtime-effect',
    label: 'Runtime effect',
    scenario: 'runtime-effect:error',
  },
  { path: '/runtime-errors', label: 'Runtime errors', scenario: 'runtime:multi' },
]
const ERROR_OVERLAY_POSITIONS = [
  { value: 'preview-center', label: 'Preview center' },
  { value: 'preview-corner', label: 'Preview corner' },
  { value: 'panel', label: 'Status panel' },
]
const DEFAULT_CONTROL_ORIGIN = ''
const SANDBOX_STORAGE_KEY = 'next-dev-bridge-sandbox'

export function NextDevBridgeWeb() {
  const previewFrameRef = useRef(null)
  const runtimeWindowIdRef = useRef(null)
  const previousErrorCountRef = useRef(0)
  const suppressBuildErrorsRef = useRef(false)
  const pendingResetPreviewRef = useRef(false)
  const probeBuildErrorRef = useRef(false)
  const [controlOrigin, setControlOrigin] = useState(DEFAULT_CONTROL_ORIGIN)
  const [controlReady, setControlReady] = useState(false)
  const [previewOrigin, setPreviewOrigin] = useState('')
  const [previewMode, setPreviewMode] = useState('')
  const [previewLoading, setPreviewLoading] = useState(true)
  const [sandboxId, setSandboxId] = useState('')
  const [scenarios, setScenarios] = useState([])
  const [selectedScenario, setSelectedScenario] = useState('')
  const [editPath, setEditPath] = useState('')
  const [editContent, setEditContent] = useState('')
  const [previewPath, setPreviewPath] = useState('/build-errors')
  const [previewVersion, setPreviewVersion] = useState(0)
  const [applyStatus, setApplyStatus] = useState('Starting preview')
  const [hmrEvent, setHmrEvent] = useState(null)
  const [hmrEvents, setHmrEvents] = useState([])
  const [hmrExpanded, setHmrExpanded] = useState(false)
  const [buildErrors, setBuildErrors] = useState([])
  const [runtimeErrors, setRuntimeErrors] = useState([])
  const [activeErrorIndex, setActiveErrorIndex] = useState(0)
  const [errorOverlayPosition, setErrorOverlayPosition] =
    useState('preview-center')

  const selected = scenarios.find((scenario) => scenario.name === selectedScenario)
  const previewSrc = previewOrigin
    ? `${trimTrailingSlash(
        previewOrigin
      )}${previewPath}?nextDevBridgePreview=${previewVersion}`
    : ''
  const errorEntries = [
    ...buildErrors.map((error, index) => ({
      body: error,
      className: 'errorBlock',
      key: `build-${index}-${error.slice(0, 24)}`,
      label: `Build ${index + 1}`,
    })),
    ...runtimeErrors.map((error, index) => ({
      body: formatRuntimeError(error),
      className: 'errorBlock runtimeBlock',
      key: `runtime-${error.id}-${error.message}`,
      label: `Runtime ${index + 1}`,
    })),
  ]
  const hasVisibleErrors = errorEntries.length > 0
  const safeActiveErrorIndex = hasVisibleErrors
    ? Math.min(activeErrorIndex, errorEntries.length - 1)
    : 0
  const activeError = hasVisibleErrors ? errorEntries[safeActiveErrorIndex] : null
  const showErrorsInPanel = errorOverlayPosition === 'panel'
  const showErrorsOverPreview = hasVisibleErrors && !showErrorsInPanel
  const errorBadgeLabel =
    errorEntries.length > 0
      ? `${errorEntries.length} error${errorEntries.length === 1 ? '' : 's'}`
      : 'clean'
  const isStatusBusy = isBusyStatus(applyStatus, previewLoading)
  const hmrLogLines = hmrExpanded
    ? hmrEvents.length > 0
      ? hmrEvents
      : ['[WAITING]']
    : [hmrEvent || '[WAITING]']

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams(window.location.search)
    const control = params.get('control') || DEFAULT_CONTROL_ORIGIN
    const preview = params.get('preview')
    const sandbox = params.get('sandbox') || ''

    setControlOrigin(control)
    window.localStorage.removeItem(SANDBOX_STORAGE_KEY)

    async function initializePreview() {
      try {
        if (preview) {
          setPreviewOrigin(preview)
          setPreviewLoading(false)
          setApplyStatus('Ready')
          setControlReady(true)
          return
        }

        const payload = await fetchPreviewSession(control, sandbox, {
          ignore: !sandbox,
          restart: !sandbox,
        })
        if (cancelled) {
          return
        }

        applyPreviewPayload(payload)
        setPreviewLoading(false)
        setApplyStatus(
          payload.mode === 'sandbox' ? 'Sandbox preview ready' : 'Ready'
        )
        setControlReady(true)
      } catch (error) {
        if (!cancelled) {
          setPreviewLoading(false)
          setApplyStatus(error.message || String(error))
          setControlReady(true)
        }
      }
    }

    initializePreview()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!controlReady || !previewOrigin) {
      return
    }

    let cancelled = false

    async function loadScenarios() {
      const response = await fetch(
        buildApiUrl(controlOrigin, '/api/test-edits', sessionParams())
      )
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load scenarios.')
      }
      const nextScenarios = payload.scenarios || []
      const initial =
        nextScenarios.find((scenario) => scenario.name === 'build:syntax') ||
        nextScenarios[0]

      if (cancelled) {
        return
      }

      setScenarios(nextScenarios)
      if (payload.preview) {
        applyPreviewPayload(payload.preview)
      }
      if (initial) {
        selectScenario(initial)
      }
    }

    loadScenarios().catch((error) => {
      if (!cancelled) {
        setApplyStatus(error.message || String(error))
      }
    })

    return () => {
      cancelled = true
    }
  }, [controlOrigin, controlReady, previewOrigin, sandboxId])

  useEffect(() => {
    const previousErrorCount = previousErrorCountRef.current
    previousErrorCountRef.current = errorEntries.length

    setActiveErrorIndex((currentIndex) => {
      if (errorEntries.length === 0) {
        return 0
      }

      if (errorEntries.length > previousErrorCount) {
        return errorEntries.length - 1
      }

      return Math.min(currentIndex, errorEntries.length - 1)
    })
  }, [errorEntries.length])

  useEffect(() => {
    if (!controlReady || !previewOrigin) {
      return
    }

    const source = new EventSource(
      buildApiUrl(
        controlOrigin,
        '/api/next-dev-bridge-events',
        sessionParams({ target: previewOrigin })
      )
    )

    source.addEventListener('next-dev-bridge', (message) => {
      const payload = JSON.parse(message.data)
      const event = payload.event
      const formattedEvent = formatHmrEvent(event)

      if (formattedEvent) {
        setHmrEvent(formattedEvent)
        setHmrEvents((events) => [...events, formattedEvent].slice(-120))
      }

      if (event.type === 'build:error' && !suppressBuildErrorsRef.current) {
        probeBuildErrorRef.current = false
        setBuildErrors(event.errors || [])
      }

      if (event.type === 'build:ready' || event.type === 'build:recovered') {
        suppressBuildErrorsRef.current = false
        if (!probeBuildErrorRef.current) {
          setBuildErrors([])
        }
        // Next's overlay treats build success and runtime recovery separately.
        finishPendingResetPreviewReload()
      }
    })

    source.addEventListener('sandbox-observer-ready', (message) => {
      const payload = JSON.parse(message.data)
      setApplyStatus(`Sandbox observer ready - ${payload.target}`)
    })

    source.addEventListener('sandbox-observer', (message) => {
      const payload = JSON.parse(message.data)
      setApplyStatus(`Sandbox observer starting - ${payload.target}`)
    })

    let restartingStaleSandbox = false
    source.addEventListener('sandbox-stale', (message) => {
      if (restartingStaleSandbox) {
        return
      }

      restartingStaleSandbox = true
      const payload = JSON.parse(message.data)
      setApplyStatus('Sandbox expired - starting a new preview')

      fetchPreviewSession(controlOrigin, payload.sandboxId || sandboxId, {
        restart: true,
      })
        .then((preview) => {
          source.close()
          applyPreviewPayload(preview)
          clearVisibleErrors(true)
          setPreviewVersion((value) => value + 1)
          setApplyStatus('Sandbox preview ready')
        })
        .catch((error) => {
          restartingStaleSandbox = false
          setApplyStatus(error.message || String(error))
        })
    })

    source.addEventListener('local-observer', () => {
      setApplyStatus('Ready')
    })

    source.addEventListener('error', () => {
      setApplyStatus('HMR event stream disconnected')
    })

    return () => {
      source.close()
    }
  }, [controlOrigin, controlReady, previewOrigin, sandboxId])

  useEffect(() => {
    function onMessage(message) {
      const expectedOrigin = getMessageTargetOrigin(previewOrigin)
      if (expectedOrigin && message.origin !== expectedOrigin) {
        return
      }

      const payload = message.data
      if (!payload) {
        return
      }

      if (payload.type === 'next-dev-bridge:runtime-ready') {
        if (
          payload.existing === false &&
          payload.windowId &&
          payload.windowId !== runtimeWindowIdRef.current
        ) {
          runtimeWindowIdRef.current = payload.windowId
          setRuntimeErrors([])
        }
        return
      }

      if (payload.type !== 'next-dev-bridge:runtime') {
        return
      }

      if (payload.event?.type === 'runtime:error') {
        const nextError = payload.event.error
        if (!nextError) {
          return
        }
        if (payload.windowId) {
          runtimeWindowIdRef.current = payload.windowId
        }

        setRuntimeErrors((currentErrors) => {
          const signature = getRuntimeErrorSignature(nextError)
          if (
            currentErrors.some(
              (error) => getRuntimeErrorSignature(error) === signature
            )
          ) {
            return currentErrors
          }

          return [...currentErrors, nextError]
        })
        return
      }

      if (payload.event?.type === 'runtime:cleared') {
        if (
          payload.windowId &&
          runtimeWindowIdRef.current &&
          payload.windowId !== runtimeWindowIdRef.current
        ) {
          return
        }
        setRuntimeErrors([])
      }
    }

    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
    }
  }, [previewOrigin])

  function applyPreviewPayload(preview) {
    if (!preview) {
      return
    }

    if (preview.previewOrigin) {
      setPreviewOrigin(preview.previewOrigin)
    }

    if (preview.mode) {
      setPreviewMode(preview.mode)
    }

    if (preview.sandboxId) {
      setSandboxId(preview.sandboxId)
      window.localStorage.removeItem(SANDBOX_STORAGE_KEY)
    }
  }

  function sessionParams(extra = {}) {
    return sandboxId
      ? {
          ...extra,
          sandbox: sandboxId,
        }
      : extra
  }

  async function fetchPreviewSession(control, sandbox, options = {}) {
    const params = sandbox
      ? {
          sandbox,
        }
      : {}

    if (options.restart) {
      params.restart = '1'
    }
    if (options.ignore) {
      params.ignore = '1'
    }

    const response = await fetch(
      buildApiUrl(control, '/api/preview-sandbox', params),
      {
        method: 'POST',
      }
    )
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(payload.error || 'Failed to start preview.')
    }

    return payload
  }

  function selectScenario(scenario) {
    const firstEdit = scenario.edits?.[0]
    setSelectedScenario(scenario.name)
    setPreviewPath(scenario.route || previewPath)
    setEditPath(firstEdit?.path || '')
    setEditContent(firstEdit?.content || '')
  }

  async function applyCurrentEdit() {
    if (!editPath) {
      return
    }

    suppressBuildErrorsRef.current = false
    setApplyStatus(`Writing ${editPath}`)

    if (selectedScenario && selected?.edits?.length > 1) {
      const scenarioResponse = await fetch(
        buildApiUrl(controlOrigin, '/api/test-edits', sessionParams()),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            scenario: selectedScenario,
            skipProbe: true,
          }),
        }
      )

      if (!scenarioResponse.ok) {
        const payload = await scenarioResponse.json().catch(() => ({}))
        throw new Error(
          payload.error || `Failed to prepare ${selectedScenario}.`
        )
      }
    }

    const response = await fetch(
      buildApiUrl(controlOrigin, '/api/test-edits', sessionParams()),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          path: editPath,
          content: editContent,
          probePath: selected?.route || previewPath,
        }),
      }
    )

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.error || 'Failed to apply edit.')
    }

    const payload = await response.json().catch(() => ({}))
    if (payload.preview) {
      applyPreviewPayload(payload.preview)
    }
    reloadPreviewAfterEdit()
    applyProbePayload(payload.probe)
    setApplyStatus(`Applied ${selectedScenario || editPath}`)
  }

  async function applyNamedScenario(name) {
    const scenario = scenarios.find((entry) => entry.name === name)
    suppressBuildErrorsRef.current = name === 'reset'
    pendingResetPreviewRef.current = name === 'reset'
    setApplyStatus(`Applying ${name}`)

    const response = await fetch(
      buildApiUrl(controlOrigin, '/api/test-edits', sessionParams()),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          scenario: name,
          probePath: name === 'reset' ? previewPath : scenario?.route,
        }),
      }
    )

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.error || `Failed to apply ${name}.`)
    }

    const payload = await response.json().catch(() => ({}))
    if (payload.preview) {
      applyPreviewPayload(payload.preview)
    }
    if (scenario?.route && name !== 'reset') {
      setPreviewPath(scenario.route)
    }
    if (name !== 'reset') {
      reloadPreviewAfterEdit()
    }
    clearVisibleErrors(name === 'reset')
    applyProbePayload(payload.probe)
    setApplyStatus(
      name === 'reset' ? 'Reset written' : `Applied ${name}`
    )
    if (name === 'reset' && payload.probe?.ok) {
      suppressBuildErrorsRef.current = false
      finishPendingResetPreviewReload()
    }
  }

  function reloadPreviewAfterEdit() {
    setPreviewVersion((value) => value + 1)
  }

  function clearVisibleErrors(clearFeed = false) {
    probeBuildErrorRef.current = false
    setBuildErrors([])
    setRuntimeErrors([])
    resetRuntimeObserver()
    if (clearFeed) {
      setHmrEvent(null)
      setHmrEvents([])
      setHmrExpanded(false)
    }
  }

  function applyProbePayload(probe) {
    if (!probe || suppressBuildErrorsRef.current) {
      return
    }

    if (!probe.error) {
      if (probe.ok) {
        probeBuildErrorRef.current = false
        setBuildErrors([])
      }
      return
    }

    const formattedError = formatProbeBuildError(probe)
    const logEntry = `[ERROR] count=1 source=probe status=${probe.status}`
    probeBuildErrorRef.current = true
    setBuildErrors([formattedError])
    setHmrEvent(logEntry)
    setHmrEvents((events) => [...events, logEntry].slice(-120))
  }

  function resetRuntimeObserver() {
    const frameWindow = previewFrameRef.current?.contentWindow
    if (!frameWindow) {
      return
    }

    frameWindow.postMessage(
      {
        type: 'next-dev-bridge:runtime-reset',
      },
      getMessageTargetOrigin(previewOrigin) || '*'
    )
  }

  async function handleApplyCurrentEdit() {
    try {
      await applyCurrentEdit()
    } catch (error) {
      setApplyStatus(error.message || String(error))
    }
  }

  async function handleReset() {
    try {
      suppressBuildErrorsRef.current = true
      pendingResetPreviewRef.current = true
      clearVisibleErrors(true)
      setApplyStatus('Resetting fixture')
      await applyNamedScenario('reset')
    } catch (error) {
      suppressBuildErrorsRef.current = false
      pendingResetPreviewRef.current = false
      setApplyStatus(error.message || String(error))
    }
  }

  function finishPendingResetPreviewReload() {
    if (!pendingResetPreviewRef.current) {
      return
    }

    pendingResetPreviewRef.current = false
    setPreviewPath('/')
    setPreviewVersion((value) => value + 1)
    setApplyStatus('Reset complete')
  }

  function showPreviousError() {
    setActiveErrorIndex((currentIndex) =>
      errorEntries.length <= 1
        ? 0
        : (currentIndex - 1 + errorEntries.length) % errorEntries.length
    )
  }

  function showNextError() {
    setActiveErrorIndex((currentIndex) =>
      errorEntries.length <= 1 ? 0 : (currentIndex + 1) % errorEntries.length
    )
  }

  function renderErrorViewer() {
    if (!activeError) {
      return null
    }

    return (
      <div className="errorViewer">
        <div className="errorNav">
          <button
            className="errorNavButton"
            disabled={errorEntries.length <= 1}
            onClick={showPreviousError}
            type="button"
          >
            {'<'}
          </button>
          <span className="errorNavLabel">
            {activeError.label} - {safeActiveErrorIndex + 1} /{' '}
            {errorEntries.length}
          </span>
          <button
            className="errorNavButton"
            disabled={errorEntries.length <= 1}
            onClick={showNextError}
            type="button"
          >
            {'>'}
          </button>
        </div>
        <pre className={activeError.className} key={activeError.key}>
          {activeError.body}
        </pre>
      </div>
    )
  }

  return (
    <main className="webDemoShell">
      <section className="editWorkbench">
        <div className="workbenchHeader">
          <p className="eyebrow">Next app test edits</p>
          <h1>Edits</h1>
          <p>
            Pick one source change, edit the file body if needed, then apply it
            to the separate preview app.
          </p>
          <p className="previewSessionStatus">
            <LoadingStatus
              busy={!previewOrigin && isStatusBusy}
              text={
                previewOrigin
                  ? `${previewMode || 'local'} preview - ${previewOrigin}`
                  : applyStatus
              }
            />
          </p>
        </div>

        <label className="scenarioSelectLabel" htmlFor="scenario-select">
          <span>Scenario</span>
          <select
            className="scenarioSelect"
            id="scenario-select"
            disabled={previewLoading || scenarios.length === 0}
            onChange={(event) => {
              const scenario = scenarios.find(
                (entry) => entry.name === event.target.value
              )
              if (scenario) {
                selectScenario(scenario)
              }
            }}
            value={selectedScenario}
          >
            {scenarios
              .filter((scenario) => scenario.name !== 'reset')
              .map((scenario) => (
                <option key={scenario.name} value={scenario.name}>
                  {scenario.name}
                </option>
              ))}
          </select>
        </label>

        {selected ? (
          <p className="scenarioDescription">{selected.description}</p>
        ) : null}

        <div className="previewRouteControl" aria-label="Preview route">
          <span>Preview</span>
          <div className="routeButtons">
            {PREVIEW_ROUTES.map((route) => (
              <button
                className={
                  route.path === previewPath
                    ? 'routeButton routeButtonActive'
                    : 'routeButton'
                }
                disabled={previewLoading || scenarios.length === 0}
                key={route.path}
                onClick={() => {
                  const scenario = scenarios.find(
                    (entry) => entry.name === route.scenario
                  )

                  if (scenario) {
                    selectScenario(scenario)
                  }

                  if (route.path === previewPath) {
                    return
                  }

                  setPreviewPath(route.path)
                  setPreviewVersion((value) => value + 1)
                }}
                type="button"
              >
                {route.label}
              </button>
            ))}
          </div>
        </div>

        <label className="editLabel" htmlFor="edit-content">
          Editing <code>{editPath || 'select a scenario'}</code>
        </label>
        <textarea
          className="editTextarea"
          disabled={previewLoading || !editPath}
          id="edit-content"
          onChange={(event) => setEditContent(event.target.value)}
          spellCheck={false}
          value={editContent}
        />

        <div className="editActions">
          <div className="actionButtons">
            <button
              className="primaryAction"
              disabled={previewLoading || !editPath}
              onClick={handleApplyCurrentEdit}
              type="button"
            >
              Apply edit
            </button>
            <button
              className="secondaryAction"
              disabled={previewLoading || scenarios.length === 0}
              onClick={handleReset}
              type="button"
            >
              Reset
            </button>
          </div>
          <span className="actionStatus">
            <LoadingStatus busy={isStatusBusy} text={applyStatus} />
          </span>
        </div>
      </section>

      <section className="previewWorkbench">
        <div className="previewFrameWrap">
          {previewSrc ? (
            <iframe
              className="previewFrame"
              ref={previewFrameRef}
              src={previewSrc}
              title="Separate Next preview app"
            />
          ) : (
            <div className="previewStarting">
              <LoadingStatus
                busy={isStatusBusy}
                className="previewStartingStatus"
                size={18}
                text={applyStatus}
              />
            </div>
          )}
          {showErrorsOverPreview ? (
            <div
              className={
                errorOverlayPosition === 'preview-center'
                  ? 'previewErrorOverlay previewErrorOverlayCenter'
                  : 'previewErrorOverlay previewErrorOverlayCorner'
              }
            >
              {renderErrorViewer()}
            </div>
          ) : null}
        </div>

        <div className="errorInspector">
          <div className="inspectorHeader">
            <span className={hasVisibleErrors ? 'errorBadge' : 'okBadge'}>
              {errorBadgeLabel}
            </span>
            <div className="overlayPositionControl">
              <span>Error View Layout</span>
              <div className="overlayPositionButtons">
                {ERROR_OVERLAY_POSITIONS.map((position) => (
                  <button
                    aria-pressed={errorOverlayPosition === position.value}
                    className={
                      errorOverlayPosition === position.value
                        ? 'overlayPositionButton overlayPositionButtonActive'
                        : 'overlayPositionButton'
                    }
                    key={position.value}
                    onClick={() => setErrorOverlayPosition(position.value)}
                    type="button"
                  >
                    {position.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="errorScroll">
            {hasVisibleErrors && showErrorsInPanel ? (
              renderErrorViewer()
            ) : hasVisibleErrors ? (
              <div className="emptyErrors">Errors shown over preview.</div>
            ) : (
              <div className="emptyErrors">
                No captured errors.
              </div>
            )}

            <div className={hmrExpanded ? 'hmrFeed hmrFeedExpanded' : 'hmrFeed'}>
              <div className="hmrFeedHeader">
                <span>HMR logs ({hmrEvents.length})</span>
                <button
                  className="hmrExpandButton"
                  onClick={() => setHmrExpanded((value) => !value)}
                  type="button"
                >
                  {hmrExpanded ? 'Collapse' : 'Expand'}
                </button>
              </div>
              <div className="hmrFeedBody">
                {hmrLogLines.map((line, index) => (
                  <div className="hmrFeedLine" key={`${index}-${line}`}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}

function buildApiUrl(controlOrigin, pathname, params = {}) {
  const url = new URL(
    pathname,
    controlOrigin ? ensureTrailingSlash(controlOrigin) : window.location.origin
  )

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value)
    }
  }

  return controlOrigin ? url.href : `${url.pathname}${url.search}`
}

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`
}

function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function getMessageTargetOrigin(value) {
  if (!value) {
    return ''
  }

  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

function formatHmrEvent(event) {
  if (!event.type?.startsWith('build:')) {
    return null
  }

  if (event.type === 'build:error') {
    return joinLogParts([
      '[ERROR]',
      `count=${event.errors.length}`,
      event.hash ? `hash=${event.hash}` : null,
    ])
  }

  if (event.type === 'build:ready' || event.type === 'build:recovered') {
    return joinLogParts([
      `[${event.type === 'build:recovered' ? 'RECOVERED' : 'READY'}]`,
      event.hash ? `hash=${event.hash}` : null,
      `warnings=${event.warnings.length}`,
    ])
  }

  return `[${event.type.toUpperCase()}]`
}

function formatRuntimeError(error) {
  const lines = [
    `${error.name || 'Error'}: ${error.message || '(no message)'}`,
  ]
  const frames = getSourceMappedRuntimeFrames(error)
  const codeFrame = stripAnsi(getRuntimeCodeFrame(error))

  if (frames.length > 0) {
    for (const frame of frames.slice(0, 5)) {
      lines.push(`    at ${formatRuntimeFrame(frame)}`)
    }
  } else {
    const rawFrames = getRawRuntimeFrames(error)
    if (rawFrames.length > 0) {
      for (const frame of rawFrames.slice(0, 8)) {
        lines.push(`    at ${formatRawRuntimeFrame(frame)}`)
      }
    } else {
      const stack = getRuntimeStackFallback(error)
      if (stack) {
        lines.push(stack)
      }
    }
  }

  if (codeFrame) {
    lines.push(codeFrame)
  }

  return lines.join('\n')
}

function formatProbeBuildError(probe) {
  const error = probe.error || {}
  const message = stripAnsi(
    error.message || `Preview returned HTTP ${probe.status || 500}.`
  )
  const stack = stripAnsi(error.stack || '')
  const lines = [message]

  if (stack && !stack.includes(message)) {
    lines.push(stack)
  }

  return lines.join('\n')
}

function getSourceMappedRuntimeFrames(error) {
  return (
    error.mapped?.mappedFrames
      ?.map((frame) => {
        if (frame?.status !== 'fulfilled') {
          return null
        }
        return frame.value?.originalStackFrame || null
      })
      .filter(isSourceMappedFrame) || []
  )
}

function getRawRuntimeFrames(error) {
  return (
    error.mapped?.frames
      ?.filter((frame) => frame?.file && frame.line1 && frame.column1)
      .filter((frame) => !isNextDevRuntimeFrame(frame)) || []
  )
}

function isNextDevRuntimeFrame(frame) {
  const file = String(frame.file || '')
  const methodName = String(frame.methodName || '')

  return (
    file.includes('/node_modules_next_dist_') ||
    file.includes('/node_modules_react-dom_') ||
    file.includes('/node_modules_0') ||
    methodName.includes('schedulePerformWorkUntilDeadline')
  )
}

function isSourceMappedFrame(frame) {
  if (!frame) {
    return false
  }

  const file = frame.file || ''

  return (
    file &&
    !file.includes('/_next/static/') &&
    !file.includes('.next/') &&
    !/^https?:\/\//.test(file)
  )
}

function getRuntimeCodeFrame(error) {
  const frame = error.mapped?.mappedFrames?.find(
    (entry) => entry?.status === 'fulfilled' && entry.value?.originalCodeFrame
  )

  return frame?.value?.originalCodeFrame || ''
}

function formatRuntimeFrame(frame) {
  const file = getRuntimeFrameFileName(frame.file)
  const line = frame.line1 ? `:${frame.line1}` : ''
  const column = frame.column1 ? `:${frame.column1}` : ''

  return `${file}${line}${column}`
}

function formatRawRuntimeFrame(frame) {
  const methodName =
    frame.methodName && frame.methodName !== '<anonymous>'
      ? `${frame.methodName} `
      : ''
  const file = getRuntimeFrameFileName(frame.file)
  const line = frame.line1 ? `:${frame.line1}` : ''
  const column = frame.column1 ? `:${frame.column1}` : ''

  return `${methodName}(${file}${line}${column})`
}

function getRuntimeFrameFileName(file) {
  if (!file || typeof file !== 'string') {
    return '<unknown>'
  }

  const cleanFile = file.split('?')[0]
  return cleanFile.split(/[\\/]/).pop() || cleanFile
}

function getRuntimeStackFallback(error) {
  const stack = stripAnsi(error.stack || '')
  if (!stack) {
    return ''
  }

  const lines = stack.split('\n')
  const firstFrameIndex = lines.findIndex((line) => line.trim().startsWith('at '))
  if (firstFrameIndex === -1) {
    return ''
  }

  return lines.slice(firstFrameIndex, firstFrameIndex + 8).join('\n')
}

function stripAnsi(value) {
  return String(value || '').replace(
    // eslint-disable-next-line no-control-regex
    /\x1B\[[0-?]*[ -/]*[@-~]/g,
    ''
  )
}

function getRuntimeErrorSignature(error) {
  return [error.source, error.name, error.message, error.stack].join('\n')
}

function joinLogParts(parts) {
  return parts.filter(Boolean).join(' ')
}

function LoadingStatus({ busy, className = '', size = 14, text }) {
  return (
    <span
      className={[
        busy ? 'loadingStatus loadingStatusBusy' : 'loadingStatus',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {busy ? (
        <CircularLoading
          aria-hidden="true"
          className="statusSpinner"
          size={size}
          stroke="currentColor"
          strokeWidth={3}
        />
      ) : null}
      <span className="loadingStatusText">{text}</span>
    </span>
  )
}

function isBusyStatus(status, previewLoading) {
  if (previewLoading) {
    return true
  }

  return /^(Starting|Writing|Applying|Resetting|Sandbox observer starting|Sandbox expired)/.test(
    status || ''
  )
}
