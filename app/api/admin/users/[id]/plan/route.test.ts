import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      async json() { return data },
    }),
  },
}))

vi.mock('@/lib/admin-auth', () => ({
  requireAdmin: vi.fn(),
  getAdminSupabase: vi.fn(),
}))
vi.mock('@/lib/asaas', () => ({
  cancelSubscription: vi.fn(),
  updateSubscription: vi.fn(async () => ({ id: 'sub_1', nextDueDate: '2026-10-30' })),
  getPendingPaymentsBySubscription: vi.fn(async () => ({ ok: true, payments: [{ id: 'pay_pend', dueDate: '2026-09-04', value: 127 }] })),
  updatePaymentDueDate: vi.fn(async () => ({ id: 'pay_pend', dueDate: '2026-09-30' })),
  hasConfirmedPaymentForSubscription: vi.fn(async () => ({ confirmed: false, ok: true })),
}))
vi.mock('@/lib/resend', () => ({
  sendAccessUpdated: vi.fn(async () => ({ id: 'em1' })),
  sendPlanActivated: vi.fn(async () => ({ id: 'em2' })),
  sendPlanChanged: vi.fn(async () => ({ id: 'em3' })),
  sendPlanCancelled: vi.fn(async () => ({ id: 'em4' })),
  sendBillingOpsAlert: vi.fn(async () => ({ id: 'em5' })),
}))
vi.mock('@/lib/plan-limits', () => ({
  PLANS: {
    free: { maxResponses: 100 },
    starter: { maxResponses: 1000 },
    plus: { maxResponses: 5000 },
    professional: { maxResponses: 15000 },
  },
  handleDowngrade: vi.fn(async () => ({ pausedCount: 0 })),
  handleUpgrade: vi.fn(async () => ({ unpausedCount: 0 })),
}))
vi.mock('@/lib/admin-journal', () => ({ recordAdminAction: vi.fn(async () => undefined) }))
vi.mock('@/lib/whatsapp-confirmations', () => ({
  notifyPlanoAlterado: vi.fn(async () => ({ sent: true })),
  notifyPlanoAtivado: vi.fn(async () => ({ sent: true })),
  notifyAssinaturaCancelada: vi.fn(async () => ({ sent: true })),
  notifyAcessoAtualizado: vi.fn(async () => ({ sent: true })),
  planLabel: (p: string) => p,
  brDate: () => '30/09/2026',
}))
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))

import { PATCH } from './route'
import { requireAdmin, getAdminSupabase } from '@/lib/admin-auth'
import { cancelSubscription } from '@/lib/asaas'
import { handleDowngrade, handleUpgrade } from '@/lib/plan-limits'
import { recordAdminAction } from '@/lib/admin-journal'

const mockRequireAdmin = vi.mocked(requireAdmin)
const mockGetAdminSupabase = vi.mocked(getAdminSupabase)
const mockCancelSubscription = vi.mocked(cancelSubscription)
const mockHandleDowngrade = vi.mocked(handleDowngrade)
const mockHandleUpgrade = vi.mocked(handleUpgrade)
const mockRecordAdminAction = vi.mocked(recordAdminAction)

type ProfileFixture = {
  id: string
  email: string | null
  plan: string | null
  plan_cycle: string | null
  plan_status: string | null
  plan_expires_at: string | null
  asaas_subscription_id: string | null
  lifetime_access: boolean | null
  responses_used: number | null
  responses_limit: number | null
}

function profileFixture(overrides: Partial<ProfileFixture> = {}): ProfileFixture {
  return {
    id: 'user-1',
    email: 'cliente@example.com',
    plan: 'starter',
    plan_cycle: null,
    plan_status: 'active',
    plan_expires_at: '2026-08-15T23:59:59.000Z',
    asaas_subscription_id: null,
    lifetime_access: false,
    responses_used: 900,
    responses_limit: 1000,
    ...overrides,
  }
}

