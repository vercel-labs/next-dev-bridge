import * as crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import * as net from 'node:net'
import * as tls from 'node:tls'

export const DEFAULT_DEV_SERVER_URL = 'http://localhost:3000'
export const DEFAULT_HMR_PATH = '/_next/webpack-hmr'

export interface NextHmrWebSocketOptions {
  url?: string
  path?: string
  id?: string
  headers?: Record<string, string>
}

export function buildHmrUrl(options: NextHmrWebSocketOptions = {}) {
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

export function connectWebSocket(
  url: URL,
  options: { headers?: Record<string, string> } = {}
) {
  const client = new MinimalWebSocketClient(url, options)
  client.connect()
  return client
}

function normalizeDevServerUrlInput(input: string) {
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
    socket.on('data', (chunk) =>
      this.handleData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    )
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

  send(text: string) {
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

  handleData(chunk: Buffer) {
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

  validateHandshake(head: string) {
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

  handleFrames(chunk: Buffer) {
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

  emitPayload(opcode: number, payload: Buffer) {
    if (opcode === 0x1) {
      this.emit('message', payload.toString('utf8'))
    } else if (opcode === 0x2) {
      this.emit('binary', payload)
    }
  }

  sendFrame(opcode: number, payload: Buffer) {
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

function parseFrame(buffer: Buffer) {
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

function createWebSocketAccept(key: string) {
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

function ensureLeadingSlash(value: string) {
  return value.startsWith('/') ? value : `/${value}`
}
