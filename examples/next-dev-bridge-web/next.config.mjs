/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  outputFileTracingIncludes: {
    '/api/**/*': ['./preview-fixture/**/*'],
  },
  reactStrictMode: false,
  serverExternalPackages: ['@vercel/sandbox'],
}

export default nextConfig
