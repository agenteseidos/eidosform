import { describe, it, expect } from 'vitest'
import {
  isValidWhatsAppPhone, toWhatsAppDigits, whatsAppDigits,
  WHATSAPP_MIN_DIGITS, WHATSAPP_MAX_DIGITS,
} from './phone'

/** P2-2 e P2-3 da 2ª auditoria Codex. */

describe('whatsAppDigits / isValidWhatsAppPhone — regra ÚNICA (P2-2)', () => {
  it('extrai só dígitos de qualquer máscara', () => {
    expect(whatsAppDigits('+55 (83) 99937-6704')).toBe('5583999376704')
    expect(whatsAppDigits(null)).toBe('')
    expect(whatsAppDigits(undefined)).toBe('')
  })

  it('aceita a MESMA faixa que o painel e o PUT (10..15)', () => {
    // O bug: o envio exigia >=11 enquanto UI/persistência aceitavam >=10 —
    // dava pra salvar e habilitar uma config que nunca enviava, em silêncio.
    expect(WHATSAPP_MIN_DIGITS).toBe(10)
    expect(WHATSAPP_MAX_DIGITS).toBe(15)
    expect(isValidWhatsAppPhone('8332221100')).toBe(true)      // 10 — antes o envio recusava
    expect(isValidWhatsAppPhone('83999376704')).toBe(true)     // 11
    expect(isValidWhatsAppPhone('5583999376704')).toBe(true)   // 13
    expect(isValidWhatsAppPhone('123456789')).toBe(false)      // 9
    expect(isValidWhatsAppPhone('1234567890123456')).toBe(false) // 16
  })
})

describe('toWhatsAppDigits — DDI explícito (P2-3)', () => {
  it('10 e 11 dígitos são BR sem DDI e ganham 55', () => {
    // wa.me/8399937... sem país aponta pra OUTRO número — pior que não ter link.
    expect(toWhatsAppDigits('83999376704')).toBe('5583999376704')
    expect(toWhatsAppDigits('8332221100')).toBe('558332221100')
  })

  it('12–15 dígitos já têm país e passam intactos', () => {
    expect(toWhatsAppDigits('5583999376704')).toBe('5583999376704')
    expect(toWhatsAppDigits('351912345678')).toBe('351912345678')
  })

  it('fora da faixa devolve vazio (chamador faz self-hide, nunca chuta)', () => {
    expect(toWhatsAppDigits('123')).toBe('')
    expect(toWhatsAppDigits('')).toBe('')
    expect(toWhatsAppDigits('não é telefone')).toBe('')
    expect(toWhatsAppDigits(null)).toBe('')
  })

  it('normaliza máscara antes de decidir', () => {
    expect(toWhatsAppDigits('(83) 99937-6704')).toBe('5583999376704')
  })
})
