const extraAllowedDevOrigins = [
  process.env.NEXT_DEV_BRIDGE_WEB_ORIGIN,
  process.env.NEXT_DEV_BRIDGE_PREVIEW_ORIGIN,
  process.env.VERCEL_URL,
]
  .filter(Boolean)
  .map((origin) => origin.replace(/^https?:\/\//, ''))

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: [
    'localhost',
    'localhost:3000',
    '127.0.0.1',
    '127.0.0.1:3000',
    '*.vercel.run',
    ...extraAllowedDevOrigins,
  ],
  devIndicators: false,
  reactStrictMode: false,
}

export default nextConfig
