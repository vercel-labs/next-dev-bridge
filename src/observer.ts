import { EventEmitter } from 'node:events'

import { serializeError, type SerializedError } from './errors.js'
import {
  type NextDevBridgeState,
  type ProcessHMREvent,
  processHMR,
  type ProcessHMR,
} from './processor.js'
import {
  DEFAULT_DEV_SERVER_URL,
  HMR_PATHS,
  buildHmrUrl,
  connectWebSocket,
} from './websocket.js'

const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 5000
const HMR_HANDSHAKE_TIMEOUT_MS = 2000

export interface NextInstanceOptions {
  url?: string
}

export type NextInstance = string | NextInstanceOptions

export interface ConnectOptions {
  reconnect?: boolean
  maxReconnects?: number
  verbose?: boolean
  raw?: boolean
}

interface ObserverOptions extends NextInstanceOptions, ConnectOptions {}

export type NextDevBridgeEvent =
  | { type: 'session:connecting'; url: string }
  | { type: 'session:connected'; url: string }
  | { type: 'session:disconnected'; code?: number; reason?: string }
  | { type: 'session:reconnecting'; attempt: number; delayMs: number }
  | { type: 'session:reconnect-abandoned'; attempts: number }
  | { type: 'session:error'; error: SerializedError }
  | ProcessHMREvent
  | InternalBinaryMessageEvent

export interface InternalBinaryMessageEvent {
  type: 'internal:binary-message'
  byteLength: number
  opcode: number
}

export type NextDevBridgeEventListener = (
  event: NextDevBridgeEvent,
  state: NextDevBridgeState
) => void

export interface NextDevBridgeConnection {
  stop(): void
  getSnapshot(): NextDevBridgeState
  on(eventName: 'event', listener: NextDevBridgeEventListener): this
  on(eventName: string | symbol, listener: (...args: any[]) => void): this
}

export function connect(
  next?: NextInstance,
  listener?: NextDevBridgeEventListener
): NextDevBridgeConnection
export function connect(
  next: NextInstance,
  options?: ConnectOptions,
  listener?: NextDevBridgeEventListener
): NextDevBridgeConnection
export function connect(
  next: NextInstance = {},
  optionsOrListener?: ConnectOptions | NextDevBridgeEventListener,
  maybeListener?: NextDevBridgeEventListener
): NextDevBridgeConnection {
  const nextOptions = normalizeNextInstance(next)
  const connectOptions =
    typeof optionsOrListener === 'function' ? {} : optionsOrListener || {}
  const listener =
    typeof optionsOrListener === 'function' ? optionsOrListener : maybeListener
  const normalizedOptions = {
    ...nextOptions,
    ...connectOptions,
  }
  const observer = new NextHmrObserverImpl(normalizedOptions)

  if (listener) {
    observer.on('event', listener)
  }

  observer.start()
  return observer
}

class NextHmrObserverImpl extends EventEmitter implements NextDevBridgeConnection {
  private options: Required<ObserverOptions>
  private processHMR: ProcessHMR
  private connection: NextDevBridgeState['connection']
  private reconnectAttempt: number
  private closed: boolean
  private socket: any
  private reconnectTimer: ReturnType<typeof setTimeout> | null

  constructor(options: ObserverOptions = {}) {
    super()
    this.options = {
      url: options.url || DEFAULT_DEV_SERVER_URL,
      reconnect: options.reconnect !== false,
      maxReconnects:
        options.maxReconnects === undefined ? Infinity : options.maxReconnects,
      verbose: Boolean(options.verbose),
      raw: Boolean(options.raw),
    }
    this.processHMR = processHMR({
      verbose: this.options.verbose,
      raw: this.options.raw,
    })
    this.connection = 'idle'
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
    const snapshot = this.processHMR.getSnapshot()
    snapshot.connection = this.connection
    return snapshot
  }

  private connect(hmrPathIndex = 0) {
    const wsUrl = buildHmrUrl({
      ...this.options,
      hmrPath: HMR_PATHS[hmrPathIndex],
    })
    if (hmrPathIndex === 0) {
      this.connection = 'connecting'
      this.emitEvent({ type: 'session:connecting', url: wsUrl.href })
    }

    const socket = connectWebSocket(wsUrl, {
      handshakeTimeoutMs: HMR_HANDSHAKE_TIMEOUT_MS,
    })
    let opened = false
    let connectionError: unknown
    this.socket = socket

    socket.on('open', () => {
      opened = true
      this.reconnectAttempt = 0
      this.connection = 'connected'
      this.emitEvent({ type: 'session:connected', url: wsUrl.href })
    })

    socket.on('message', (message) => {
      this.processHMR(message, (event) => this.emitEvent(event))
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
      if (this.socket !== socket) {
        return
      }
      this.socket = null

      if (!opened && hmrPathIndex < HMR_PATHS.length - 1 && !this.closed) {
        this.connect(hmrPathIndex + 1)
        return
      }

      if (connectionError) {
        this.emitEvent({
          type: 'session:error',
          error: serializeError(connectionError),
        })
      }
      this.connection = 'disconnected'
      this.emitEvent({ type: 'session:disconnected', code, reason })
      this.scheduleReconnect()
    })

    socket.on('error', (error) => {
      connectionError = error
      if (opened) {
        this.emitEvent({ type: 'session:error', error: serializeError(error) })
        connectionError = undefined
      }
    })
  }

  private scheduleReconnect() {
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

  private emitEvent(event: NextDevBridgeEvent) {
    const snapshot = this.getSnapshot()
    this.emit('event', event, snapshot)
    this.emit(event.type, event, snapshot)
  }
}

function normalizeNextInstance(next: NextInstance): NextInstanceOptions {
  return typeof next === 'string' ? { url: next } : { ...(next || {}) }
}
