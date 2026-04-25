import './globals.css'

export const metadata = {
  title: 'nextd Web Example',
  description: 'Example app for observing Next.js dev HMR events with nextd.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
