'use client'

import { useEffect, useRef, useState } from 'react'

const PREVIEW_ROUTES = [
  { path: '/build-errors', label: 'Build errors' },
  { path: '/runtime-effect', label: 'Runtime effect' },
  { path: '/runtime-errors', label: 'Runtime errors' },
]
const ERROR_OVERLAY_POSITIONS = [
  { value: 'panel', label: 'Status panel' },
  { value: 'preview-center', label: 'Preview center' },
  { value: 'preview-corner', label: 'Preview corner' },
]
const DEFAULT_CONTROL_ORIGIN = 'http://127.0.0.1:3010'
const DEFAULT_PREVIEW_ORIGIN = 'http://127.0.0.1:3001'
const DEV_UI_SELECTORS = [
  'nextjs-portal',
  'nextjs-toast',
  'nextjs-static-indicator-toast-wrapper',
  'nextjs-dev-tools-indicator',
  'script[data-nextjs-dev-overlay]',
  '#data-devtools-indicator',
  '#panel-route',
  '.dev-tools-indicator-menu',
  '.dev-tools-indicator-inner',
  '.dev-tools-indicator-item',
  '[data-nextjs-toast]',
  '[data-nextjs-dialog]',
  '[data-nextjs-dialog-overlay]',
  '[data-nextjs-error-overlay]',
  '[data-nextjs-dev-tools-button]',
  '[data-nextjs-dev-overlay]',
  '[data-nextjs-build-indicator]',
  '[data-nextjs-route-type]',
  '[data-segment-explorer]',
  '#__next-build-watcher',
  '#__next-prerender-indicator',
]
const HIDE_DEV_UI_CSS = `${DEV_UI_SELECTORS.join(',')} {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}`

export function NextdWeb() {
  const previewFrameRef = useRef(null)
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
  const [hmrEvents, setHmrEvents] = useState([])
  const [buildErrors, setBuildErrors] = useState([])
  const [runtimeEvents, setRuntimeEvents] = useState([])
  const [errorOverlayPosition, setErrorOverlayPosition] = useState('panel')

  const selected = scenarios.find((scenario) => scenario.name === selectedScenario)
  const previewSrc = previewOrigin
    ? `${previewOrigin}${previewPath}?nextdPreview=${previewVersion}`
    : ''
  const runtimeErrors = runtimeEvents
    .filter((event) => event.kind === 'error')
    .slice(-4)
  const errorEntries =
    buildErrors.length > 0
      ? buildErrors.map((error, index) => ({
          body: error,
          className: 'errorBlock',
          key: `build-${index}-${error.slice(0, 24)}`,
        }))
      : runtimeErrors.map((event) => ({
          body: formatRuntimeEvent(event),
          className: 'errorBlock runtimeBlock',
          key: `runtime-${event.id}`,
        }))
  const hasVisibleErrors = errorEntries.length > 0
  const showErrorsInPanel = errorOverlayPosition === 'panel'
  const showErrorsOverPreview = hasVisibleErrors && !showErrorsInPanel
  const errorBadgeLabel =
    buildErrors.length > 0
      ? `${buildErrors.length} build error${buildErrors.length === 1 ? '' : 's'}`
      : runtimeErrors.length > 0
        ? `${runtimeErrors.length} runtime error${runtimeErrors.length === 1 ? '' : 's'}`
        : 'build clean'

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const control = params.get('control') || DEFAULT_CONTROL_ORIGIN
    const preview = params.get('preview') || DEFAULT_PREVIEW_ORIGIN

    setControlOrigin(control)
    setPreviewOrigin(preview)
  }, [])

  useEffect(() => {
    disableNextDevIndicator(previewOrigin)
    hidePreviewIframeDevUi(previewFrameRef.current)

    const timer = setInterval(() => {
      hidePreviewIframeDevUi(previewFrameRef.current)
    }, 500)

    return () => {
      clearInterval(timer)
    }
  }, [previewOrigin, previewSrc])

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
    if (!controlOrigin) {
      return
    }

    const source = new EventSource(`${controlOrigin}/api/nextd-events`)

    source.addEventListener('nextd', (message) => {
      const payload = JSON.parse(message.data)
      const event = payload.event

      setHmrEvents((events) => appendHmrEvent(events, formatHmrEvent(event)))

      if (event.type === 'build:error' && !suppressBuildErrorsRef.current) {
        setBuildErrors(event.formattedErrors || event.errors || [])
      }

      if (event.type === 'build:ready' || event.type === 'build:recovered') {
        suppressBuildErrorsRef.current = false
        setBuildErrors([])
        finishPendingResetPreviewReload()
      }
    })

    return () => {
      source.close()
    }
  }, [controlOrigin])

  useEffect(() => {
    if (!previewOrigin || buildErrors.length > 0) {
      return
    }

    let cancelled = false

    async function pollRuntimeEvents() {
      try {
        const response = await fetch(`${previewOrigin}/api/runtime-events`)
        const payload = await response.json()
        if (!cancelled) {
          setRuntimeEvents(payload.events || [])
        }
      } catch {}
    }

    pollRuntimeEvents()
    const timer = setInterval(pollRuntimeEvents, 800)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [buildErrors.length, previewOrigin])

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
    await resetRuntimeEventsIfNeeded()

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
    await resetRuntimeEventsIfNeeded(scenario)

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
    if (name !== 'reset') {
      setPreviewVersion((value) => value + 1)
    }
    clearVisibleErrors(name === 'reset')
    setApplyStatus(
      name === 'reset' ? 'Reset written' : `Applied ${name}`
    )
  }

  function clearVisibleErrors(clearFeed = false) {
    setBuildErrors([])
    setRuntimeEvents([])
    if (clearFeed) {
      setHmrEvents([])
    }
  }

  async function resetRuntimeEventsIfNeeded(scenario = selected) {
    const route = scenario?.route || previewPath

    if (scenario?.name !== 'reset' && !route.startsWith('/runtime')) {
      return
    }

    if (!previewOrigin) {
      return
    }

    await fetch(`${previewOrigin}/api/runtime-events`, {
      method: 'DELETE',
    }).catch(() => {})
    setRuntimeEvents([])
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
            onLoad={() => hidePreviewIframeDevUi(previewFrameRef.current)}
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
              {errorEntries.map((entry) => (
                <pre className={entry.className} key={entry.key}>
                  {entry.body}
                </pre>
              ))}
            </div>
          ) : null}
        </div>

        <div className="errorInspector">
          <div className="inspectorHeader">
            <span className={hasVisibleErrors ? 'errorBadge' : 'okBadge'}>
              {errorBadgeLabel}
            </span>
            <div className="overlayPositionControl">
              <span>Errors</span>
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
              errorEntries.map((entry) => (
                <pre className={entry.className} key={entry.key}>
                  {entry.body}
                </pre>
              ))
            ) : hasVisibleErrors ? (
              <div className="emptyErrors">Errors shown over preview.</div>
            ) : (
              <div className="emptyErrors">
                No captured errors.
              </div>
            )}

            <div className="hmrFeed">
              {hmrEvents.map((event, index) => (
                <div className="hmrFeedLine" key={`${event}-${index}`}>
                  {event}
                </div>
              ))}
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
    return `[ERROR] count=${event.formattedErrorCount} hash=${event.hash || 'n/a'}`
  }

  if (event.type === 'build:ready' || event.type === 'build:recovered') {
    return `[${event.type === 'build:recovered' ? 'RECOVERED' : 'READY'}] hash=${event.hash || 'n/a'} warnings=${event.formattedWarningCount}`
  }

  if (event.type === 'build:compiling') {
    return `[COMPILING] build=${event.buildId}`
  }

  return `[${event.type.toUpperCase()}]`
}

