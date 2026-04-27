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
      'http://localhost:3000/_next/static/chunks/app/runtime-effect.js'
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
          file: 'http://localhost:3000/_next/static/chunks/app.js',
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
