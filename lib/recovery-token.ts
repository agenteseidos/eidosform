import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Token de "sessão de recovery" — prova de que a sessão atual veio de um link
 * de redefinição de senha (fluxo /auth/callback?type=recovery), e não de um
 * login normal. Usado para que POST /api/auth/reset-password só aceite trocar
 * a senha sem a senha antiga quando o usuário realmente está no fluxo de
 * recuperação (P1-5).
 *
 * O token é assinado (HMAC), preso ao userId e expira em 15 min. É gravado num
 * cookie httpOnly pelo callback e validado pelo endpoint de reset.
 */

const COOKIE_NAME = 'eidos_recovery'
const TTL_MS = 15 * 60 * 1000

export const RECOVERY_COOKIE_NAME = COOKIE_NAME

function signingSecret(): string {
  // Segredos sempre presentes server-side; nunca expostos ao client.
  return process.env.INTERNAL_API_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
}

/** Gera o valor do cookie de recovery para um userId. */
export function signRecoveryToken(userId: string): string {
  const expiry = Date.now() + TTL_MS
  const payload = `${userId}.${expiry}`
  const hmac = createHmac('sha256', signingSecret()).update(payload).digest('hex')
  return `${expiry}.${hmac}`
}

/** true se `token` é válido, não expirou e pertence a `userId`. */
export function verifyRecoveryToken(token: string | undefined | null, userId: string): boolean {
  if (!token || !userId) return false
  const secret = signingSecret()
  if (!secret) return false

  const dot = token.indexOf('.')
  if (dot === -1) return false
  const expiryRaw = token.slice(0, dot)
  const hmac = token.slice(dot + 1)

  const expiry = parseInt(expiryRaw, 10)
  if (isNaN(expiry) || Date.now() > expiry) return false

  const expected = createHmac('sha256', secret).update(`${userId}.${expiry}`).digest('hex')
  try {
    return (
      hmac.length === expected.length &&
      timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'))
    )
  } catch {
    return false
  }
}
