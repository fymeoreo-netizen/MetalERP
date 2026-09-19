import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import './index.css'
import App from './App.tsx'

const recentRejections = new Map<string, number>()
const REJECTION_THROTTLE_MS = 4000

/** Surface silent background failures once per message window instead of swallowing them. */
function reportUnhandledRejection(reason: unknown): void {
    const message = reason instanceof Error ? reason.message : String(reason ?? 'Unknown promise rejection')
    console.error('[erp:unhandled-rejection]', reason)
    const lastSeen = recentRejections.get(message) ?? 0
    if (Date.now() - lastSeen < REJECTION_THROTTLE_MS) return
    recentRejections.set(message, Date.now())
    toast.error('Background action failed', { description: message })
}

window.addEventListener('unhandledrejection', (event) => {
    reportUnhandledRejection(event.reason)
})

createRoot(document.getElementById('root')!, {
    onUncaughtError: (error, errorInfo) => {
        // Render errors that escape every boundary land here; boundaries own the UI, we own the log.
        console.error('[erp:uncaught]', error, errorInfo.componentStack)
    },
    onRecoverableError: (error) => {
        console.error('[erp:recoverable]', error)
    },
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
