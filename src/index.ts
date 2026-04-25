import * as crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import * as net from 'node:net'
import * as tls from 'node:tls'

export const DEFAULT_DEV_SERVER_URL = 'http://localhost:3000'
export const DEFAULT_HMR_PATH = '/_next/webpack-hmr'
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 5000

export const HMR_TYPES = {
  BUILDING: 'building',
  SYNC: 'sync',
  BUILT: 'built',
  SERVER_ERROR: 'serverError',
  TURBOPACK_CONNECTED: 'turbopack-connected',
} as const

export interface ObserveNextHmrOptions {
  url?: string
  path?: string
  id?: string
  reconnect?: boolean
  maxReconnects?: number
  headers?: Record<string, string>
  verbose?: boolean
  raw?: boolean
}

export interface SerializedError {
  name: string
  message: string
  stack?: string
}

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

export type NextdEvent =
  | { type: 'session:connecting'; url: string }
  | { type: 'session:connected'; url: string }
  | { type: 'session:disconnected'; code?: number; reason?: string }
  | { type: 'session:reconnecting'; attempt: number; delayMs: number }
  | { type: 'session:reconnect-abandoned'; attempts: number }
  | { type: 'session:error'; error: SerializedError }
  | { type: 'observer:error'; reason: string; raw?: string; error: SerializedError }
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
  | InternalBinaryMessageEvent

export interface BuildReadyEvent extends BuildSettledEvent {
  type: 'build:ready'
  status: 'ready'
}

export interface BuildRecoveredEvent extends BuildSettledEvent {
  type: 'build:recovered'
  status: 'ready'
}

export interface BuildErrorEvent extends BuildSettledEvent {
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

export interface InternalHmrMessageEvent {
  type: 'internal:hmr-message'
  message: HmrMessageSummary
  rawMessage?: unknown
}

export interface InternalBinaryMessageEvent {
  type: 'internal:binary-message'
  byteLength: number
  opcode: number
}

export interface HmrMessageSummary {
  type: string
  hash?: string
  errors?: number
  warnings?: number
  sessionId?: number
  hasErrorJSON?: boolean
}

export type NextdEventListener = (
  event: NextdEvent,
  state: NextdState
) => void

export function observeNextHmr(
  options: ObserveNextHmrOptions | string = {},
  listener?: NextdEventListener
) {
  const normalizedOptions =
    typeof options === 'string' ? { url: options } : { ...(options || {}) }
  const observer = new NextHmrObserver(normalizedOptions)

  if (listener) {
    observer.on('event', listener)
  }

  observer.start()
  return observer
}

export function watchNextDevServer(
  options: ObserveNextHmrOptions | string = {},
  listener?: NextdEventListener
) {
  return observeNextHmr(options, listener)
}

export class NextHmrObserver extends EventEmitter {
  options: Required<Omit<ObserveNextHmrOptions, 'id'>> & { id?: string }
  state: NextdState
  reconnectAttempt: number
  closed: boolean
  socket: any
  reconnectTimer: ReturnType<typeof setTimeout> | null

  constructor(options: ObserveNextHmrOptions = {}) {
    super()
    this.options = {
      url: options.url || DEFAULT_DEV_SERVER_URL,
      path: options.path || DEFAULT_HMR_PATH,
      id: options.id,
      reconnect: options.reconnect !== false,
      maxReconnects:
        options.maxReconnects === undefined ? Infinity : options.maxReconnects,
      headers: options.headers || {},
      verbose: Boolean(options.verbose),
      raw: Boolean(options.raw),
    }
    this.state = createInitialState()
    this.reconnectAttempt = 0
    this.closed = false
    this.socket = null
    this.reconnectTimer = null
  }

  start() {
    this.closed = false
    this.connect()
  }

  stop() {
    this.closed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
  }

  getSnapshot() {
    return cloneState(this.state)
  }

