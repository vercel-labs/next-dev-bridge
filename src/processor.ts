import { serializeError, type SerializedError } from './errors.js'

const HMR_TYPES = {
  BUILDING: 'building',
  SYNC: 'sync',
  BUILT: 'built',
  SERVER_ERROR: 'serverError',
  TURBOPACK_CONNECTED: 'turbopack-connected',
} as const

export type { SerializedError }

export interface NextdState {
  connection: 'idle' | 'connecting' | 'connected' | 'disconnected'
  phase: 'idle' | 'compiling' | 'ok' | 'error'
  building: boolean
  buildCycle: number
  hasErrors: boolean
  hash: string | null
  errorCount: number
  warningCount: number
  errors: string[]
  warnings: string[]
  rawErrors: unknown[]
  rawWarnings: unknown[]
  firstError: string | null
  lastMessageType: string | null
  lastChangedAt: string | null
}

export type ProcessHMREvent =
  | {
      type: 'observer:error'
      reason: string
      raw?: string
      error: SerializedError
    }
  | {
      type: 'build:compiling'
      status: 'compiling'
      buildId: number
      at: string
    }
  | BuildReadyEvent
  | BuildRecoveredEvent
  | BuildErrorEvent
  | InternalHmrMessageEvent

interface BuildReadyEvent extends BuildSettledEvent {
  type: 'build:ready'
  status: 'ready'
}

interface BuildRecoveredEvent extends BuildSettledEvent {
  type: 'build:recovered'
  status: 'ready'
}

interface BuildErrorEvent extends BuildSettledEvent {
  type: 'build:error'
  status: 'error'
  change: 'shown' | 'updated' | 'unchanged'
  errors: string[]
  formattedErrors: string[]
  firstError: string | null
}

interface BuildSettledEvent {
  trigger: 'sync' | 'update' | 'server'
  internalType: string
  hash?: string | null
  errorCount: number
  hmrErrorCount: number
  formattedErrorCount: number
  warningCount: number
  hmrWarningCount: number
  formattedWarningCount: number
  warnings: string[]
  formattedWarnings: string[]
}

interface InternalHmrMessageEvent {
  type: 'internal:hmr-message'
  message: HmrMessageSummary
  rawMessage?: unknown
}

interface HmrMessageSummary {
  type: string
  hash?: string
  errors?: number
  warnings?: number
  sessionId?: number
  hasErrorJSON?: boolean
}

export interface ProcessHMROptions {
  verbose?: boolean
  raw?: boolean
  now?: () => Date | number | string
}

export type ProcessHMRListener = (
  event: ProcessHMREvent,
  state: NextdState
) => void

export interface ProcessHMRResult {
  events: ProcessHMREvent[]
  state: NextdState
}

export interface ProcessHMR {
  (raw: unknown, listener?: ProcessHMRListener): ProcessHMRResult
  getSnapshot(): NextdState
  reset(): NextdState
}

export function processHMR(options: ProcessHMROptions = {}): ProcessHMR {
  const processorOptions = {
    verbose: Boolean(options.verbose),
    raw: Boolean(options.raw),
    now: options.now,
  }
  const state = createInitialState()

  const processHmrMessage = ((
    raw: unknown,
    listener?: ProcessHMRListener
  ) => {
    const events: ProcessHMREvent[] = []
    const emit = (event: ProcessHMREvent) => {
      events.push(event)
      if (listener) {
        listener(event, cloneState(state))
      }
    }

    const parsed = parseHmrPayload(raw)
    if (parsed.error) {
      emit(parsed.error)
      return {
        events,
        state: cloneState(state),
      }
    }

    const message = parsed.message
    if (processorOptions.verbose) {
      emit({
        type: 'internal:hmr-message',
        message: summarizeHmrMessage(message),
        rawMessage: processorOptions.raw ? message : undefined,
      })
    }

    reduceHmrMessage(state, message, processorOptions, emit)
    return {
      events,
      state: cloneState(state),
    }
  }) as ProcessHMR

  processHmrMessage.getSnapshot = () => cloneState(state)
  processHmrMessage.reset = () => {
    Object.assign(state, createInitialState())
    return cloneState(state)
  }

  return processHmrMessage
}

