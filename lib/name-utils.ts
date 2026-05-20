/**
 * lib/name-utils.ts — utilidades de extração e normalização de nome.
 *
 * Compartilhado entre lead-extraction (webhook/CAPI) e integration-stubs
 * (WhatsApp). Centraliza a lista de keywords de detecção e a normalização
 * pra evitar drift entre os dois caminhos.
 */

/**
 * Keywords (lowercase, sem acento) usadas pra detectar perguntas de "nome"
 * no título quando não há tipo de pergunta dedicado.
 *
 * A ordem importa: match exato vence match `.includes`. Termos longos
 * primeiro pra ficar mais específico antes de cair em fallbacks curtos.
 */
export const NAME_QUESTION_KEYWORDS = [
  // formal
  'nome completo',
  'qual seu nome',
  'qual o seu nome',
  'seu nome',
  // como te chamamos
  'como gostaria de ser chamado',
  'como gostaria de ser chamada',
  'como gostaria que te chamasse',
  'como gostaria que eu te chame',
  'como prefere ser chamado',
  'como prefere ser chamada',
  'como te chamamos',
  'como te chamar',
  'como te chama',
  'como você prefere',
  // genéricos
  'primeiro nome',
  'chamado',
  'chamada',
  'chamar',
  'nome',
  'name',
] as const

/**
 * Extrai o primeiro nome de uma string, capitalizando a primeira letra.
 * - "joão silva"     → "João"
 * - "MARIA DE LIMA"  → "Maria"
 * - "  ana  "        → "Ana"
 * - ""               → ""
 *
 * Cuidado: não trata títulos honoríficos ("Sr. João" → "Sr."). Como o input
 * é o respondente preenchendo um form pra terapia/agendamento, raramente
 * digita "Sr.". Se virar problema, adicionamos lista de skip aqui.
 */
export function firstName(full: string | null | undefined): string {
  const trimmed = (full ?? '').trim()
  if (!trimmed) return ''
  const first = trimmed.split(/\s+/)[0]
  if (!first) return ''
  return first.charAt(0).toLocaleUpperCase('pt-BR') + first.slice(1).toLocaleLowerCase('pt-BR')
}

/**
 * Capitaliza cada palavra de um nome completo.
 * "joão silva da costa" → "João Silva da Costa" (artigos minúsculos)
 */
const LOWERCASE_PARTICLES = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])
export function capitalizeFullName(full: string | null | undefined): string {
  const trimmed = (full ?? '').trim()
  if (!trimmed) return ''
  return trimmed
    .split(/\s+/)
    .map((word, idx) => {
      const lower = word.toLocaleLowerCase('pt-BR')
      if (idx > 0 && LOWERCASE_PARTICLES.has(lower)) return lower
      return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1)
    })
    .join(' ')
}
