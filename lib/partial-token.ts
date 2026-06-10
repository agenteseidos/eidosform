import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Token de posse de resposta parcial anônima (A1 — auditoria 2026-06-10).
 *
 * Respostas parciais anônimas eram atualizáveis por qualquer um que conhecesse
 * o response_id (UUID). O UUID não é enumerável, mas pode vazar (logs, Sheets,
 * webhooks, histórico do navegador). Este token é emitido pelo servidor ao
 * criar a parcial e exigido em qualquer UPDATE subsequente — prova de posse
 * independente do id.
 *
 * O token nunca é persistido no banco: é um HMAC determinístico do
 * response_id, verificável sem round-trip.
 */

function signingSecret(): string {
  return (
    process.env.PARTIAL_TOKEN_SECRET ||
    process.env.INTERNAL_API_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  )
}

/** Gera o token de posse para um response_id. */
export function signPartialToken(responseId: string): string {
  return createHmac('sha256', signingSecret()).update(`partial:${responseId}`).digest('hex')
}

/** true se `token` prova posse de `responseId`. */
export function verifyPartialToken(token: string | undefined | null, responseId: string): boolean {
  if (!token || !responseId) return false
  const secret = signingSecret()
  if (!secret) return false
  const expected = signPartialToken(responseId)
  try {
    return (
      token.length === expected.length &&
      timingSafeEqual(Buffer.from(token, 'utf8'), Buffer.from(expected, 'utf8'))
    )
  } catch {
    return false
  }
}