function reduceHmrMessage(
  state: NextdState,
  message: Record<string, unknown>,
  options: ProcessHMROptions,
  emit: (event: ProcessHMREvent) => void
) {
  const messageType = typeof message.type === 'string' ? message.type : ''
  state.lastMessageType = messageType || null

  switch (messageType) {
    case HMR_TYPES.BUILDING: {
      const changedAt = timestamp(options)
      state.phase = 'compiling'
      state.building = true
      state.buildCycle += 1
      state.lastChangedAt = changedAt
      emit({
        type: 'build:compiling',
        status: 'compiling',
        buildId: state.buildCycle,
        at: changedAt,
      })
      return
    }

    case HMR_TYPES.SYNC:
    case HMR_TYPES.BUILT: {
      const rawErrors = Array.isArray(message.errors) ? message.errors : []
      const rawWarnings = Array.isArray(message.warnings) ? message.warnings : []
      const formatted = formatCompilerMessages({
        errors: rawErrors,
        warnings: rawWarnings,
      })

      state.building = false
      state.hash = typeof message.hash === 'string' ? message.hash : state.hash
      state.warningCount = formatted.warnings.length
      state.warnings = formatted.warnings
      state.rawWarnings = rawWarnings
      state.lastChangedAt = timestamp(options)

      if (formatted.errors.length > 0) {
        const previousSignature = state.errors.join('\n---\n')
        const nextSignature = formatted.errors.join('\n---\n')
        const change = state.hasErrors
          ? previousSignature === nextSignature
            ? 'unchanged'
            : 'updated'
          : 'shown'

        state.phase = 'error'
        state.hasErrors = true
        state.errorCount = formatted.errors.length
        state.errors = formatted.errors
        state.rawErrors = rawErrors
        state.firstError = formatted.errors[0] || null

        emit({
          type: 'build:error',
          status: 'error',
          change,
          trigger: messageType === HMR_TYPES.SYNC ? 'sync' : 'update',
          internalType: messageType,
          hash: state.hash,
          errorCount: state.errorCount,
          hmrErrorCount: rawErrors.length,
          formattedErrorCount: formatted.errors.length,
          warningCount: state.warningCount,
          hmrWarningCount: rawWarnings.length,
          formattedWarningCount: formatted.warnings.length,
          warnings: state.warnings,
          formattedWarnings: state.warnings,
          errors: state.errors,
          formattedErrors: state.errors,
          firstError: state.firstError,
        })
        return
      }

      const hadErrors = state.hasErrors
      state.phase = 'ok'
      state.hasErrors = false
      state.errorCount = 0
      state.errors = []
      state.rawErrors = []
      state.firstError = null

      emit({
        type: hadErrors ? 'build:recovered' : 'build:ready',
        status: 'ready',
        trigger: messageType === HMR_TYPES.SYNC ? 'sync' : 'update',
        internalType: messageType,
        hash: state.hash,
        errorCount: 0,
        hmrErrorCount: 0,
        formattedErrorCount: 0,
        warningCount: state.warningCount,
        hmrWarningCount: rawWarnings.length,
        formattedWarningCount: formatted.warnings.length,
        warnings: state.warnings,
        formattedWarnings: state.warnings,
      })
      return
    }

    case HMR_TYPES.SERVER_ERROR: {
      const hadErrors = state.hasErrors
      const rawError = parseServerErrorMessage(message)
      const formatted = formatCompilerMessages({
        errors: [rawError],
        warnings: [],
      })
      state.phase = 'error'
      state.building = false
      state.hasErrors = true
      state.errorCount = formatted.errors.length
      state.warningCount = 0
      state.errors = formatted.errors
      state.warnings = []
      state.rawErrors = [rawError]
      state.rawWarnings = []
      state.firstError = formatted.errors[0] || null
      state.lastChangedAt = timestamp(options)

      emit({
        type: 'build:error',
        status: 'error',
        change: hadErrors ? 'updated' : 'shown',
        trigger: 'server',
        internalType: messageType,
        errorCount: state.errorCount,
        hmrErrorCount: 1,
        formattedErrorCount: formatted.errors.length,
        warningCount: 0,
        hmrWarningCount: 0,
        formattedWarningCount: 0,
        warnings: [],
        formattedWarnings: [],
        errors: state.errors,
        formattedErrors: state.errors,
        firstError: state.firstError,
      })
      return
    }

    case HMR_TYPES.TURBOPACK_CONNECTED:
    default:
      return
  }
}

