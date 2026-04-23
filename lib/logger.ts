/**
 * Structured logging helper
 */

export function log(message: string, data?: Record<string, unknown>) {
  console.log(`[${new Date().toISOString()}]`, message, data)
}

export function logError(message: string, error?: unknown, data?: Record<string, unknown>) {
  console.error(`[${new Date().toISOString()}] ERROR:`, message, error, data)
}

export function logWarn(message: string, data?: Record<string, unknown>) {
  console.warn(`[${new Date().toISOString()}] WARN:`, message, data)
}