/** Supabase fake: single() devolve o fixture; update captura o payload. */
function makeSupabase(profile: ProfileFixture) {
  const updates: Record<string, unknown>[] = []
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ single: async () => ({ data: profile, error: null }) }) }),
    update: (payload: Record<string, unknown>) => {
      updates.push(payload)
      return { eq: async () => ({ error: null }) }
    },
  }))
  return { client: { from }, updates }
}

function makeReq(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as Parameters<typeof PATCH>[0]
}

const params = { params: Promise.resolve({ id: 'user-1' }) }
const FUTURE = '2026-09-30'

beforeEach(() => {
  vi.clearAllMocks()
  // A rota só pausa/despausa forms quando a service key existe no ambiente.
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  mockRequireAdmin.mockResolvedValue({
    ok: true,
    user: { id: 'admin-1', email: 'admin@eidos.com' },
  } as never)
})

describe('PATCH /admin/users/[id]/plan — motivo obrigatório', () => {
  it('rejeita sem motivo (400) antes de tocar o banco', async () => {
    const { client } = makeSupabase(profileFixture())
    mockGetAdminSupabase.mockReturnValue(client as never)
    const res = await PATCH(makeReq({ plan: 'starter', expiresOn: FUTURE }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/motivo/i)
  })

  it('rejeita motivo curto demais', async () => {
    const { client } = makeSupabase(profileFixture())
    mockGetAdminSupabase.mockReturnValue(client as never)
    const res = await PATCH(makeReq({ plan: 'starter', expiresOn: FUTURE, reason: 'ok' }), params)
    expect(res.status).toBe(400)
  })
})

describe('ajuste de data SEM troca de plano (bug A1 + reativação acidental)', () => {
  it('atualiza SÓ plan_expires_at — não zera cota, não força status, não chama handlers', async () => {
    const { client, updates } = makeSupabase(profileFixture({ plan_status: 'canceling' }))
    mockGetAdminSupabase.mockReturnValue(client as never)

    const res = await PATCH(
      makeReq({ plan: 'starter', expiresOn: FUTURE, reason: 'cortesia por atraso no suporte' }),
      params
    )
    expect(res.status).toBe(200)
    expect(updates).toHaveLength(1)
    const payload = updates[0]
    expect(Object.keys(payload)).toEqual(['plan_expires_at'])
    // O que o bug A1 fazia e NÃO pode voltar:
    expect(payload).not.toHaveProperty('responses_used')
    expect(payload).not.toHaveProperty('responses_limit')
    expect(payload).not.toHaveProperty('response_period_start_at')
    expect(payload).not.toHaveProperty('limit_alert_sent')
    expect(payload).not.toHaveProperty('plan_status') // preserva 'canceling'
    expect(mockHandleUpgrade).not.toHaveBeenCalled()
    expect(mockHandleDowngrade).not.toHaveBeenCalled()
  })

  it('converte expiresOn para fim do dia BRT no servidor', async () => {
    const { client, updates } = makeSupabase(profileFixture())
    mockGetAdminSupabase.mockReturnValue(client as never)
    await PATCH(makeReq({ plan: 'starter', expiresOn: FUTURE, reason: 'cortesia teste' }), params)
    // 2026-09-30 23:59:59 -03:00 === 2026-10-01T02:59:59Z
    expect(updates[0].plan_expires_at).toBe(new Date('2026-09-30T23:59:59-03:00').toISOString())
  })

  it('FASE 4: sub MENSAL → ajuste SINCRONIZADO (move cobrança emitida + sub + local)', async () => {
    const { updatePaymentDueDate, updateSubscription } = await import('@/lib/asaas')
    const { client, updates } = makeSupabase(profileFixture({ asaas_subscription_id: 'sub_123', plan_cycle: 'MONTHLY' }))
    mockGetAdminSupabase.mockReturnValue(client as never)
    const res = await PATCH(
      makeReq({ plan: 'starter', expiresOn: FUTURE, reason: 'cortesia de 15 dias' }),
      params
    )
    expect(res.status).toBe(200)
    // Regra de ouro da caracterização 05/08: cobrança emitida move INDIVIDUALMENTE...
    expect(vi.mocked(updatePaymentDueDate)).toHaveBeenCalledWith('pay_pend', FUTURE)
    // ...e a sub controla só a geração FUTURA (alvo + 1 ciclo).
    expect(vi.mocked(updateSubscription)).toHaveBeenCalledTimes(1)
    expect(updates.length).toBeGreaterThan(0) // escrita local aconteceu
    // Journal durável: requested ANTES do gateway + completed no fim.
    const states = mockRecordAdminAction.mock.calls.map((c) => c[0].state)
    expect(states).toContain('requested')
    expect(states).toContain('completed')
  })

  it('FASE 4: sub ANUAL segue 409 (gateway não caracterizado)', async () => {
    const { client, updates } = makeSupabase(profileFixture({ asaas_subscription_id: 'sub_123', plan_cycle: 'YEARLY' }))
    mockGetAdminSupabase.mockReturnValue(client as never)
    const res = await PATCH(
      makeReq({ plan: 'starter', expiresOn: FUTURE, reason: 'tentativa de cortesia' }),
      params
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/anual/i)
    expect(updates).toHaveLength(0)
  })

  it('FASE 4: cobrança do período já CONFIRMADA e sem pendente → rejeita retroativo (409)', async () => {
    const { getPendingPaymentsBySubscription, hasConfirmedPaymentForSubscription } = await import('@/lib/asaas')
    vi.mocked(getPendingPaymentsBySubscription).mockResolvedValueOnce({ ok: true, payments: [] })
    vi.mocked(hasConfirmedPaymentForSubscription).mockResolvedValueOnce({ confirmed: true, ok: true })
    const { client, updates } = makeSupabase(profileFixture({ asaas_subscription_id: 'sub_123', plan_cycle: 'MONTHLY' }))
    mockGetAdminSupabase.mockReturnValue(client as never)
    const res = await PATCH(
      makeReq({ plan: 'starter', expiresOn: FUTURE, reason: 'tentativa retroativa' }),
      params
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/CONFIRMADA/i)
    expect(updates).toHaveLength(0)
  })

  it('FASE 4: cobrança moveu mas sub falhou → reconcile_required + 502 (nunca silêncio)', async () => {
    const { updateSubscription } = await import('@/lib/asaas')
    vi.mocked(updateSubscription).mockRejectedValueOnce(new Error('Asaas API error 500'))
    const { client, updates } = makeSupabase(profileFixture({ asaas_subscription_id: 'sub_123', plan_cycle: 'MONTHLY' }))
    mockGetAdminSupabase.mockReturnValue(client as never)
    const res = await PATCH(
      makeReq({ plan: 'starter', expiresOn: FUTURE, reason: 'cortesia' }),
      params
    )
    expect(res.status).toBe(502)
    const states = mockRecordAdminAction.mock.calls.map((c) => c[0].state)
    expect(states).toContain('reconcile_required')
    expect(updates).toHaveLength(0) // local NÃO escrito após falha parcial
  })

  it('rejeita remover a expiração de plano pago (grant eterno proibido)', async () => {
    const { client } = makeSupabase(profileFixture())
    mockGetAdminSupabase.mockReturnValue(client as never)
    const res = await PATCH(
      makeReq({ plan: 'starter', expiresOn: null, reason: 'tentando grant eterno' }),
      params
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/vitalícia/i)
  })
})

describe('conta vitalícia', () => {
  it('409 no servidor — nunca sucesso otimista', async () => {
    const { client, updates } = makeSupabase(profileFixture({ lifetime_access: true, plan: 'professional' }))
    mockGetAdminSupabase.mockReturnValue(client as never)
    const res = await PATCH(
      makeReq({ plan: 'free', reason: 'tentando rebaixar a vitalícia' }),
      params
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/vitalício/i)
    expect(updates).toHaveLength(0)
    expect(mockCancelSubscription).not.toHaveBeenCalled()
  })
})

describe('troca de plano', () => {
  it('grant pago exige expiração explícita', async () => {
    const { client } = makeSupabase(profileFixture({ plan: 'free', plan_expires_at: null }))
    mockGetAdminSupabase.mockReturnValue(client as never)
    const res = await PATCH(makeReq({ plan: 'plus', reason: 'cortesia de lançamento' }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/expiração/i)
  })

  it('grant pago com data: reseta cota (troca REAL de plano) e chama handleUpgrade', async () => {
    const { client, updates } = makeSupabase(profileFixture({ plan: 'free', plan_expires_at: null }))
    mockGetAdminSupabase.mockReturnValue(client as never)
    const res = await PATCH(
      makeReq({ plan: 'plus', expiresOn: FUTURE, reason: 'cortesia de lançamento' }),
      params
    )
    expect(res.status).toBe(200)
    const payload = updates[0]
    expect(payload.plan).toBe('plus')
    expect(payload.responses_limit).toBe(5000)
    expect(payload.responses_used).toBe(0)
    expect(payload.plan_status).toBe('active')
    expect(mockHandleUpgrade).toHaveBeenCalledTimes(1)
  })

  it('pago→pago com sub Asaas: 409 sem sugerir "mova para free primeiro"', async () => {
    const { client } = makeSupabase(profileFixture({ plan: 'starter', asaas_subscription_id: 'sub_123' }))
    mockGetAdminSupabase.mockReturnValue(client as never)
    const res = await PATCH(
      makeReq({ plan: 'plus', expiresOn: FUTURE, reason: 'upgrade manual indevido' }),
      params
    )
    expect(res.status).toBe(409)
    const msg = (await res.json()).error as string
    expect(msg).not.toMatch(/free primeiro/i)
    expect(msg).toMatch(/billing/i)
  })

  it('→free com sub: cancela no Asaas ANTES e segue fail-closed em falha', async () => {
    const { client, updates } = makeSupabase(profileFixture({ plan: 'plus', asaas_subscription_id: 'sub_123' }))
    mockGetAdminSupabase.mockReturnValue(client as never)
    mockCancelSubscription.mockRejectedValue(new Error('Asaas error 500'))
    const res = await PATCH(makeReq({ plan: 'free', reason: 'cliente pediu cancelamento' }), params)
    expect(res.status).toBe(502)
    expect(updates).toHaveLength(0) // nada gravado localmente
  })

  it('falha de handleDowngrade vira warning visível, não silêncio', async () => {
    const { client } = makeSupabase(profileFixture({ plan: 'plus', asaas_subscription_id: 'sub_123' }))
    mockGetAdminSupabase.mockReturnValue(client as never)
    mockCancelSubscription.mockResolvedValue({ deleted: true, id: 'sub_123' })
    mockHandleDowngrade.mockRejectedValue(new Error('pause failed'))
    const res = await PATCH(makeReq({ plan: 'free', reason: 'cliente pediu cancelamento' }), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.warnings).toHaveLength(1)
    expect(body.warnings[0]).toMatch(/pausa/i)
  })

  it('toda mutação bem-sucedida registra no journal com o motivo', async () => {
    const { client } = makeSupabase(profileFixture())
    mockGetAdminSupabase.mockReturnValue(client as never)
    await PATCH(makeReq({ plan: 'starter', expiresOn: FUTURE, reason: 'cortesia por atraso' }), params)
    expect(mockRecordAdminAction).toHaveBeenCalledTimes(1)
    const entry = mockRecordAdminAction.mock.calls[0][0]
    expect(entry.action).toBe('expiry_adjust')
    expect(entry.reason).toBe('cortesia por atraso')
    expect(entry.actorEmail).toBe('admin@eidos.com')
  })
})

describe('confirmação ao cliente (checkbox Avisar)', () => {
  it('ajuste de data notifica acesso_atualizado por padrão e registra no journal', async () => {
    const { notifyAcessoAtualizado } = await import('@/lib/whatsapp-confirmations')
    const { client } = makeSupabase(profileFixture())
    mockGetAdminSupabase.mockReturnValue(client as never)
    await PATCH(makeReq({ plan: 'starter', expiresOn: FUTURE, reason: 'cortesia +15 dias' }), params)
    expect(vi.mocked(notifyAcessoAtualizado)).toHaveBeenCalledTimes(1)
    const entry = mockRecordAdminAction.mock.calls[0][0]
    expect((entry.after as Record<string, unknown>).customer_notified).toBe(true)
  })

  it('notifyCustomer=false silencia e registra o silêncio', async () => {
    const { notifyAcessoAtualizado } = await import('@/lib/whatsapp-confirmations')
    const { client } = makeSupabase(profileFixture())
    mockGetAdminSupabase.mockReturnValue(client as never)
    await PATCH(makeReq({ plan: 'starter', expiresOn: FUTURE, reason: 'teste interno', notifyCustomer: false }), params)
    expect(vi.mocked(notifyAcessoAtualizado)).not.toHaveBeenCalled()
    const entry = mockRecordAdminAction.mock.calls[0][0]
    expect((entry.after as Record<string, unknown>).customer_notified).toBe(false)
  })

  it('grant pago NOVO (free→pago) notifica plano_ATIVADO + e-mail espelho (mapa 30/07 + P1)', async () => {
    const { notifyPlanoAtivado } = await import('@/lib/whatsapp-confirmations')
    const { sendPlanActivated } = await import('@/lib/resend')
    const { client } = makeSupabase(profileFixture({ plan: 'free', plan_expires_at: null }))
    mockGetAdminSupabase.mockReturnValue(client as never)
    await PATCH(makeReq({ plan: 'plus', expiresOn: FUTURE, reason: 'cortesia de lançamento' }), params)
    expect(vi.mocked(notifyPlanoAtivado)).toHaveBeenCalledTimes(1)
    const opts = vi.mocked(notifyPlanoAtivado).mock.calls[0][1] as { chargeInfo?: string }
    expect(opts.chargeInfo).toMatch(/cortesia/i)
    expect(vi.mocked(sendPlanActivated)).toHaveBeenCalledTimes(1)
  })

  it('troca de GRANT (pago→pago sem sub) notifica plano_alterado + e-mail espelho', async () => {
    const { notifyPlanoAlterado } = await import('@/lib/whatsapp-confirmations')
    const { sendPlanChanged } = await import('@/lib/resend')
    const { client } = makeSupabase(profileFixture({ plan: 'starter', asaas_subscription_id: null }))
    mockGetAdminSupabase.mockReturnValue(client as never)
    await PATCH(makeReq({ plan: 'plus', expiresOn: FUTURE, reason: 'upgrade de cortesia' }), params)
    expect(vi.mocked(notifyPlanoAlterado)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendPlanChanged)).toHaveBeenCalledTimes(1)
  })

  it('mover para free notifica assinatura_cancelada com acesso até hoje', async () => {
    const { notifyAssinaturaCancelada } = await import('@/lib/whatsapp-confirmations')
    const { client } = makeSupabase(profileFixture({ plan: 'plus', asaas_subscription_id: 'sub_123' }))
    mockGetAdminSupabase.mockReturnValue(client as never)
    mockCancelSubscription.mockResolvedValue({ deleted: true, id: 'sub_123' })
    await PATCH(makeReq({ plan: 'free', reason: 'encerramento a pedido' }), params)
    expect(vi.mocked(notifyAssinaturaCancelada)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(notifyAssinaturaCancelada).mock.calls[0][1].accessUntil).toBe('hoje')
  })
})