function timestamp(options: ProcessHMROptions) {
  const value = options.now ? options.now() : new Date()
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'number') {
    return new Date(value).toISOString()
  }
  return value
}

function createInitialState(): NextdState {
  return {
    connection: 'idle',
    phase: 'idle',
    building: false,
    buildCycle: 0,
    hasErrors: false,
    hash: null,
    errorCount: 0,
    warningCount: 0,
    errors: [],
    warnings: [],
    rawErrors: [],
    rawWarnings: [],
    firstError: null,
    lastMessageType: null,
    lastChangedAt: null,
  }
}

function summarizeHmrMessage(
  message: Record<string, unknown>
): HmrMessageSummary {
  const summary: HmrMessageSummary = {
    type: typeof message.type === 'string' ? message.type : 'unknown',
  }

  if (typeof message.hash === 'string') {
    summary.hash = message.hash
  }
  if (Array.isArray(message.errors)) {
    summary.errors = message.errors.length
  }
  if (Array.isArray(message.warnings)) {
    summary.warnings = message.warnings.length
  }
  if (message.type === HMR_TYPES.TURBOPACK_CONNECTED && isRecord(message.data)) {
    const sessionId = message.data.sessionId
    if (typeof sessionId === 'number') {
      summary.sessionId = sessionId
    }
  }
  if (message.type === HMR_TYPES.SERVER_ERROR) {
    summary.hasErrorJSON = Boolean(message.errorJSON)
  }

  return summary
}

function parseHmrPayload(raw: unknown):
  | { message: Record<string, unknown>; error?: never }
  | { message?: never; error: ProcessHMREvent } {
  if (typeof raw === 'string') {
    try {
      const message = JSON.parse(raw)
      if (isRecord(message)) {
        return { message }
      }
      return invalidHmrMessage(raw, new Error('HMR message must be an object'))
    } catch (error) {
      return invalidHmrMessage(raw, error)
    }
  }

  if (isRecord(raw)) {
    return { message: raw }
  }

  return invalidHmrMessage(undefined, new Error('Unsupported HMR message payload'))
}

function invalidHmrMessage(raw: string | undefined, error: unknown) {
  return {
    error: {
      type: 'observer:error',
      reason: 'invalid-hmr-message',
      raw,
      error: serializeError(error),
    } satisfies ProcessHMREvent,
  }
}

function parseServerErrorMessage(message: Record<string, unknown>) {
  if (!message.errorJSON) {
    return { message: 'Unknown HMR server error' }
  }

  try {
    return JSON.parse(String(message.errorJSON))
  } catch {
    return { message: String(message.errorJSON) }
  }
}

function formatCompilerMessages(
  json: { errors?: unknown[]; warnings?: unknown[] },
  verbose = false
) {
  const errors = (json.errors || []).map((message) =>
    formatCompilerMessage(message, verbose)
  )
  const warnings = (json.warnings || []).map((message) =>
    formatCompilerMessage(message, verbose)
  )

  const rscIndex = errors.findIndex((error) =>
    error.includes('ReactServerComponentsError')
  )
  if (rscIndex > 0) {
    const [rscError] = errors.splice(rscIndex, 1)
    errors.unshift(rscError)
  }

  if (!verbose && errors.some(isLikelySyntaxError)) {
    return {
      errors: errors.filter(isLikelySyntaxError),
      warnings: [],
    }
  }

  return { errors, warnings }
}

