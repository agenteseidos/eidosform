import { describe, it, expect } from 'vitest'
import { buildMessage, DEFAULT_WHATSAPP_MESSAGE_TEMPLATE, ABANDONED_LEAD_TEMPLATE, SAMPLE_LEAD_DATA } from './whatsapp-template'

describe('buildMessage', () => {
  it('{whatsapp_link} vira wa.me com telefone normalizado (nunca o cru)', () => {
    const msg = buildMessage('Responder: {whatsapp_link}', { phone: '+55 (83) 99937-6704' })
    expect(msg).toBe('Responder: https://wa.me/5583999376704')
  })

  it('{whatsapp_link} sem telefone apaga a LINHA inteira', () => {
    const msg = buildMessage('linha1\n💬 Responder: {whatsapp_link}\nlinha3', { phone: '' })
    expect(msg).toBe('linha1\nlinha3')
  })

  it('{meta_events} vazio apaga a linha; preenchido substitui', () => {
    const t = 'a\n*Eventos Meta:* {meta_events}\nb'
    expect(buildMessage(t, { meta_events: '' })).toBe('a\nb')
    expect(buildMessage(t, { meta_events: 'Lead' })).toBe('a\n*Eventos Meta:* Lead\nb')
  })

  it('{form_name} sai em negrito', () => {
    expect(buildMessage('{form_name}', { form_name: 'Meu Form' })).toBe('*Meu Form*')
  })

  it('template padrão renderiza inteiro com os dados de exemplo (sem placeholder sobrando)', () => {
    const msg = buildMessage(DEFAULT_WHATSAPP_MESSAGE_TEMPLATE, SAMPLE_LEAD_DATA)
    expect(msg).not.toMatch(/\{(form_name|respostas|whatsapp_link|meta_events|data|horario)\}/)
    expect(msg).toContain('https://wa.me/5511999990000')
    expect(msg).toContain('*Formulário de Exemplo*')
  })

  it('template de abandono renderiza com os dados de exemplo', () => {
    const msg = buildMessage(ABANDONED_LEAD_TEMPLATE, SAMPLE_LEAD_DATA)
    expect(msg).toContain('Lead incompleto')
    expect(msg).toContain('30 min')
    expect(msg).not.toMatch(/\{abandono_minutos\}/)
  })

  it('chave desconhecida permanece literal (não apaga conteúdo do usuário)', () => {
    expect(buildMessage('{inventada}', {})).toBe('{inventada}')
  })
})

describe('buildMessage — limpeza de buracos (23/07)', () => {
  it('colapsa 3+ quebras (respostas vazia + linha self-hide) em no máx. 1 branco', () => {
    const t = '⚠️ Título\nsub\n\n{respostas}\n\n💬 Responder: {whatsapp_link}\n*Eventos:* {meta_events}'
    const msg = buildMessage(t, { respostas: '', phone: '5583999376704', meta_events: '' })
    expect(msg).not.toMatch(/\n{3,}/)          // sem buraco triplo
    expect(msg).toContain('💬 Responder: https://wa.me/5583999376704')
    expect(msg).not.toMatch(/Eventos/)          // linha vazia sumiu
    expect(msg.endsWith('5583999376704')).toBe(true) // trim no fim
  })
  it('preserva o \\n\\n entre blocos de {respostas}', () => {
    const msg = buildMessage('{respostas}', { respostas: '*P1*\nR1\n\n*P2*\nR2' })
    expect(msg).toBe('*P1*\nR1\n\n*P2*\nR2')
  })
})
