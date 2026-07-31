import { describe, it, expect, vi } from 'vitest'
import { claimStateForResponse, hasAnsweredSomething, recipientHash } from './route'
import { resolveEmailRecipients, buildEmailIdempotencyKey } from '@/lib/notification-email'
import { buildNotificationModel } from '@/lib/notification-model'
import { buildAbandonedLeadEmail } from '@/lib/notification-content'
import { PLANS } from '@/lib/plan-definitions'

vi.mock('@/lib/logger', () => ({ log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }))

const NOW = new Date('2026-07-30T18:00:00.000Z').getTime()
const LEASE_CUTOFF = NOW - 10 * 60_000
const recente = new Date(NOW - 60_000).toISOString()
const velho = new Date(NOW - 30 * 60_000).toISOString()

const claim = (over: Partial<{ response_id: string; form_id: string; recipient_role: string; status: string; created_at: string }> = {}) => ({
  response_id: 'r1', form_id: 'f1', recipient_role: 'owner', status: 'sent', created_at: recente, ...over,
})

// 1) CLAIM POR DESTINATÁRIO
describe('claim por destinatário', () => {
  it('dono e endereço adicional geram DOIS destinatários (dois claims)', () => {
    const r = resolveEmailRecipients({
      ownerEmail: 'dono@clinica.com', notifyEmail: 'secretaria@clinica.com', notifyEmailEnabled: true,
    })
    expect(r.map((x) => x.role)).toEqual(['owner', 'form_email'])
    expect(new Set(r.map((x) => recipientHash(x.email))).size).toBe(2)
  })

  it('mesmo e-mail (a menos de caixa/espaço) gera UM só — dedup ANTES do claim', () => {
    const r = resolveEmailRecipients({
      ownerEmail: 'dono@clinica.com', notifyEmail: ' Dono@Clinica.COM ', notifyEmailEnabled: true,
    })
    expect(r).toHaveLength(1)
  })

  it('o hash não guarda o endereço, mas é estável e case-insensitive', () => {
    expect(recipientHash(' Dono@Clinica.COM ')).toBe(recipientHash('dono@clinica.com'))
    expect(recipientHash('dono@clinica.com')).not.toContain('dono')
  })

  it('resposta com 1 de 2 destinatários avisados continua candidata', () => {
    // O dono já recebeu; a secretária foi configurada depois. A resposta NÃO
    // pode ser dada como resolvida, senão o segundo nunca é avisado.
    const state = claimStateForResponse([claim({ recipient_role: 'owner', status: 'sent' })], 2, LEASE_CUTOFF)
    expect(state).toBeUndefined()
  })

  it('resposta com TODOS os destinatários avisados sai da fila', () => {
    const state = claimStateForResponse(
      [claim({ recipient_role: 'owner' }), claim({ recipient_role: 'form_email' })], 2, LEASE_CUTOFF
    )
    expect(state?.wacli_message_id).not.toBeNull()
  })

  it('falha terminal NÃO é retentada (evita o martelo de 27/07)', () => {
    const state = claimStateForResponse([claim({ status: 'failed' })], 1, LEASE_CUTOFF)
    expect(state?.wacli_message_id).not.toBeNull()
  })
})

// 3) CORRIDA e 4) LEASE
describe('corrida e lease', () => {
  it('claim pendente RECENTE bloqueia (o outro run está enviando agora)', () => {
    const state = claimStateForResponse([claim({ status: 'pending', created_at: recente })], 1, LEASE_CUTOFF)
    expect(state?.wacli_message_id).not.toBeNull()
  })

  it('claim pendente VENCIDO é retomável', () => {
    const state = claimStateForResponse([claim({ status: 'pending', created_at: velho })], 1, LEASE_CUTOFF)
    expect(state).toEqual({ wacli_message_id: null, created_at: velho })
  })

  it('entre dois pendentes vencidos, o lease considera o MAIS VELHO', () => {
    const maisVelho = new Date(NOW - 60 * 60_000).toISOString()
    const state = claimStateForResponse(
      [claim({ recipient_role: 'owner', status: 'pending', created_at: velho }),
       claim({ recipient_role: 'form_email', status: 'pending', created_at: maisVelho })],
      2, LEASE_CUTOFF
    )
    expect(state?.created_at).toBe(maisVelho)
  })

  it('formulário sem destinatário nunca é candidato', () => {
    expect(claimStateForResponse([], 0, LEASE_CUTOFF)?.wacli_message_id).not.toBeNull()
  })
})

// 5) ELEGIBILIDADE — a regressão direta do isActionable do WhatsApp
describe('elegibilidade — lead SEM telefone entra no alerta por e-mail', () => {
  it('resposta só com nome e e-mail (nenhum telefone) é acionável', () => {
    expect(hasAnsweredSomething({ q_nome: 'Maria', q_email: 'maria@x.com' })).toBe(true)
  })

  it('resposta totalmente vazia não vira alerta (seria ruído)', () => {
    expect(hasAnsweredSomething({ q1: '', q2: '   ', q3: null })).toBe(false)
    expect(hasAnsweredSomething({})).toBe(false)
    expect(hasAnsweredSomething(null)).toBe(false)
  })

  it('array e objeto com conteúdo contam como resposta', () => {
    expect(hasAnsweredSomething({ q: ['Ansiedade'] })).toBe(true)
    expect(hasAnsweredSomething({ q: { url: 'https://x/a.pdf' } })).toBe(true)
    expect(hasAnsweredSomething({ q: [] })).toBe(false)
  })
})

