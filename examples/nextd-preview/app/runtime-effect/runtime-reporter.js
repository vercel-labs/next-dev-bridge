export async function reportRuntimeEvent(kind, message, details = {}) {
  const stack = details.stack || ''
  const frames = stack ? parseStack(stack) : []

  return fetch('/api/runtime-events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      kind,
      message,
      category: details.category,
      stack,
      frames,
      source: 'runtime-effect',
    }),
  }).catch(() => {})
}

export function installRuntimeEventReporter() {
  if (window.__NEXTD_EXAMPLE_RUNTIME_REPORTER__) {
    return
  }

  const originalConsoleError = console.error.bind(console)

  window.__NEXTD_EXAMPLE_RUNTIME_REPORTER__ = {
    originalConsoleError,
  }

  console.error = (...args) => {
    originalConsoleError(...args)
    const firstError = args.find((arg) => arg instanceof Error)
    reportRuntimeEvent('error', formatConsoleError(args), {
      category: 'console.error',
      stack: firstError?.stack,
    })
  }

  window.addEventListener('error', (event) => {
    reportRuntimeEvent(
      'error',
      event.error?.message || event.message || 'Unknown runtime error',
      {
        category: 'window.error',
        stack: event.error?.stack,
      }
    )
  })
}

function parseStack(stack) {
  return String(stack)
    .split('\n')
    .map(parseStackLine)
    .filter(Boolean)
}

function parseStackLine(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('at ')) {
    return null
  }

  const withoutAt = trimmed.slice(3)
  let methodName = '<anonymous>'
  let location = withoutAt
  const openParen = withoutAt.indexOf('(')
  const closeParen = withoutAt.endsWith(')') ? withoutAt.length - 1 : -1

  if (openParen !== -1 && closeParen !== -1 && closeParen > openParen) {
    methodName = withoutAt.slice(0, openParen).trim() || '<anonymous>'
    location = withoutAt.slice(openParen + 1, closeParen)
  }

  const locationMatch = /^(.*):(\d+):(\d+)$/.exec(location)
  if (!locationMatch) {
    return null
  }

  return {
    file: locationMatch[1],
    methodName,
    arguments: [],
    line1: Number(locationMatch[2]),
    column1: Number(locationMatch[3]),
  }
}

function formatConsoleError(args) {
  return args
    .map((arg) => {
      if (arg instanceof Error) {
        return arg.message
      }

      if (typeof arg === 'string') {
        return arg
      }

      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    })
    .join(' ')
}
