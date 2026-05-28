import { describe, expect, it } from 'vitest'

import {
  mapErrorStack,
  mapStackFrames,
  parseStack,
} from '../src/source-map'

describe('Next dev source-map helpers', () => {
  it('maps stack frames through Next dev middleware', async () => {
    let requestBody: any

    const mappedFrames = await mapStackFrames(
      [
        {
          file: 'http://localhost:3000/_next/static/chunks/app/runtime-effect.js',
          methodName: 'RuntimeEffectClient.useEffect',
          arguments: [],
          line1: 100,
          column1: 10,
        },
      ],
      {
        url: 'http://localhost:3000',
        fetch: async (url, init) => {
          expect(String(url)).toBe(
            'http://localhost:3000/__nextjs_original-stack-frames'
          )
          requestBody = JSON.parse(String(init?.body))

          return Response.json([
            {
              status: 'fulfilled',
              value: {
                originalStackFrame: {
                  file: 'app/runtime-effect/runtime-effect-client.jsx',
                  methodName: 'RuntimeEffectClient.useEffect',
                  line1: 14,
                  column1: 7,
                },
                originalCodeFrame: '> 14 | throw new Error("boom")',
              },
            },
          ])
        },
      }
    )

    expect(requestBody).toMatchObject({
      isServer: false,
      isEdgeServer: false,
      isAppDirectory: true,
    })
    expect(requestBody.frames[0].file).toBe(
      '/_next/static/chunks/app/runtime-effect.js'
    )
    expect(mappedFrames[0]).toMatchObject({
      status: 'fulfilled',
      value: {
        originalStackFrame: {
          file: 'app/runtime-effect/runtime-effect-client.jsx',
          line1: 14,
        },
      },
    })
  })

  it('normalizes bare Turbopack chunk names before source mapping', async () => {
    let requestBody: any

    await mapStackFrames(
      [
        {
          file: '_0l5b1-n._.js',
          methodName: 'RuntimeEffectClient.useEffect.timer',
          arguments: [],
          line1: 26,
          column1: 27,
        },
      ],
      {
        url: 'https://preview.example.test/runtime-effect',
        fetch: async (_url, init) => {
          requestBody = JSON.parse(String(init?.body))

          return Response.json([
            {
              status: 'fulfilled',
              value: {
                originalStackFrame: {
                  file: 'app/runtime-effect/runtime-effect-client.jsx',
                  line1: 24,
                  column1: 15,
                },
              },
            },
          ])
        },
      }
    )

    expect(requestBody.frames[0].file).toBe(
      '/_next/static/chunks/_0l5b1-n._.js'
    )
  })

  it('uses the runtime event filename when the stack only has a basename', async () => {
    const requestBodies: any[] = []

    const mapped = await mapErrorStack(
      {
        message: 'boom',
        stack: [
          'Error: boom',
          '    at RuntimeEffectClient.useEffect.timer (_0l5b1-n._.js:26:27)',
        ].join('\n'),
      },
      {
        fallbackFile:
          'https://preview.example.test/_next/static/chunks/_0l5b1-n._.js',
        fetch: async (_url, init) => {
          requestBodies.push(JSON.parse(String(init?.body)))

          return Response.json([])
        },
      }
    )

    expect(mapped.frames[0].file).toBe('/_next/static/chunks/_0l5b1-n._.js')
    expect(requestBodies[0].frames[0].file).toBe(
      '/_next/static/chunks/_0l5b1-n._.js'
    )
  })

  it('can send dev-server filesystem chunk paths to Next source mapping', async () => {
    const requestBodies: any[] = []

    await mapStackFrames(
      [
        {
          file: 'http://localhost:3000/_next/static/chunks/_0l5b1-n._.js',
          methodName: 'RuntimeEffectClient.useEffect.timer',
          arguments: [],
          line1: 26,
          column1: 27,
        },
      ],
      {
        frameRoot: '/repo/.next/dev/static',
        fetch: async (_url, init) => {
          requestBodies.push(JSON.parse(String(init?.body)))

          return Response.json([])
        },
      }
    )

    expect(requestBodies[0].frames[0].file).toBe(
      '/repo/.next/dev/static/chunks/_0l5b1-n._.js'
    )
  })

  it('tries alternate frame file variants when Next maps to compiled chunks', async () => {
    const requestedFrames: unknown[] = []
    const mappedFrames = await mapStackFrames(
      [
        {
          file: 'http://localhost:3000/_next/static/chunks/_0l5b1-n._.js',
          methodName: 'handleClick',
          arguments: [],
          line1: 26,
          column1: 27,
        },
      ],
      {
        url: 'http://localhost:3000',
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body))
          requestedFrames.push(body.frames)

          if (requestedFrames.length === 1) {
            return Response.json([
              {
                status: 'fulfilled',
                value: {
                  originalStackFrame: {
                    file: '.next/dev/static/chunks/_0l5b1-n._.js',
                    methodName: 'handleClick',
                    line1: 26,
                    column1: 27,
                  },
                  originalCodeFrame: null,
                },
              },
            ])
          }

          return Response.json([
            {
              status: 'fulfilled',
              value: {
                originalStackFrame: {
                  file: 'app/page.tsx',
                  methodName: 'handleClick',
                  line1: 12,
                  column1: 9,
                },
                originalCodeFrame: '> 12 | throw new Error("boom")',
              },
            },
          ])
        },
      }
    )

    expect(requestedFrames).toEqual([
      [
        {
          file: '/_next/static/chunks/_0l5b1-n._.js',
          methodName: 'handleClick',
          arguments: [],
          line1: 26,
          column1: 27,
        },
      ],
      [
        {
          file: '.next/dev/static/chunks/_0l5b1-n._.js',
          methodName: 'handleClick',
          arguments: [],
          line1: 26,
          column1: 27,
        },
      ],
    ])
    expect(mappedFrames[0]).toMatchObject({
      status: 'fulfilled',
      value: {
        originalStackFrame: {
          file: 'app/page.tsx',
          line1: 12,
          column1: 9,
        },
      },
    })
  })

  it('maps an error-like object with a stack', async () => {
    const mapped = await mapErrorStack(
      {
        message: 'boom',
        stack: [
          'Error: boom',
          '    at RuntimeEffectClient.useEffect (http://localhost:3000/_next/static/chunks/app.js:14:7)',
        ].join('\n'),
      },
      {
        url: 'http://localhost:3000',
        fetch: async () =>
          Response.json([
            {
              status: 'fulfilled',
              value: {
                originalStackFrame: {
                  file: 'app/runtime-effect/runtime-effect-client.jsx',
                },
              },
            },
          ]),
      }
    )

    expect(mapped).toMatchObject({
      message: 'boom',
      frames: [
        {
          file: '/_next/static/chunks/app.js',
          methodName: 'RuntimeEffectClient.useEffect',
          line1: 14,
          column1: 7,
        },
      ],
      mappedFrames: [
        {
          status: 'fulfilled',
          value: {
            originalStackFrame: {
              file: 'app/runtime-effect/runtime-effect-client.jsx',
            },
          },
        },
      ],
    })
  })

  it('parses browser stack lines into Next stack frame input', () => {
    expect(
      parseStack(
        [
          'Error: boom',
          '    at RuntimeEffectClient.useEffect (http://localhost:3000/_next/static/chunks/app.js:14:7)',
          '    at http://localhost:3000/_next/static/chunks/anonymous.js:20:3',
        ].join('\n')
      )
    ).toEqual([
      {
        file: 'http://localhost:3000/_next/static/chunks/app.js',
        methodName: 'RuntimeEffectClient.useEffect',
        arguments: [],
        line1: 14,
        column1: 7,
      },
      {
        file: 'http://localhost:3000/_next/static/chunks/anonymous.js',
        methodName: '<anonymous>',
        arguments: [],
        line1: 20,
        column1: 3,
      },
    ])
  })
})