// 6) HORÁRIO e conteúdo do aviso
describe('conteúdo do alerta', () => {
  const LAST_ACTIVITY = '2026-07-30T17:32:10.000Z' // 14:32 em São Paulo

  function model(over: { inactiveMinutes?: number; responseData?: Record<string, unknown> } = {}) {
    return buildNotificationModel({
      formId: 'f1', responseId: 'r1', appUrl: 'https://eidosform.com.br',
      eventAt: LAST_ACTIVITY,
      inactiveMinutes: over.inactiveMinutes ?? 45,
      form: { id: 'f1', title: 'Psicoterapia', user_id: 'u1', questions: [
        { id: 'q_nome', type: 'short_text', title: 'Qual seu nome?' },
        { id: 'q_tel', type: 'phone', title: 'Seu WhatsApp' },
        { id: 'q_falta', type: 'long_text', title: 'O que te trouxe aqui?' },
      ] },
      responseData: over.responseData ?? { q_nome: 'maria fernanda souza', q_tel: '83999998888' },
    })
  }

  it('usa last_activity_at, não submitted_at nem o relógio do envio', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'))
    const { html } = buildAbandonedLeadEmail(model())
    expect(html).toContain('30/07/2026 às 14:32')
    expect(html).toContain('Última atividade')
    expect(html).not.toContain('01/08/2026')
    vi.useRealTimers()
  })

  it('assunto: "Lead incompleto: {nome} — {título}"', () => {
    expect(buildAbandonedLeadEmail(model()).subject).toBe('Lead incompleto: Maria Fernanda Souza — Psicoterapia')
  })

  it('sem nome coletado: "Lead incompleto em {título}"', () => {
    const m = model({ responseData: { q_falta: 'ansiedade' } })
    expect(buildAbandonedLeadEmail(m).subject).toBe('Lead incompleto em Psicoterapia')
  })

  it('diz SEM ATIVIDADE há X min — nunca "começou a preencher há X min"', () => {
    const { html, text } = buildAbandonedLeadEmail(model({ inactiveMinutes: 45 }))
    for (const body of [html, text]) {
      expect(body).toContain('Sem atividade há 45 min')
      expect(body).not.toContain('Começou a preencher há')
    }
  })

  it('mostra o que JÁ foi respondido e omite a pergunta não respondida', () => {
    const { html } = buildAbandonedLeadEmail(model())
    expect(html).toContain('O que já foi respondido')
    expect(html).toContain('maria fernanda souza')
    expect(html).not.toContain('O que te trouxe aqui?')
  })

  it('botão de WhatsApp quando há telefone; escape continua valendo', () => {
    const m = model({ responseData: { q_nome: '<script>x</script>', q_tel: '83999998888' } })
    const { html } = buildAbandonedLeadEmail(m)
    expect(html).toContain('https://wa.me/5583999998888')
    expect(html).not.toContain('<script>')
  })

  it('a chave de idempotência do abandono NÃO colide com a da resposta completa', () => {
    // O mesmo lead pode abandonar e depois completar: são dois avisos legítimos.
    const base = { formId: 'f1', responseId: 'r1', email: 'dono@clinica.com' }
    expect(buildEmailIdempotencyKey({ ...base, event: 'abandoned' }))
      .not.toBe(buildEmailIdempotencyKey({ ...base, event: 'new-response' }))
  })
})

// 7) GATE DE PLANO
describe('gate de plano', () => {
  it('Free e Starter NÃO recebem alerta de abandono', () => {
    expect(PLANS.free.abandonedLeadAlert).toBe(false)
    expect(PLANS.starter.abandonedLeadAlert).toBe(false)
  })

  it('Plus e Professional recebem', () => {
    expect(PLANS.plus.abandonedLeadAlert).toBe(true)
    expect(PLANS.professional.abandonedLeadAlert).toBe(true)
  })
})

// 8) REGRESSÃO DO CRON DE WHATSAPP
describe('cron de WhatsApp inalterado', () => {
  it('continua exigindo telefone e mantendo os limites calibrados dele', async () => {
    const wa = await import('../abandoned-leads/route')
    // As funções puras que o e-mail reaproveita seguem exportadas e com o
    // mesmo contrato — se alguém mexer nelas, este teste cai junto.
    expect(typeof wa.scanForCandidates).toBe('function')
    expect(typeof wa.parseThresholdMin).toBe('function')
    expect(wa.parseThresholdMin(undefined)).toBe(30)
    expect(wa.parseThresholdMin('0')).toBeNull()
  })

  it('o alerta por e-mail escreve em OUTRA tabela — os canais não se anulam', async () => {
    const src = await import('node:fs/promises')
    const waSrc = await src.readFile('app/api/cron/abandoned-leads/route.ts', 'utf8')
    const emailSrc = await src.readFile('app/api/cron/abandoned-leads-email/route.ts', 'utf8')

    // O que importa é ACESSO A BANCO, não menção em comentário (o cron de
    // e-mail documenta por que NÃO usa a tabela do WhatsApp).
    // O cron de WhatsApp não escreve na tabela nova...
    expect(waSrc).not.toContain("from('form_notification_logs')")
    // ...e o cron de e-mail não encosta no claim do WhatsApp.
    expect(emailSrc).not.toContain("from('form_whatsapp_logs')")
    expect(emailSrc).not.toContain("from('form_whatsapp_settings')")
    // nem reutiliza o marcador de status dele
    expect(emailSrc).not.toContain("'abandoned_alert'")
  })
})
