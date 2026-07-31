import { describe, it, expect } from 'vitest'
import { resolveEmailRecipients, buildEmailIdempotencyKey } from './notification-email'

describe('resolveEmailRecipients — quem recebe', () => {
  it('dono sempre entra; notify_email ACRESCENTA um segundo destinatário', () => {
    expect(
      resolveEmailRecipients({
        ownerEmail: 'dono@clinica.com',
        notifyEmail: 'secretaria@clinica.com',
        notifyEmailEnabled: true,
      })
    ).toEqual([
      { email: 'dono@clinica.com', role: 'owner' },
      { email: 'secretaria@clinica.com', role: 'form_email' },
    ])
  })

  it('notify_email desabilitado não entra, mas o dono continua recebendo', () => {
    expect(
      resolveEmailRecipients({
        ownerEmail: 'dono@clinica.com',
        notifyEmail: 'secretaria@clinica.com',
        notifyEmailEnabled: false,
      })
    ).toEqual([{ email: 'dono@clinica.com', role: 'owner' }])
  })

  it('MESMO e-mail a menos de caixa e espaços = UM envio só', () => {
    // A dedup antiga era comparação exata: " Dono@Clinica.com " passava por
    // outra pessoa e o mesmo humano recebia dois e-mails da mesma resposta.
    const r = resolveEmailRecipients({
      ownerEmail: 'dono@clinica.com',
      notifyEmail: '  Dono@Clinica.COM  ',
      notifyEmailEnabled: true,
    })
    expect(r).toEqual([{ email: 'dono@clinica.com', role: 'owner' }])
  })

  it('sem dono, só o endereço do formulário', () => {
    expect(
      resolveEmailRecipients({ ownerEmail: null, notifyEmail: 'contato@x.com', notifyEmailEnabled: true })
    ).toEqual([{ email: 'contato@x.com', role: 'form_email' }])
  })

  it('sem nenhum endereço utilizável, lista vazia (ninguém é notificado)', () => {
    expect(resolveEmailRecipients({ ownerEmail: '   ', notifyEmail: '', notifyEmailEnabled: true })).toEqual([])
  })
})

describe('buildEmailIdempotencyKey — chave POR DESTINATÁRIO', () => {
  const base = { event: 'new-response' as const, formId: 'f1', responseId: 'r1' }

  it('DIFERE entre destinatários da mesma resposta', () => {
    // Sem isto, os dois e-mails legítimos colidiriam na Resend e um sumiria.
    expect(buildEmailIdempotencyKey({ ...base, email: 'a@x.com' })).not.toBe(
      buildEmailIdempotencyKey({ ...base, email: 'b@x.com' })
    )
  })

  it('é ESTÁVEL para o mesmo destinatário (retry não duplica)', () => {
    expect(buildEmailIdempotencyKey({ ...base, email: 'a@x.com' })).toBe(
      buildEmailIdempotencyKey({ ...base, email: 'a@x.com' })
    )
  })

  it('normaliza caixa e espaços antes de hashear', () => {
    expect(buildEmailIdempotencyKey({ ...base, email: '  A@X.com ' })).toBe(
      buildEmailIdempotencyKey({ ...base, email: 'a@x.com' })
    )
  })

  it('difere entre respostas e entre formulários', () => {
    const k = buildEmailIdempotencyKey({ ...base, email: 'a@x.com' })
    expect(buildEmailIdempotencyKey({ ...base, responseId: 'r2', email: 'a@x.com' })).not.toBe(k)
    expect(buildEmailIdempotencyKey({ ...base, formId: 'f2', email: 'a@x.com' })).not.toBe(k)
  })

  it('não expõe o endereço em claro', () => {
    const k = buildEmailIdempotencyKey({ ...base, email: 'paciente@gmail.com' })
    expect(k).toMatch(/^[a-f0-9]{64}$/)
    expect(k).not.toContain('paciente')
  })
})