function appendHmrEvent(events, event) {
  if (!event || events[0] === event) {
    return events
  }

  return [event, ...events.filter((entry) => entry !== event)].slice(0, 5)
}

function formatRuntimeEvent(event) {
  return [
    `runtime error [${event.category || 'runtime'}] id=${event.id}`,
    event.message,
  ].join('\n')
}

function disableNextDevIndicator(previewOrigin) {
  if (typeof window === 'undefined') {
    return
  }

  for (const origin of new Set([window.location.origin, previewOrigin])) {
    if (!origin) {
      continue
    }

    fetch(`${origin}/__nextjs_disable_dev_indicator`, {
      method: 'POST',
      mode: origin === window.location.origin ? 'same-origin' : 'no-cors',
    }).catch(() => {})
  }
}

function hidePreviewIframeDevUi(iframe) {
  try {
    const frameDocument =
      iframe?.contentDocument || iframe?.contentWindow?.document

    if (!frameDocument) {
      return false
    }

    hideDevUiInRoot(frameDocument, frameDocument)

    for (const element of frameDocument.querySelectorAll('*')) {
      if (element.shadowRoot) {
        hideDevUiInRoot(element.shadowRoot, frameDocument)
      }
    }

    return true
  } catch {
    return false
  }
}

function hideDevUiInRoot(root, ownerDocument) {
  installHideStyle(root, ownerDocument)

  const selector = DEV_UI_SELECTORS.join(',')
  for (const node of root.querySelectorAll(selector)) {
    node.setAttribute('data-nextd-hidden-dev-ui', 'true')
    node.style.setProperty('display', 'none', 'important')
    node.style.setProperty('visibility', 'hidden', 'important')
    node.style.setProperty('opacity', '0', 'important')
    node.style.setProperty('pointer-events', 'none', 'important')
  }
}

function installHideStyle(root, ownerDocument) {
  if (root.getElementById?.('nextd-hide-dev-ui')) {
    return
  }

  const style = ownerDocument.createElement('style')
  style.id = 'nextd-hide-dev-ui'
  style.textContent = HIDE_DEV_UI_CSS
  const target = root.head || root.documentElement || root
  target.appendChild(style)
}
