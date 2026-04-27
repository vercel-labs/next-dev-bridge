import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  outputFileTracingRoot: path.join(__dirname, '../..'),
  outputFileTracingIncludes: {
    '/api/**/*': [
      './preview-fixture/app/**/*',
      './preview-fixture/dev-server.cjs',
      './preview-fixture/instrumentation-client.js',
      './preview-fixture/next-dev-bridge-hide-nextjs-portal.js',
      './preview-fixture/next.config.mjs',
      './preview-fixture/package.json',
      './preview-fixture/scenarios.cjs',
      '../../package.json',
      '../../README.md',
      '../../tsconfig.json',
      '../../src/**/*',
    ],
  },
  reactStrictMode: false,
  serverExternalPackages: ['@vercel/sandbox'],
}

export default nextConfig
