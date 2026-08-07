/**
 * Webhook da Resend (auditoria 2026-08, lote 3 · L3-4).
 *
 * O que está sob teste é a fronteira de CONFIANÇA. Este endpoint é público e o que ele grava
 * desliga alarme: aceitar um evento forjado permitiria marcar como `delivered` um e-mail que
 * quicou. Por isso a assinatura é testada nos dois sentidos — aceita a legítima E recusa cada
 * forma de falsificação, incluindo o replay de um evento antigo e verdadeiro.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'

const applyResendEvent = vi.fn(async (_p: unknown) => true)
vi.mock('@/lib/email-delivery', () => ({ applyResendEvent: (p: unknown) => applyResendEvent(p) }))
vi.mock('@/lib/logger', () => ({ logWarn: vi.fn(), logError: vi.fn(), log: vi.fn() }))

import { POST, _internals } from './route'

const SEGREDO_B64 = Buffer.from('segredo-de-teste-com-32-bytes!!!').toString('base64')
const SECRET = `whsec_${SEGREDO_B64}`

function assinar(corpo: string, id: string, ts: string) {
  return `v1,${createHmac('sha256', Buffer.from(SEGREDO_B64, 'base64')).update(`${id}.${ts}.${corpo}`).digest('base64')}`
}

function req(corpo: string, headers: Record<string, string>) {
  return new NextRequest('https://app.eidosform.com/api/webhooks/resend', {
    method: 'POST',
    headers,
    body: corpo,
  })
}

const EVENTO = JSON.stringify({ type: 'email.bounced', data: { email_id: 're_123', bounce: { message: 'mailbox full' } } })

beforeEach(() => {
  applyResendEvent.mockClear()
  process.env.RESEND_WEBHOOK_SECRET = SECRET
})

describe('POST /api/webhooks/resend', () => {
  it('aceita evento com assinatura válida e repassa o motivo do bounce', async () => {
    const ts = String(Math.floor(Date.now() / 1000))
    const res = await POST(req(EVENTO, {
      'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': assinar(EVENTO, 'msg_1', ts),
    }))
    expect(res.status).toBe(200)
    expect(applyResendEvent).toHaveBeenCalledWith({
      type: 'email.bounced', resendId: 're_123', reason: 'mailbox full',
    })
  })

  it('FAIL-CLOSED: sem RESEND_WEBHOOK_SECRET recusa tudo com 503', async () => {
    delete process.env.RESEND_WEBHOOK_SECRET
    const ts = String(Math.floor(Date.now() / 1000))
    const res = await POST(req(EVENTO, {
      'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': assinar(EVENTO, 'msg_1', ts),
    }))
    expect(res.status).toBe(503)
    expect(applyResendEvent).not.toHaveBeenCalled()
  })

  it('recusa assinatura ausente, forjada e de outro segredo', async () => {
    const ts = String(Math.floor(Date.now() / 1000))
    const base = { 'svix-id': 'msg_1', 'svix-timestamp': ts }

    expect((await POST(req(EVENTO, base))).status).toBe(401)
    expect((await POST(req(EVENTO, { ...base, 'svix-signature': 'v1,AAAA' }))).status).toBe(401)

    const outroSegredo = createHmac('sha256', Buffer.from('outro')).update(`msg_1.${ts}.${EVENTO}`).digest('base64')
    expect((await POST(req(EVENTO, { ...base, 'svix-signature': `v1,${outroSegredo}` }))).status).toBe(401)

    expect(applyResendEvent).not.toHaveBeenCalled()
  })

  it('recusa corpo adulterado — a assinatura cobre o texto CRU', async () => {
    // O ataque real: pegar um evento legítimo e trocar `bounced` por `delivered` mantendo a
    // assinatura original. É o caso que desligaria o alarme.
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = assinar(EVENTO, 'msg_1', ts)
    const adulterado = EVENTO.replace('email.bounced', 'email.delivered')
    const res = await POST(req(adulterado, { 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': sig }))
    expect(res.status).toBe(401)
    expect(applyResendEvent).not.toHaveBeenCalled()
  })

  it('recusa REPLAY: assinatura verdadeira, carimbo velho', async () => {
    const velho = String(Math.floor((Date.now() - 10 * 60 * 1000) / 1000))
    const res = await POST(req(EVENTO, {
      'svix-id': 'msg_1', 'svix-timestamp': velho, 'svix-signature': assinar(EVENTO, 'msg_1', velho),
    }))
    expect(res.status).toBe(401)
  })

  it('aceita quando UMA de várias assinaturas bate (rotação de segredo)', () => {
    const ts = String(Math.floor(Date.now() / 1000))
    const boa = assinar(EVENTO, 'msg_1', ts)
    const ok = _internals.assinaturaValida({
      secret: SECRET, svixId: 'msg_1', svixTimestamp: ts,
      svixSignature: `v1,AAAA ${boa}`, corpoCru: EVENTO, agoraMs: Date.now(),
    })
    expect(ok).toBe(true)
  })

  it('corpo ilegível ou evento incompleto devolve 200 sem gravar (não faz a Resend repetir)', async () => {
    const ts = String(Math.floor(Date.now() / 1000))
    const lixo = 'nao é json'
    const r1 = await POST(req(lixo, {
      'svix-id': 'msg_2', 'svix-timestamp': ts, 'svix-signature': assinar(lixo, 'msg_2', ts),
    }))
    expect(r1.status).toBe(200)

    const semId = JSON.stringify({ type: 'email.delivered', data: {} })
    const r2 = await POST(req(semId, {
      'svix-id': 'msg_3', 'svix-timestamp': ts, 'svix-signature': assinar(semId, 'msg_3', ts),
    }))
    expect(r2.status).toBe(200)
    expect(applyResendEvent).not.toHaveBeenCalled()
  })
})
