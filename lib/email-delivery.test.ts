/**
 * Registro de entrega de e-mail (auditoria 2026-08, lote 3 · L3-4).
 *
 * O teste que importa aqui é o da ESCADA DE STATUS. O webhook da Resend não garante ordem: um
 * `email.delivered` de uma tentativa pode chegar depois do `email.bounced` de outra. Sem a escada,
 * o evento atrasado rebaixaria o bounce para "entregue" — apagando exatamente o alarme que este
 * módulo existe para acender.
 *
 * O segundo teste que importa é a TOLERÂNCIA À TABELA AUSENTE: o código foi ao ar antes da
 * migration rodar no banco, e nesse intervalo nada disso pode derrubar a notificação de lead.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }))
const upsert = vi.fn(() => Promise.resolve({ error: null }))
let linhaAtual: { status: string } | null = null
let erroLeitura: { code?: string; message?: string } | null = null

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      upsert,
      update,
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: linhaAtual, error: erroLeitura }) }),
      }),
    }),
  }),
}))
const logError = vi.fn()
vi.mock('@/lib/logger', () => ({
  logError: (...a: unknown[]) => logError(...a),
  logWarn: vi.fn(),
  log: vi.fn(),
}))

import { applyResendEvent, recordEmailAccepted } from './email-delivery'

beforeEach(() => {
  update.mockClear(); upsert.mockClear(); logError.mockClear()
  linhaAtual = { status: 'accepted' }
  erroLeitura = null
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave'
})

describe('applyResendEvent — escada de status', () => {
  it('avança accepted → delivered', async () => {
    expect(await applyResendEvent({ type: 'email.delivered', resendId: 're_1' })).toBe(true)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'delivered' }))
  })

  it('avança delivered → bounced (o e-mail foi devolvido depois)', async () => {
    linhaAtual = { status: 'delivered' }
    expect(await applyResendEvent({ type: 'email.bounced', resendId: 're_1' })).toBe(true)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'bounced' }))
  })

  it('NÃO rebaixa bounced para delivered — o evento fora de ordem é descartado', async () => {
    linhaAtual = { status: 'bounced' }
    expect(await applyResendEvent({ type: 'email.delivered', resendId: 're_1' })).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('NÃO rebaixa complained (reclamação de spam é o topo da escada)', async () => {
    linhaAtual = { status: 'complained' }
    for (const t of ['email.delivered', 'email.bounced', 'email.sent', 'email.delivery_delayed']) {
      expect(await applyResendEvent({ type: t, resendId: 're_1' })).toBe(false)
    }
    expect(update).not.toHaveBeenCalled()
  })

  it('bounce e reclamação viram log de ERRO — tabela sozinha ninguém olha', async () => {
    await applyResendEvent({ type: 'email.bounced', resendId: 're_1', reason: 'mailbox full' })
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('bounced'), undefined,
      expect.objectContaining({ resendId: 're_1', reason: 'mailbox full' })
    )
  })

  it('ignora evento desconhecido e evento de envio que não registramos', async () => {
    expect(await applyResendEvent({ type: 'email.opened', resendId: 're_1' })).toBe(false)
    linhaAtual = null
    expect(await applyResendEvent({ type: 'email.bounced', resendId: 're_desconhecido' })).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('tabela ainda inexistente no banco: devolve false, não lança, não loga erro', async () => {
    erroLeitura = { code: '42P01', message: 'relation "email_deliveries" does not exist' }
    linhaAtual = null
    expect(await applyResendEvent({ type: 'email.bounced', resendId: 're_1' })).toBe(false)
    expect(logError).not.toHaveBeenCalled()
  })
})

describe('recordEmailAccepted', () => {
  it('grava o comprovante sem sobrescrever linha já existente', async () => {
    await recordEmailAccepted({
      resendId: 're_9', kind: 'new-response', recipientMasked: 'ab12cd34@gmail.com',
      formId: 'f1', responseId: 'r1', role: 'owner',
    })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ resend_id: 're_9', status: 'accepted', recipient_masked: 'ab12cd34@gmail.com' }),
      // `ignoreDuplicates` protege contra o webhook ter chegado ANTES desta gravação.
      expect.objectContaining({ onConflict: 'resend_id', ignoreDuplicates: true })
    )
  })

  it('sem id da Resend não grava nada', async () => {
    await recordEmailAccepted({ resendId: '', kind: 'new-response', recipientMasked: 'x@y.com' })
    expect(upsert).not.toHaveBeenCalled()
  })
})
