import { describe, it, expect, afterEach } from 'vitest'
import { canUseLeadWhatsApp, getLeadWhatsAppAllowedUserIds } from './whatsapp-capability'

const ADMIN = '02a8c2a5-dc7e-4243-8a3a-2e56223df0c2'
const OUTRO = '11111111-2222-3333-4444-555555555555'

const original = process.env.WHATSAPP_NOTIFICATION_ALLOWED_USER_IDS
afterEach(() => {
  if (original === undefined) delete process.env.WHATSAPP_NOTIFICATION_ALLOWED_USER_IDS
  else process.env.WHATSAPP_NOTIFICATION_ALLOWED_USER_IDS = original
})

describe('capacidade de notificação de lead por WhatsApp', () => {
  it('FAIL-CLOSED: sem env, NINGUÉM pode — nem o admin', () => {
    delete process.env.WHATSAPP_NOTIFICATION_ALLOWED_USER_IDS
    expect(canUseLeadWhatsApp(ADMIN)).toBe(false)
    expect(getLeadWhatsAppAllowedUserIds()).toEqual([])
  })

  it('FAIL-CLOSED: env vazia ou só vírgulas não libera ninguém', () => {
    for (const valor of ['', '   ', ',,,', ' , , ']) {
      process.env.WHATSAPP_NOTIFICATION_ALLOWED_USER_IDS = valor
      expect(canUseLeadWhatsApp(ADMIN)).toBe(false)
    }
  })

  it('libera SÓ quem está na lista', () => {
    process.env.WHATSAPP_NOTIFICATION_ALLOWED_USER_IDS = ADMIN
    expect(canUseLeadWhatsApp(ADMIN)).toBe(true)
    expect(canUseLeadWhatsApp(OUTRO)).toBe(false)
  })

  it('sem dono resolvido = negado (nunca assumir permissão)', () => {
    process.env.WHATSAPP_NOTIFICATION_ALLOWED_USER_IDS = ADMIN
    expect(canUseLeadWhatsApp(null)).toBe(false)
    expect(canUseLeadWhatsApp(undefined)).toBe(false)
    expect(canUseLeadWhatsApp('')).toBe(false)
  })

  it('tolera espaços, caixa e duplicatas na env', () => {
    process.env.WHATSAPP_NOTIFICATION_ALLOWED_USER_IDS = ` ${ADMIN.toUpperCase()} , ${ADMIN} ,${OUTRO} `
    expect(getLeadWhatsAppAllowedUserIds()).toEqual([ADMIN, OUTRO])
    expect(canUseLeadWhatsApp(ADMIN.toUpperCase())).toBe(true)
  })

  it('é por UUID, não por e-mail — e-mail na env não libera', () => {
    // O e-mail muda; o UUID não. Se alguém setar e-mail por engano, nega.
    process.env.WHATSAPP_NOTIFICATION_ALLOWED_USER_IDS = 'medeiros.sco@gmail.com'
    expect(canUseLeadWhatsApp(ADMIN)).toBe(false)
  })
})
