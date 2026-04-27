'use client'

import { useEffect, useRef, useState } from 'react'

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
  { value: 'panel', label: 'Status panel' },
  { value: 'preview-center', label: 'Preview center' },
  { value: 'preview-corner', label: 'Preview corner' },
]
const DEFAULT_CONTROL_ORIGIN = 'http://127.0.0.1:3010'
const DEFAULT_PREVIEW_ORIGIN = 'http://127.0.0.1:3001'

export function NextoWeb() {
  const previewFrameRef = useRef(null)
  const runtimeWindowIdRef = useRef(null)
  const previousErrorCountRef = useRef(0)
  const suppressBuildErrorsRef = useRef(false)
  const pendingResetPreviewRef = useRef(false)
  const [controlOrigin, setControlOrigin] = useState(DEFAULT_CONTROL_ORIGIN)
  const [previewOrigin, setPreviewOrigin] = useState(DEFAULT_PREVIEW_ORIGIN)
  const [scenarios, setScenarios] = useState([])
  const [selectedScenario, setSelectedScenario] = useState('')
  const [editPath, setEditPath] = useState('')
  const [editContent, setEditContent] = useState('')
  const [previewPath, setPreviewPath] = useState('/build-errors')
  const [previewVersion, setPreviewVersion] = useState(0)
  const [applyStatus, setApplyStatus] = useState('Ready')
  const [hmrEvent, setHmrEvent] = useState(null)
  const [hmrEvents, setHmrEvents] = useState([])
  const [hmrExpanded, setHmrExpanded] = useState(false)
  const [buildErrors, setBuildErrors] = useState([])
  const [runtimeErrors, setRuntimeErrors] = useState([])
  const [activeErrorIndex, setActiveErrorIndex] = useState(0)
  const [errorOverlayPosition, setErrorOverlayPosition] = useState('panel')

  const selected = scenarios.find((scenario) => scenario.name === selectedScenario)
  const previewSrc = previewOrigin
    ? `${previewOrigin}${previewPath}?nextoPreview=${previewVersion}`
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
  const hmrLogLines = hmrExpanded
    ? hmrEvents.length > 0
      ? hmrEvents
      : ['[WAITING]']
    : [hmrEvent || '[WAITING]']

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const control = params.get('control') || DEFAULT_CONTROL_ORIGIN
    const preview = params.get('preview') || DEFAULT_PREVIEW_ORIGIN

    setControlOrigin(control)
    setPreviewOrigin(preview)
  }, [])

  useEffect(() => {
    if (!controlOrigin) {
      return
    }

    let cancelled = false

    async function loadScenarios() {
      const response = await fetch(`${controlOrigin}/api/test-edits`)
      const payload = await response.json()
      const nextScenarios = payload.scenarios || []
      const initial =
        nextScenarios.find((scenario) => scenario.name === 'build:syntax') ||
        nextScenarios[0]

      if (cancelled) {
        return
      }

      setScenarios(nextScenarios)
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
  }, [controlOrigin])

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
    if (!controlOrigin) {
      return
    }

    const source = new EventSource(`${controlOrigin}/api/nexto-events`)

    source.addEventListener('nexto', (message) => {
      const payload = JSON.parse(message.data)
      const event = payload.event
      const formattedEvent = formatHmrEvent(event)

      if (formattedEvent) {
        setHmrEvent(formattedEvent)
        setHmrEvents((events) => [...events, formattedEvent].slice(-120))
      }

      if (event.type === 'build:error' && !suppressBuildErrorsRef.current) {
        setBuildErrors(event.errors || [])
      }

      if (event.type === 'build:ready' || event.type === 'build:recovered') {
        suppressBuildErrorsRef.current = false
        setBuildErrors([])
        // Next's overlay treats build success and runtime recovery separately.
        finishPendingResetPreviewReload()
      }
    })

    return () => {
      source.close()
    }
  }, [controlOrigin])

  useEffect(() => {
    function onMessage(message) {
      if (previewOrigin && message.origin !== previewOrigin) {
        return
      }

      const payload = message.data
      if (!payload) {
        return
      }

      if (payload.type === 'nexto:runtime-ready') {
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

      if (payload.type !== 'nexto:runtime') {
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
      const scenarioResponse = await fetch(`${controlOrigin}/api/test-edits`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ scenario: selectedScenario }),
      })

      if (!scenarioResponse.ok) {
        const payload = await scenarioResponse.json().catch(() => ({}))
        throw new Error(
          payload.error || `Failed to prepare ${selectedScenario}.`
        )
      }
    }

    const response = await fetch(`${controlOrigin}/api/test-edits`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        path: editPath,
        content: editContent,
      }),
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.error || 'Failed to apply edit.')
    }

    setApplyStatus(`Applied ${selectedScenario || editPath}`)
  }

  async function applyNamedScenario(name) {
    const scenario = scenarios.find((entry) => entry.name === name)
    suppressBuildErrorsRef.current = name === 'reset'
    pendingResetPreviewRef.current = name === 'reset'
    setApplyStatus(`Applying ${name}`)

    const response = await fetch(`${controlOrigin}/api/test-edits`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ scenario: name }),
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.error || `Failed to apply ${name}.`)
    }

    if (scenario?.route && name !== 'reset') {
      setPreviewPath(scenario.route)
    }
    clearVisibleErrors(name === 'reset')
    setApplyStatus(
      name === 'reset' ? 'Reset written' : `Applied ${name}`
    )
  }

  function clearVisibleErrors(clearFeed = false) {
    setBuildErrors([])
    setRuntimeErrors([])
    resetRuntimeObserver()
    if (clearFeed) {
      setHmrEvent(null)
      setHmrEvents([])
      setHmrExpanded(false)
    }
  }

  function resetRuntimeObserver() {
    const frameWindow = previewFrameRef.current?.contentWindow
    if (!frameWindow) {
      return
    }

    frameWindow.postMessage(
      {
        type: 'nexto:runtime-reset',
      },
      previewOrigin || '*'
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
        </div>

        <label className="scenarioSelectLabel" htmlFor="scenario-select">
          <span>Scenario</span>
          <select
            className="scenarioSelect"
            id="scenario-select"
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
          id="edit-content"
          onChange={(event) => setEditContent(event.target.value)}
          spellCheck={false}
          value={editContent}
        />

        <div className="editActions">
          <div className="actionButtons">
            <button className="primaryAction" onClick={handleApplyCurrentEdit} type="button">
              Apply edit
            </button>
            <button className="secondaryAction" onClick={handleReset} type="button">
              Reset
            </button>
          </div>
          <span className="actionStatus">{applyStatus}</span>
        </div>
      </section>

      <section className="previewWorkbench">
        <div className="previewFrameWrap">
          <iframe
            className="previewFrame"
            ref={previewFrameRef}
            src={previewSrc}
            title="Separate Next preview app"
          />
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
  }

  if (codeFrame) {
    lines.push(codeFrame)
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

function getRuntimeFrameFileName(file) {
  if (!file || typeof file !== 'string') {
    return '<unknown>'
  }

  const cleanFile = file.split('?')[0]
  return cleanFile.split(/[\\/]/).pop() || cleanFile
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
