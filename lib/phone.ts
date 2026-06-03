/**
 * lib/phone.ts — Validação de telefone independente do tamanho do DDI.
 *
 * O valor é salvo como `DDI + dígitos locais` (ex.: "+5511999998888"). Validar
 * o TOTAL de dígitos seria injusto entre países, porque o DDI varia de 1 dígito
 * (EUA, +1) a 3 (Portugal, +351). Por isso a validação amigável (a que aparece
 * na tela) mira na PARTE LOCAL, que independe do DDI. O backend mantém um teto
 * sobre o total (E.164) como rede de segurança final.
 */

import { countries } from './countries'

/** Faixa aceita para a parte local (sem DDI). Cobre todos os países da lista. */
export const PHONE_LOCAL_MIN = 8
export const PHONE_LOCAL_MAX = 12

/**
 * Extrai os dígitos locais (sem DDI) de um telefone salvo no formato dial+local.
 * Ex.: "+5511999998888" → "11999998888".
 * Se nenhum DDI conhecido casar, retorna todos os dígitos (descontando o "+").
 */
export function getLocalPhoneDigits(value: string): string {
  const trimmed = value.trim()
  // DDI mais longo primeiro, pra "+351" casar antes de qualquer "+3x"/"+5x".
  const byDialLength = [...countries].sort((a, b) => b.dial.length - a.dial.length)
  for (const c of byDialLength) {
    if (trimmed.startsWith(c.dial)) {
      return trimmed.slice(c.dial.length).replace(/\D/g, '')
    }
  }
  return trimmed.replace(/\D/g, '')
}

/** Valida a parte local de um telefone (PHONE_LOCAL_MIN a PHONE_LOCAL_MAX dígitos). */
export function isValidPhoneLocal(value: string): boolean {
  const local = getLocalPhoneDigits(value)
  return local.length >= PHONE_LOCAL_MIN && local.length <= PHONE_LOCAL_MAX
}
