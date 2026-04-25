import './globals.css'

export const metadata = {
  title: 'Next HMR Observer Test Fixture',
  description: 'Test app for observing Next.js dev build and runtime errors.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