function formatCompilerMessage(input: unknown, verbose: boolean) {
  let message

  if (typeof input === 'string') {
    message = input
  } else if (input && typeof input === 'object') {
    const record = input as Record<string, any>
    const filteredTrace = Array.isArray(record.moduleTrace)
      ? record.moduleTrace.filter(
          (trace) =>
            !/next-(middleware|client-pages|route|edge-function)-loader\.js/.test(
              trace.originName || ''
            )
        )
      : []

    const parts = []
    if (record.moduleName) {
      parts.push(stripAnsi(String(record.moduleName)))
    }
    if (record.file) {
      parts.push(stripAnsi(String(record.file)))
    }
    if (record.message) {
      parts.push(String(record.message))
    }
    if (record.details && verbose) {
      parts.push(String(record.details))
    }
    if (filteredTrace.length > 0) {
      const traceLines = filteredTrace
        .map((trace) => trace.moduleName)
        .filter(Boolean)
      if (traceLines.length > 0) {
        parts.push(`Import trace for requested module:\n${traceLines.join('\n')}`)
      }
    }
    if (record.stack && verbose) {
      parts.push(String(record.stack))
    }

    message = parts.length > 0 ? parts.join('\n') : JSON.stringify(input)
  } else {
    message = String(input)
  }

  return cleanupCompilerMessage(message, verbose)
}

function cleanupCompilerMessage(message: string, verbose: boolean) {
  const loaderPaths = []
  let lines = stripAnsi(String(message)).split('\n')

  lines = lines.filter((line) => {
    const match = /Module [A-Za-z ]+\(from (.+)\):?\s*$/.exec(line)
    if (match) {
      loaderPaths.push(match[1])
      return false
    }
    return true
  })

  lines = lines.map((line) => {
    const parsingError = /Line (\d+):(?:(\d+):)?\s*Parsing error: (.+)$/.exec(
      line
    )
    if (!parsingError) {
      return line
    }
    const [, row, column, text] = parsingError
    return `Syntax error: ${text} (${row}:${column || 0})`
  })

  message = lines.join('\n')
  message = message.replace(
    /SyntaxError\s+\((\d+):(\d+)\)\s*(.+?)\n/g,
    'Syntax error: $3 ($1:$2)\n'
  )
  message = message.replace(
    /^.*export '(.+?)' was not found in '(.+?)'.*$/gm,
    "Attempted import error: '$1' is not exported from '$2'."
  )
  message = message.replace(
    /^.*export 'default' \(imported as '(.+?)'\) was not found in '(.+?)'.*$/gm,
    "Attempted import error: '$2' does not contain a default export (imported as '$1')."
  )
  message = message.replace(
    /^.*export '(.+?)' \(imported as '(.+?)'\) was not found in '(.+?)'.*$/gm,
    "Attempted import error: '$1' is not exported from '$3' (imported as '$2')."
  )

  lines = message.split('\n')

  if (lines.length > 2 && lines[1].trim() === '') {
    lines.splice(1, 1)
  }

  if (lines[1] && lines[1].startsWith('Module not found: ')) {
    lines = [
      lines[0],
      lines[1]
        .replace('Error: ', '')
        .replace('Module not found: Cannot find file:', 'Cannot find file:'),
      ...lines.slice(2),
    ]
  }

  if (!verbose) {
    message = lines.join('\n')
    message = message.replace(
      /^\s*at\s((?!webpack:).)*:\d+:\d+[\s)]*(\n|$)/gm,
      ''
    )
    message = message.replace(/^\s*at\s<anonymous>(\n|$)/gm, '')
    lines = message.split('\n')
  }

  for (const loaderPath of loaderPaths) {
    if (!/[/\\]next[/\\]dist[/\\]/.test(loaderPath)) {
      lines.push(`  (from ${loaderPath})`)
    }
  }

  lines = lines.filter(
    (line, index, allLines) =>
      index === 0 ||
      line.trim() !== '' ||
      line.trim() !== allLines[index - 1].trim()
  )

  return lines.join('\n').trim()
}

function isLikelySyntaxError(message: string) {
  return stripAnsi(message).includes('Syntax error:')
}

function stripAnsi(value: string) {
  return String(value).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}

function cloneState(state: NextdState): NextdState {
  return {
    ...state,
    errors: [...state.errors],
    warnings: [...state.warnings],
    rawErrors: [...state.rawErrors],
    rawWarnings: [...state.rawWarnings],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
