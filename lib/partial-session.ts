import { createHash } from 'crypto'

/**
 * Session key de resposta parcial (fix duplicatas 2026-07-08).
 *
 * Gerada no CLIENTE (crypto.randomUUID ou hex aleatório) e enviada em todo save
 * parcial, no beacon de fechamento e no submit final. Identifica UMA TENTATIVA
 * de preenchimento — não uma pessoa: preenchimento novo legítimo = key nova.
 *
 * É um bearer secret com a mesma força do partial_token (posse da key = posse
 * da response). O servidor persiste APENAS o SHA-256; o índice único
 * (form_id, partial_session_hash) garante no banco que fetch/beacon/submit
 * concorrentes convergem pra mesma row. Nunca logar a key nem o hash completo.
 */

// UUID v4 (36 chars) ou hex/base62 de fallback — estrito o bastante pra não
// aceitar lixo, largo o bastante pros dois geradores do cliente.
const SESSION_KEY_RE = /^[A-Za-z0-9-]{20,64}$/

export function isValidSessionKey(key: unknown): key is string {
  return typeof key === 'string' && SESSION_KEY_RE.test(key)
}

export function hashSessionKey(key: string): string {
  return createHash('sha256').update(`partial-session:${key}`).digest('hex')
}

/** Prefixo seguro pra telemetria — nunca logar a key nem o hash completo. */
export function hashLogPrefix(hash: string): string {
  return hash.slice(0, 8)
}

/**
 * Revisão do save parcial: contador crescente do cliente, persistido junto com
 * a key (vivem e morrem juntos no mesmo storage). O update só aplica revisão
 * ESTRITAMENTE maior que a armazenada — dois saves fora de ordem (handshake
 * atrasado chegando depois do beacon) não regridem as respostas.
 * Cliente legado (sem revisão) mantém o comportamento atual de sobrescrita.
 */
export function shouldApplyRevision(
  stored: number | null | undefined,
  incoming: number | null | undefined
): boolean {
  if (incoming == null) return true // cliente legado: sem revisão → comportamento atual
  if (stored == null) return true // row sem revisão ainda → primeira revisão aplica
  return incoming > stored
}

/** Valida a revisão vinda do cliente. Fora do formato → null (trata como legado). */
export function parseRevision(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 1_000_000) return null
  return raw
}