  connect() {
    const wsUrl = buildHmrUrl(this.options)
    this.state.connection = 'connecting'
    this.emitEvent({ type: 'session:connecting', url: wsUrl.href })

    const socket = connectWebSocket(wsUrl, {
      headers: this.options.headers,
    })
    this.socket = socket

    socket.on('open', () => {
      this.reconnectAttempt = 0
      this.state.connection = 'connected'
      this.emitEvent({ type: 'session:connected', url: wsUrl.href })
    })

    socket.on('message', (message) => {
      this.handleMessage(message)
    })

    socket.on('binary', (payload) => {
      if (this.options.verbose) {
        this.emitEvent({
          type: 'internal:binary-message',
          byteLength: payload.length,
          opcode: payload[0],
        })
      }
    })

    socket.on('close', ({ code, reason } = {}) => {
      if (this.socket === socket) {
        this.socket = null
      }
      this.state.connection = 'disconnected'
      this.emitEvent({ type: 'session:disconnected', code, reason })
      this.scheduleReconnect()
    })

    socket.on('error', (error) => {
      this.emitEvent({ type: 'session:error', error: serializeError(error) })
    })
  }

  handleMessage(raw) {
    let message
    try {
      message = JSON.parse(raw)
    } catch (error) {
      this.emitEvent({
        type: 'observer:error',
        reason: 'invalid-hmr-message',
        raw,
        error: serializeError(error),
      })
      return
    }

    if (this.options.verbose) {
      this.emitEvent({
        type: 'internal:hmr-message',
        message: summarizeHmrMessage(message),
        rawMessage: this.options.raw ? message : undefined,
      })
    }

    reduceHmrMessage(this.state, message, (event) => this.emitEvent(event))
  }

  scheduleReconnect() {
    if (this.closed || !this.options.reconnect) {
      return
    }

    this.reconnectAttempt += 1
    if (this.reconnectAttempt > this.options.maxReconnects) {
      this.emitEvent({
        type: 'session:reconnect-abandoned',
        attempts: this.reconnectAttempt - 1,
      })
      return
    }

    const delayMs = Math.min(
      RECONNECT_BASE_DELAY_MS * this.reconnectAttempt,
      RECONNECT_MAX_DELAY_MS
    )

    this.emitEvent({
      type: 'session:reconnecting',
      attempt: this.reconnectAttempt,
      delayMs,
    })

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delayMs)
  }

