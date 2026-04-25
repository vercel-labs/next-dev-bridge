#!/usr/bin/env node

import {
  connect,
} from './index.js'
import {
  DEFAULT_DEV_SERVER_URL,
  DEFAULT_HMR_PATH,
} from './websocket.js'

let args
try {
  args = parseArgs(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}

if (args.help) {
  printHelp()
  process.exit(0)
}

if (args.command !== 'watch') {
  process.stderr.write(`Unknown command: ${args.command}\n`)
  process.exit(1)
}

const observer = connect(
  {
    url: args.url || DEFAULT_DEV_SERVER_URL,
    path: args.path || DEFAULT_HMR_PATH,
    id: args.id,
  },
  {
    reconnect: !args.noReconnect,
    maxReconnects: args.once ? 0 : Infinity,
    verbose: args.verbose || args.raw,
    raw: args.raw,
  },
  (event, state) => {
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ event, state })}\n`)
      return
    }

    printHumanEvent(event, args)
  }
)

process.once('SIGINT', () => {
  observer.stop()
  process.exit(130)
})

process.once('SIGTERM', () => {
  observer.stop()
  process.exit(143)
})

function parseArgs(argv) {
  const result = {
    command: 'watch',
    url: null,
    path: DEFAULT_HMR_PATH,
    id: null,
    json: false,
    verbose: false,
    raw: false,
    once: false,
    noReconnect: false,
    help: false,
  }

  const args = [...argv]
  if (args[0] === 'watch') {
    result.command = args.shift()
  } else if (args[0] === 'help') {
    result.help = true
    args.shift()
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '--help' || arg === '-h') {
      result.help = true
    } else if (arg === '--json') {
      result.json = true
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true
    } else if (arg === '--raw') {
      result.raw = true
      result.verbose = true
    } else if (arg === '--once') {
      result.once = true
      result.noReconnect = true
    } else if (arg === '--no-reconnect') {
      result.noReconnect = true
    } else if (arg === '--path') {
      result.path = requireValue(args, (index += 1), '--path')
    } else if (arg.startsWith('--path=')) {
      result.path = arg.slice('--path='.length)
    } else if (arg === '--id') {
      result.id = requireValue(args, (index += 1), '--id')
    } else if (arg.startsWith('--id=')) {
      result.id = arg.slice('--id='.length)
    } else if (arg === '--url') {
      result.url = requireValue(args, (index += 1), '--url')
    } else if (arg.startsWith('--url=')) {
      result.url = arg.slice('--url='.length)
    } else if (!result.url && !arg.startsWith('-')) {
      result.url = arg
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return result
}

function requireValue(argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

function printHelp() {
  process.stdout.write(`nextd

Watch a running Next.js dev server and print normalized build state events.

Usage:
  nextd watch [url] [options]
  nextd [url] [options]
  node dist/cli.js watch [url] [options]
  bun run watch -- [url] [options]

Arguments:
  url                 Dev server URL or port. Defaults to ${DEFAULT_DEV_SERVER_URL}

Options:
  --path <path>       HMR websocket path. Defaults to ${DEFAULT_HMR_PATH}
  --id <id>           Optional App Router request id query value
  --verbose, -v       Also print internal HMR message summaries
  --raw               Include raw internal HMR messages in JSON output
  --json              Print newline-delimited JSON events
  --once              Do not reconnect after disconnect
  --no-reconnect      Disable reconnect loop
  --help, -h          Show this help
`)
}

function printHumanEvent(event, args) {
  switch (event.type) {
    case 'internal:hmr-message':
      if (args.verbose) {
        log(`hmr ${formatHmrSummary(event.message)}`)
      }
      return
    case 'internal:binary-message':
      if (args.verbose) {
        log(`binary message bytes=${event.byteLength} opcode=${event.opcode}`)
      }
      return
    case 'session:connecting':
      log(`>>> [CONNECTING] ${event.url}`)
      return
    case 'session:connected':
      log(`>>> [WATCHING] ${event.url}`)
      return
    case 'session:disconnected':
      log(`>>> [DISCONNECTED]${event.code ? ` code=${event.code}` : ''}`)
      return
    case 'session:reconnecting':
      log(`>>> [RECONNECTING] attempt=${event.attempt} delay=${event.delayMs}ms`)
      return
    case 'session:error':
      log(`>>> [CONNECTION ERROR] ${event.error.message}`)
      return
    case 'observer:error':
      log(`>>> [OBSERVER ERROR] ${event.error.message}`)
      return
    case 'build:compiling':
      log(`>>> [COMPILING] build=${event.buildId}`)
      return
    case 'build:ready':
      log(formatBuildReady('READY', event))
      return
    case 'build:recovered':
      log(formatBuildReady('RECOVERED', event))
      return
    case 'build:error':
      log(
        `>>> [ERROR] count=${event.formattedErrorCount ?? event.errorCount} hash=${event.hash || 'n/a'} change=${event.change}`
      )
      printErrors(event.formattedErrors || event.errors || [])
      return
    case 'session:reconnect-abandoned':
      log(`>>> [RECONNECT ABANDONED] attempts=${event.attempts}`)
      return
    default:
      if (args.verbose) {
        log(event.type)
      }
  }
}

function formatBuildReady(label, event) {
  const parts = [`>>> [${label}]`]
  parts.push(`hash=${event.hash || 'n/a'}`)
  parts.push(`warnings=${event.formattedWarningCount ?? event.warningCount}`)
  if (event.trigger === 'sync') {
    parts.push('state=sync')
  }
  return parts.join(' ')
}

function formatHmrSummary(summary) {
  const parts = [summary.type]
  if (summary.hash) {
    parts.push(`hash=${summary.hash}`)
  }
  if ('errors' in summary) {
    parts.push(`errors=${summary.errors}`)
  }
  if ('warnings' in summary) {
    parts.push(`warnings=${summary.warnings}`)
  }
  if (summary.sessionId !== undefined) {
    parts.push(`session=${summary.sessionId}`)
  }
  if (summary.hasErrorJSON) {
    parts.push('serverError=true')
  }
  return parts.join(' ')
}

function printErrors(errors) {
  for (let index = 0; index < errors.length; index += 1) {
    const error = errors[index]
    const label = errors.length === 1 ? 'error' : `error ${index + 1}`
    process.stdout.write(`${indent(`${label}:\n${error}`, '  ')}\n`)
  }
}

function log(message) {
  process.stdout.write(`[${new Date().toISOString()}] ${message}\n`)
}

function indent(value, prefix) {
  return String(value)
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')
}
