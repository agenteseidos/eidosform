import { checkResponseRateLimitAsync } from '@/lib/response-rate-limit'

const MAX_PAYLOAD_BYTES = 50 * 1024
const MAX_ANSWER_KEYS = 200

export { MAX_PAYLOAD_BYTES, MAX_ANSWER_KEYS }

export function sanitizeValue(val: unknown): unknown {
  if (typeof val === 'string') return val.replace(/<[^>]*>/g, '')
  if (Array.isArray(val)) return val.map(sanitizeValue)
  if (val && typeof val === 'object') {
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>).map(([k, v]) => [k, sanitizeValue(v)])
    )
  }
  return val
}

export function isResponseComplete(
  answers: Record<string, unknown>,
  questions: Array<{ id: string; required?: boolean }>
): boolean {
  const requiredIds = questions.filter((q) => q.required).map((q) => q.id)
  if (requiredIds.length === 0) return true

  return requiredIds.every((id) => {
    const val = answers[id]
    if (val === undefined || val === null || val === '') return false
    if (Array.isArray(val) && val.length === 0) return false
    return true
  })
}

export function getClientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
}

export async function checkSubmissionRateLimit(req: Request) {
  return checkResponseRateLimitAsync(getClientIp(req))
}
