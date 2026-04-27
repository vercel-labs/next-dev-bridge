import './globals.css'

export const metadata = {
  title: 'next-dev-bridge Web Example',
  description: 'Example app for observing Next.js dev HMR events with next-dev-bridge.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
