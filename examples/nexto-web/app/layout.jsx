import './globals.css'

export const metadata = {
  title: 'nexto Web Example',
  description: 'Example app for observing Next.js dev HMR events with nexto.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
