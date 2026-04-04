/**
 * Structured logging helper
 * Logs only in development mode to prevent exposing internal details in production
 */

export function log(message: string, data?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[${new Date().toISOString()}]`, message, data)
  }
}

export function logError(message: string, error?: unknown, data?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'development') {
    console.error(`[${new Date().toISOString()}] ERROR:`, message, error, data)
  }
}

export function logWarn(message: string, data?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'development') {
    console.warn(`[${new Date().toISOString()}] WARN:`, message, data)
  }
}
