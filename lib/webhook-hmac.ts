import { createHmac, timingSafeEqual } from 'crypto'

const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Robust parser for "key=value&key=value" signature headers.
 * URLSearchParams must not be used here — it URL-decodes values, which corrupts hex hashes.
 */
function parseSignatureHeader(header: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const part of header.split('&')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    result[part.slice(0, eq)] = part.slice(eq + 1)
  }
  return result
}

/**
 * Verifica assinatura HMAC-SHA256 do Asaas.
 * Header format: asaas-signature: timestamp=X&hash=H
 * where H = HMAC-SHA256(payload, secret)
 *
 * Returns false if:
 * - header is missing/malformed
 * - timestamp is in the future or > 5 min old (replay attack)
 * - hash doesn't match
 */
export function verifyAsaasSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader) return false

  const params = parseSignatureHeader(signatureHeader)
  const timestamp = params['timestamp']
  const hash = params['hash']

  if (!timestamp || !hash) return false

  const ts = parseInt(timestamp, 10)
  if (isNaN(ts)) return false

  const age = Date.now() - ts * 1000
  // Only accept timestamps in the past (no future tolerance, max 5 min old)
  if (age < 0 || age > MAX_TIMESTAMP_AGE_MS) return false

  const expected = createHmac('sha256', secret).update(payload).digest('hex')

  try {
    return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}
