import type { QuestionConfig } from '@/lib/database.types'

/**
 * Extração/normalização de identidade (e-mail/telefone) de uma response —
 * usada APENAS pelo detector passivo de duplicatas (log-only, decisão da
 * auditoria Codex 2026-07-08: medir duplicação residual pós-Fase 1 antes de
 * decidir a reconciliação da Fase 3). NÃO autoriza nada: identidade identifica,
 * não prova posse.
 */

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  // validação mínima — só pra não indexar lixo como identidade
  if (v.length < 5 || v.length > 254 || !v.includes('@') || !v.includes('.')) return null
  return v
}

export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15) return null
  return digits
}

/**
 * Telefones iguais mesmo com formatação/DDI divergente ("+55 83 9993-78937"
 * vs "83999378937"): compara dígitos e aceita sufixo comum ≥ 8 dígitos.
 */
export function phonesMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  return shorter.length >= 8 && longer.endsWith(shorter)
}

export interface ExtractedIdentity {
  email: string | null
  phone: string | null
}

/**
 * Identidade de uma response: respostas de perguntas tipo email/phone +
 * campos ocultos da URL (nome/email/telefone — mesmos campos que o Sheets
 * trata como identidade). Primeira ocorrência válida vence.
 */
export function extractIdentity(
  questions: Pick<QuestionConfig, 'id' | 'type'>[],
  answers: Record<string, unknown> | null | undefined,
  urlParams: Record<string, string> | null | undefined
): ExtractedIdentity {
  let email: string | null = null
  let phone: string | null = null
  if (answers) {
    for (const q of questions) {
      if (!email && q.type === 'email') email = normalizeEmail(answers[q.id])
      if (!phone && q.type === 'phone') phone = normalizePhone(answers[q.id])
      if (email && phone) break
    }
  }
  if (!email) email = normalizeEmail(urlParams?.email)
  if (!phone) phone = normalizePhone(urlParams?.telefone)
  return { email, phone }
}

/** true se as duas identidades apontam pra mesma pessoa (e-mail OU telefone). */
export function identitiesMatch(a: ExtractedIdentity, b: ExtractedIdentity): boolean {
  if (a.email && b.email && a.email === b.email) return true
  if (phonesMatch(a.phone, b.phone)) return true
  return false
}