  emitEvent(event) {
    const snapshot = this.getSnapshot()
    this.emit('event', event, snapshot)
    this.emit(event.type, event, snapshot)
  }
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

function reduceHmrMessage(state, message, emit) {
  state.lastMessageType = message.type

  switch (message.type) {
    case HMR_TYPES.BUILDING: {
      state.phase = 'compiling'
      state.building = true
      state.buildCycle += 1
      state.lastChangedAt = new Date().toISOString()
      emit({
        type: 'build:compiling',
        status: 'compiling',
        buildId: state.buildCycle,
        at: state.lastChangedAt,
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
      state.hash = message.hash || state.hash
      state.warningCount = formatted.warnings.length
      state.warnings = formatted.warnings
      state.rawWarnings = rawWarnings
      state.lastChangedAt = new Date().toISOString()

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
          trigger: message.type === HMR_TYPES.SYNC ? 'sync' : 'update',
          internalType: message.type,
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

      if (hadErrors) {
        emit({
          type: 'build:recovered',
          status: 'ready',
          trigger: message.type === HMR_TYPES.SYNC ? 'sync' : 'update',
          internalType: message.type,
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
      } else {
        emit({
          type: 'build:ready',
          status: 'ready',
          trigger: message.type === HMR_TYPES.SYNC ? 'sync' : 'update',
          internalType: message.type,
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
      }
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
      state.lastChangedAt = new Date().toISOString()

      emit({
        type: 'build:error',
        status: 'error',
        change: hadErrors ? 'updated' : 'shown',
        trigger: 'server',
        internalType: message.type,
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
      return

    default:
      return
  }
}

export function buildHmrUrl(options: ObserveNextHmrOptions = {}) {
  const input = normalizeDevServerUrlInput(options.url || DEFAULT_DEV_SERVER_URL)
  const base = new URL(input)

  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    if (base.protocol !== 'ws:' && base.protocol !== 'wss:') {
      throw new Error(`Unsupported protocol "${base.protocol}"`)
    }
  }

  const protocol =
    base.protocol === 'https:' || base.protocol === 'wss:' ? 'wss:' : 'ws:'
  const path = options.path || base.pathname || DEFAULT_HMR_PATH
  const pathname =
    path && path !== '/' ? ensureLeadingSlash(path) : DEFAULT_HMR_PATH
  const wsUrl = new URL(`${protocol}//${base.host}${pathname}`)

  if (base.search) {
    for (const [name, value] of base.searchParams) {
      wsUrl.searchParams.set(name, value)
    }
  }

  if (options.id) {
    wsUrl.searchParams.set('id', options.id)
  }

  return wsUrl
}

function normalizeDevServerUrlInput(input) {
  const value = String(input || '').trim()
  if (!value) {
    return DEFAULT_DEV_SERVER_URL
  }

  if (/^\d+$/.test(value)) {
    return `http://localhost:${value}`
  }

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    return value
  }

  return `http://${value}`
}

function connectWebSocket(url: URL, options: { headers?: Record<string, string> } = {}) {
  const client = new MinimalWebSocketClient(url, options)
  client.connect()
  return client
}

class MinimalWebSocketClient extends EventEmitter {
  url: URL
  options: { headers?: Record<string, string> }
  socket: net.Socket | tls.TLSSocket | null
  handshakeBuffer: Buffer
  frameBuffer: Buffer
  opened: boolean
  closed: boolean
  fragments: { opcode: number; chunks: Buffer[] } | null
  expectedAccept?: string

  constructor(url: URL, options: { headers?: Record<string, string> }) {
    super()
    this.url = url
    this.options = options
    this.socket = null
    this.handshakeBuffer = Buffer.alloc(0)
    this.frameBuffer = Buffer.alloc(0)
    this.opened = false
    this.closed = false
    this.fragments = null
  }

  connect() {
    const isSecure = this.url.protocol === 'wss:'
    const port = this.url.port ? Number(this.url.port) : isSecure ? 443 : 80
    const host = this.url.hostname
    const socketOptions = {
      host,
      port,
      servername: host,
    }

    const socket = isSecure
      ? tls.connect(socketOptions)
      : net.connect(socketOptions)
    this.socket = socket

    socket.once(isSecure ? 'secureConnect' : 'connect', () =>
      this.sendHandshake()
    )
    socket.on('data', (chunk) => this.handleData(chunk))
    socket.on('error', (error) => this.emit('error', error))
    socket.on('close', () => {
      if (!this.closed) {
        this.closed = true
        this.emit('close')
      }
    })
  }

  close() {
    if (this.closed) {
      return
    }
    this.closed = true
    if (this.opened) {
      this.sendFrame(0x8, Buffer.alloc(0))
    }
    if (this.socket) {
      this.socket.end()
    }
  }

  send(text) {
    this.sendFrame(0x1, Buffer.from(String(text)))
  }

  sendHandshake() {
    const key = crypto.randomBytes(16).toString('base64')
    this.expectedAccept = createWebSocketAccept(key)

    const path = `${this.url.pathname}${this.url.search}`
    const hostHeader = this.url.port
      ? `${this.url.hostname}:${this.url.port}`
      : this.url.hostname
    const headerLines = [
      `GET ${path} HTTP/1.1`,
      `Host: ${hostHeader}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      'User-Agent: nextd',
    ]

    for (const [name, value] of Object.entries(this.options.headers || {})) {
      headerLines.push(`${name}: ${value}`)
    }

    this.socket.write(`${headerLines.join('\r\n')}\r\n\r\n`)
  }

  handleData(chunk) {
    if (!this.opened) {
      this.handshakeBuffer = Buffer.concat([this.handshakeBuffer, chunk])
      const headerEnd = this.handshakeBuffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) {
        return
      }

      const head = this.handshakeBuffer.subarray(0, headerEnd).toString('utf8')
      const rest = this.handshakeBuffer.subarray(headerEnd + 4)
      this.handshakeBuffer = Buffer.alloc(0)
      try {
        this.validateHandshake(head)
      } catch (error) {
        this.fail(error)
        return
      }
      this.opened = true
      this.emit('open')

      if (rest.length > 0) {
        this.handleFrames(rest)
      }
      return
    }

    this.handleFrames(chunk)
  }

  validateHandshake(head) {
    const lines = head.split('\r\n')
    const statusLine = lines.shift() || ''
    if (!/^HTTP\/1\.[01] 101\b/.test(statusLine)) {
      throw new Error(`WebSocket upgrade failed: ${statusLine || head}`)
    }

    const headers = new Map()
    for (const line of lines) {
      const separatorIndex = line.indexOf(':')
      if (separatorIndex === -1) {
        continue
      }
      headers.set(
        line.slice(0, separatorIndex).trim().toLowerCase(),
        line.slice(separatorIndex + 1).trim()
      )
    }

    const accept = headers.get('sec-websocket-accept')
    if (accept !== this.expectedAccept) {
      throw new Error('WebSocket upgrade failed: invalid accept header')
    }
  }

  handleFrames(chunk) {
    this.frameBuffer = Buffer.concat([this.frameBuffer, chunk])

    while (this.frameBuffer.length >= 2) {
      let parsed
      try {
        parsed = parseFrame(this.frameBuffer)
      } catch (error) {
        this.fail(error)
        return
      }
      if (!parsed) {
        return
      }

      this.frameBuffer = this.frameBuffer.subarray(parsed.frameLength)
      this.handleFrame(parsed)
    }
  }

  handleFrame(frame) {
    switch (frame.opcode) {
      case 0x0:
        this.handleContinuation(frame)
        return
      case 0x1:
      case 0x2:
        if (!frame.fin) {
          this.fragments = {
            opcode: frame.opcode,
            chunks: [frame.payload],
          }
          return
        }
        this.emitPayload(frame.opcode, frame.payload)
        return
      case 0x8:
        this.closed = true
        this.emit('close', parseClosePayload(frame.payload))
        if (this.socket) {
          this.socket.end()
        }
        return
      case 0x9:
        this.sendFrame(0xa, frame.payload)
        return
      case 0xa:
        return
      default:
        return
    }
  }

  handleContinuation(frame) {
    if (!this.fragments) {
      return
    }

    this.fragments.chunks.push(frame.payload)

    if (frame.fin) {
      const payload = Buffer.concat(this.fragments.chunks)
      const opcode = this.fragments.opcode
      this.fragments = null
      this.emitPayload(opcode, payload)
    }
  }

  emitPayload(opcode, payload) {
    if (opcode === 0x1) {
      this.emit('message', payload.toString('utf8'))
    } else if (opcode === 0x2) {
      this.emit('binary', payload)
    }
  }

  sendFrame(opcode, payload) {
    if (!this.socket || this.socket.destroyed) {
      return
    }

    const mask = crypto.randomBytes(4)
    const length = payload.length
    let header

    if (length < 126) {
      header = Buffer.alloc(2)
      header[1] = 0x80 | length
    } else if (length < 65536) {
      header = Buffer.alloc(4)
      header[1] = 0x80 | 126
      header.writeUInt16BE(length, 2)
    } else {
      header = Buffer.alloc(10)
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(length), 2)
    }

    header[0] = 0x80 | opcode

    const maskedPayload = Buffer.alloc(payload.length)
    for (let index = 0; index < payload.length; index += 1) {
      maskedPayload[index] = payload[index] ^ mask[index % 4]
    }

    this.socket.write(Buffer.concat([header, mask, maskedPayload]))
  }

  fail(error) {
    this.emit('error', error)
    if (!this.closed) {
      this.closed = true
      this.emit('close')
    }
    if (this.socket) {
      this.socket.destroy()
    }
  }
}

function parseFrame(buffer) {
  const first = buffer[0]
  const second = buffer[1]
  const fin = Boolean(first & 0x80)
  const opcode = first & 0x0f
  const masked = Boolean(second & 0x80)
  let payloadLength = second & 0x7f
  let offset = 2

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) {
      return null
    }
    payloadLength = buffer.readUInt16BE(offset)
    offset += 2
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) {
      return null
    }
    const bigLength = buffer.readBigUInt64BE(offset)
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('WebSocket frame too large')
    }
    payloadLength = Number(bigLength)
    offset += 8
  }

  let mask
  if (masked) {
    if (buffer.length < offset + 4) {
      return null
    }
    mask = buffer.subarray(offset, offset + 4)
    offset += 4
  }

  const frameLength = offset + payloadLength
  if (buffer.length < frameLength) {
    return null
  }

  let payload = buffer.subarray(offset, frameLength)
  if (masked) {
    const unmasked = Buffer.alloc(payload.length)
    for (let index = 0; index < payload.length; index += 1) {
      unmasked[index] = payload[index] ^ mask[index % 4]
    }
    payload = unmasked
  }

  return {
    fin,
    opcode,
    payload,
    frameLength,
  }
}

function createWebSocketAccept(key) {
  return crypto
    .createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64')
}

function parseClosePayload(payload: Buffer) {
  if (!payload || payload.length < 2) {
    return { code: undefined, reason: undefined }
  }

  return {
    code: payload.readUInt16BE(0),
    reason: payload.subarray(2).toString('utf8') || undefined,
  }
}

function summarizeHmrMessage(message): HmrMessageSummary {
  const summary: HmrMessageSummary = { type: message.type }

  if ('hash' in message) {
    summary.hash = message.hash
  }
  if (Array.isArray(message.errors)) {
    summary.errors = message.errors.length
  }
  if (Array.isArray(message.warnings)) {
    summary.warnings = message.warnings.length
  }
  if (message.type === HMR_TYPES.TURBOPACK_CONNECTED && message.data) {
    summary.sessionId = message.data.sessionId
  }
  if (message.type === HMR_TYPES.SERVER_ERROR) {
    summary.hasErrorJSON = Boolean(message.errorJSON)
  }

  return summary
}

function parseServerErrorMessage(message) {
  if (!message.errorJSON) {
    return { message: 'Unknown HMR server error' }
  }

  try {
    return JSON.parse(message.errorJSON)
  } catch {
    return { message: message.errorJSON }
  }
}

export function formatCompilerMessages(json, verbose = false) {
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

function formatCompilerMessage(input, verbose) {
  let message

  if (typeof input === 'string') {
    message = input
  } else if (input && typeof input === 'object') {
    const filteredTrace = Array.isArray(input.moduleTrace)
      ? input.moduleTrace.filter(
          (trace) =>
            !/next-(middleware|client-pages|route|edge-function)-loader\.js/.test(
              trace.originName || ''
            )
        )
      : []

    const parts = []
    if (input.moduleName) {
      parts.push(stripAnsi(String(input.moduleName)))
    }
    if (input.file) {
      parts.push(stripAnsi(String(input.file)))
    }
    if (input.message) {
      parts.push(String(input.message))
    }
    if (input.details && verbose) {
      parts.push(String(input.details))
    }
    if (filteredTrace.length > 0) {
      const traceLines = filteredTrace
        .map((trace) => trace.moduleName)
        .filter(Boolean)
      if (traceLines.length > 0) {
        parts.push(`Import trace for requested module:\n${traceLines.join('\n')}`)
      }
    }
    if (input.stack && verbose) {
      parts.push(String(input.stack))
    }

    message = parts.length > 0 ? parts.join('\n') : JSON.stringify(input)
  } else {
    message = String(input)
  }

  return cleanupCompilerMessage(message, verbose)
}

function cleanupCompilerMessage(message, verbose) {
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

function isLikelySyntaxError(message) {
  return stripAnsi(message).includes('Syntax error:')
}

function stripAnsi(value) {
  return String(value).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}

function ensureLeadingSlash(value) {
  return value.startsWith('/') ? value : `/${value}`
}

function serializeError(error) {
  return {
    name: error && error.name ? error.name : 'Error',
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : undefined,
  }
}

function cloneState(state) {
  return {
    ...state,
    errors: [...state.errors],
    warnings: [...state.warnings],
    rawErrors: [...state.rawErrors],
    rawWarnings: [...state.rawWarnings],
  }
}
