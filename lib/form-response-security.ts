import { checkResponseRateLimitAsync } from '@/lib/response-rate-limit'
import { NON_ANSWER_QUESTION_TYPES } from '@/lib/answer-format'
import { buildQuestionPath } from '@/lib/form-logic-engine'

const MAX_PAYLOAD_BYTES = 50 * 1024
const MAX_ANSWER_KEYS = 200

export { MAX_PAYLOAD_BYTES, MAX_ANSWER_KEYS }

export function sanitizeValue(val: unknown): unknown {
  if (typeof val === 'string') {
    // Strip HTML tags and normalize dangerous patterns
    return val
      .replace(/<\/?[a-zA-Z][^>]*>/g, '')   // remove HTML tags
      .replace(/&[a-zA-Z]+;?/g, (match) => {  // decode common entities then re-strip
        const decoded = match.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x?[0-9a-fA-F]+;?/g, '')
        return decoded
      })
      .replace(/<[^>]*>/g, '')                // second pass after entity decode
  }
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
  questions: Array<{ id: string; type?: string; required?: boolean }>
): boolean {
  // Considera só o caminho efetivamente percorrido — ramos escondidos por
  // lógica condicional não devem invalidar uma resposta que terminou o
  // sub-fluxo do respondente (ex.: lead que cai num content_block de saída
  // antecipada após filtragem por idade).
  const path = buildQuestionPath(
    questions as unknown as Parameters<typeof buildQuestionPath>[0],
    answers,
  )
  const pathSet = path.length > 0 ? new Set(path) : null
  // `html_block` entra junto com `content_block` (auditoria 2026-08, lote 5).
  // Os dois são BLOCOS DE CONTEÚDO: não recebem resposta. Só `content_block` era excluído aqui, e
  // por isso um `html_block` marcado como obrigatório tornava a resposta eternamente incompleta —
  // e "incompleta" é o portão único de e-mail, WhatsApp, planilha, pixel e webhook. O formulário
  // travava para sempre, e nem recarregar resolvia.
  const required = questions.filter((q) => q.required && !(q.type && NON_ANSWER_QUESTION_TYPES.has(q.type)))
  if (required.length === 0) return true
  const requiredInPath = pathSet
    ? required.filter((q) => pathSet.has(q.id))
    : required
  if (requiredInPath.length === 0) return true
  return requiredInPath.every((q) => {
    const val = answers[q.id]
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
