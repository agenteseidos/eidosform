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

/* ------------------------------------------------------------------------- *
 * DESTINO/LINK DE WHATSAPP — regra ÚNICA da stack de notificação.
 *
 * Motivação (auditoria Codex 2026-07-23, P2-2): painel, PUT e envio tinham
 * regras DIFERENTES — UI e persistência aceitavam 10 dígitos, o envio exigia
 * ≥11. Dava pra salvar e HABILITAR uma configuração que nunca enviava, em
 * silêncio. Daqui pra frente todos os três importam daqui.
 * ------------------------------------------------------------------------- */

export const WHATSAPP_MIN_DIGITS = 10
export const WHATSAPP_MAX_DIGITS = 15

/** Só os dígitos — remove máscara, espaço, "+" e parênteses. */
export function whatsAppDigits(raw: unknown): string {
  return String(raw ?? '').replace(/\D/g, '')
}

/** Faixa aceita em TODA a stack (painel, PUT, envio, {whatsapp_link}). */
export function isValidWhatsAppPhone(raw: unknown): boolean {
  const d = whatsAppDigits(raw)
  return d.length >= WHATSAPP_MIN_DIGITS && d.length <= WHATSAPP_MAX_DIGITS
}

/**
 * Dígitos prontos para `wa.me/<digits>` ou para o envio.
 *
 * P2-3: 10/11 dígitos é número BRASILEIRO SEM DDI (DDD + 8 ou 9 dígitos).
 * Jogar isso num wa.me sem país gera link que aponta pra OUTRO número — pior
 * que não ter link. Como o produto é pt-BR e o lead digita no formato local, o
 * DDI 55 é prefixado EXPLICITAMENTE nesses dois casos; 12–15 dígitos já vêm com
 * país e passam intactos. Fora da faixa devolve '' e o chamador faz self-hide
 * (nunca chuta um número).
 */
export function toWhatsAppDigits(raw: unknown): string {
  const d = whatsAppDigits(raw)
  if (d.length < WHATSAPP_MIN_DIGITS || d.length > WHATSAPP_MAX_DIGITS) return ''
  if (d.length === 10 || d.length === 11) return `55${d}`
  return d
}
