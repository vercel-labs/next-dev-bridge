/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: [
    'localhost',
    'localhost:3000',
    '127.0.0.1',
    '127.0.0.1:3000',
  ],
  reactStrictMode: false,
  experimental:
    process.env.NEXT_DEV_BRIDGE_EXPOSE_RUNTIME_ERRORS === '1'
      ? { exposeRuntimeErrorsToHMR: true }
      : {},
}

export default nextConfig
