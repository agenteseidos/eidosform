import { createHmac, timingSafeEqual } from 'crypto'

const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Verifica assinatura HMAC-SHA256 do Asaas.
 * Header format: asaas-signature: timestamp=X&hash=H
 * where H = HMAC-SHA256(payload, secret)
 *
 * Returns false if:
 * - header is missing/malformed
 * - timestamp is > 5 min old (replay attack)
 * - hash doesn't match
 */
export function verifyAsaasSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader) return false

  const params = new URLSearchParams(signatureHeader)
  const timestamp = params.get('timestamp')
  const hash = params.get('hash')

  if (!timestamp || !hash) return false

  const ts = parseInt(timestamp, 10)
  if (isNaN(ts)) return false

  const age = Date.now() - ts * 1000
  if (age > MAX_TIMESTAMP_AGE_MS || age < -30_000) return false

  const expected = createHmac('sha256', secret).update(payload).digest('hex')

  try {
    return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}
