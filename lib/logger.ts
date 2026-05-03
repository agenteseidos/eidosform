/**
 * Structured logging helper with automatic PII redaction.
 */

const PII_KEYS = new Set([
  'phone', 'email', 'cpf', 'password', 'passwd', 'token', 'secret',
  'authorization', 'auth', 'api_key', 'apikey', 'access_token', 'refresh_token',
])

// Matches: CPF (000.000.000-00 or 00000000000), email addresses, phone numbers (10-13 digits)
const PII_PATTERN =
  /\d{3}\.?\d{3}\.?\d{3}-?\d{2}|[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}|\+?\d[\s\-]?(?:\d[\s\-]?){9,12}\d/g

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return value
  if (typeof value === 'string') return value.replace(PII_PATTERN, '[REDACTED]')
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        PII_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redact(v, depth + 1),
      ])
    )
  }
  return value
}

export function log(message: string, data?: Record<string, unknown>) {
  console.log(`[${new Date().toISOString()}]`, message, data ? redact(data) : undefined)
}

function redactError(error: unknown): unknown {
  if (error instanceof Error) {
    return redact({ name: error.name, message: error.message }) as unknown
  }
  return redact(error)
}

export function logError(message: string, error?: unknown, data?: Record<string, unknown>) {
  console.error(
    `[${new Date().toISOString()}] ERROR:`,
    message,
    error !== undefined ? redactError(error) : undefined,
    data ? redact(data) : undefined
  )
}

export function logWarn(message: string, data?: Record<string, unknown>) {
  console.warn(`[${new Date().toISOString()}] WARN:`, message, data ? redact(data) : undefined)
}
