import { installNextPortalGuard } from './next-dev-bridge-hide-nextjs-portal'

try {
  installNextPortalGuard()
} catch {
  // Keep instrumentation failures from affecting the preview app.
}
