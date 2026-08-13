/**
 * Cron expire-plans — a PRIMEIRA suíte deste arquivo (varredura 10-11/08/2026).
 *
 * Era o único caminho de dinheiro do projeto SEM teste nenhum, e é justamente o que decide quem
 * PERDE acesso. O defeito central que esta suíte tranca: a escrita sem guarda de corrida.
 *
 * O cron tira uma foto dos expirados e depois passa MINUTOS consultando o Asaas linha a linha
 * (até 500 perfis). Se o cliente PAGA nesse meio-tempo, o webhook ativa o plano — e a reversão,
 * com a foto velha na mão, escrevia `free` por cima da ativação: cliente pagou e foi rebaixado
 * segundos depois, sem aviso. A correção é a escrita condicional (CAS): os `.eq('plan')` e
 * `.eq('plan_expires_at')` extras fazem qualquer pagamento concorrente mudar o alvo e a escrita
 * errar de propósito (0 linhas) — com CURA dos formulários pausados na sequência.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      async json() { return data },
    }),
  },
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ log: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }))
vi.mock('@/lib/asaas', () => ({
  getSubscription: vi.fn(),
  hasOverduePaymentForSubscription: vi.fn(),
}))
const planMocks = vi.hoisted(() => ({
  handleDowngrade: vi.fn(async () => ({ pausedCount: 0 })),
  recomputeActiveForms: vi.fn(async () => ({ pausedCount: 0 })),
}))
vi.mock('@/lib/plan-limits', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/plan-limits')>()
  return { ...real, ...planMocks }
})

import { GET } from './route'
import { createClient } from '@supabase/supabase-js'
import { getSubscription, hasOverduePaymentForSubscription } from '@/lib/asaas'

const mockCreate = vi.mocked(createClient)
const mockGetSub = vi.mocked(getSubscription)
const mockOverdue = vi.mocked(hasOverduePaymentForSubscription)

type DbCall = { table: string; method: string; args: unknown[] }

/** Banco falso gravador: cada `.from(tabela)` consome o próximo resultado da fila da tabela. */
function makeDb(results: Record<string, unknown[]>) {
  const calls: DbCall[] = []
  function chain(table: string, result: unknown) {
    const proxy: Record<string, unknown> = new Proxy({}, {
      get(_t, prop: string | symbol) {
        if (prop === 'then') {
          return (res: (v: unknown) => void, rej: (e: unknown) => void) =>
            Promise.resolve(result).then(res, rej)
        }
        return (...args: unknown[]) => {
          calls.push({ table, method: String(prop), args })
          if (prop === 'single') return Promise.resolve(result)
          return proxy
        }
      },
    }) as never
    return proxy
  }
  const from = vi.fn((table: string) => {
    const q = results[table] ?? [{ data: null, error: null }]
    const result = q.length > 1 ? q.shift() : q[0]
    return chain(table, result)
  })
  return { db: { from }, calls }
}

const REQ = { headers: { get: (k: string) => (k === 'authorization' ? 'Bearer segredo-cron' : null) } } as never
const EXPIRADO = {
  id: 'u1', plan: 'plus', plan_status: 'active', plan_cycle: 'MONTHLY',
  plan_expires_at: '2026-08-01T03:00:00+00:00', asaas_subscription_id: 'sub_1',
}

/** Os `.eq` da escrita — é o CAS. Verificar o ARGUMENTO, não só o efeito (lição do reconcile). */
function casDaEscrita(calls: DbCall[]) {
  const idx = calls.findIndex((c) => c.table === 'profiles' && c.method === 'update')
  const eqs = calls.slice(idx).filter((c) => c.method === 'eq').map((c) => c.args[0])
  return { payload: calls[idx]?.args[0] as Record<string, unknown>, eqs }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'segredo-cron'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-teste'
})

describe('expire-plans — autenticação e reversão básica', () => {
  it('sem o segredo do cron: 401, nenhuma consulta', async () => {
    const { db, calls } = makeDb({})
    mockCreate.mockReturnValue(db as never)
    const res = await GET({ headers: { get: () => null } } as never)
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('sem assinatura vinculada → pausa os formulários E marca free/expired', async () => {
    const { db, calls } = makeDb({
      profiles: [
        { data: [{ ...EXPIRADO, asaas_subscription_id: null }], error: null },
        { data: [{ id: 'u1' }], error: null }, // update da reversão: 1 linha
      ],
    })
    mockCreate.mockReturnValue(db as never)

    const body = await (await GET(REQ)).json() as { reverted: number }

    expect(planMocks.handleDowngrade).toHaveBeenCalledWith('u1', 'chave-teste')
    const { payload } = casDaEscrita(calls)
    expect(payload.plan).toBe('free')
    expect(payload.plan_status).toBe('expired')
    expect(body.reverted).toBe(1)
  })

  it('quem CANCELOU e expirou termina como cancelled, não expired (métrica de churn)', async () => {
    const { db, calls } = makeDb({
      profiles: [
        { data: [{ ...EXPIRADO, plan_status: 'canceling', asaas_subscription_id: null }], error: null },
        { data: [{ id: 'u1' }], error: null },
      ],
    })
    mockCreate.mockReturnValue(db as never)
    await GET(REQ)
    expect(casDaEscrita(calls).payload.plan_status).toBe('cancelled')
  })
})

describe('expire-plans — o CAS que impede rebaixar quem acabou de pagar', () => {
  it('🛡️ a REVERSÃO escreve condicionada ao estado lido (plan + plan_expires_at)', async () => {
    const { db, calls } = makeDb({
      profiles: [
        { data: [{ ...EXPIRADO, asaas_subscription_id: null }], error: null },
        { data: [{ id: 'u1' }], error: null },
      ],
    })
    mockCreate.mockReturnValue(db as never)
    await GET(REQ)
    const { eqs } = casDaEscrita(calls)
    expect(eqs).toContain('plan')
    expect(eqs).toContain('plan_expires_at')
  })

  it('🛡️ reversão PERDE a corrida (cliente pagou durante o cron) → não conta, e CURA os formulários', async () => {
    // O caso que dava rebaixamento de pagante: handleDowngrade já pausou os formulários, a
    // escrita erra o alvo (0 linhas) porque o webhook ativou o plano no meio. A cura relê o
    // plano VERDADEIRO e recompõe o que fica no ar.
    const { db } = makeDb({
      profiles: [
        { data: [{ ...EXPIRADO, asaas_subscription_id: null }], error: null },
        { data: [], error: null },              // update: 0 linhas — perdeu a corrida
        { data: { plan: 'plus' }, error: null },// releitura da cura
      ],
    })
    mockCreate.mockReturnValue(db as never)

    const body = await (await GET(REQ)).json() as { reverted: number; skipped: number }

    expect(body.reverted).toBe(0)
    expect(body.skipped).toBe(1)
    expect(planMocks.recomputeActiveForms).toHaveBeenCalledWith('chave-teste', 'u1', 'plus')
  })

  it('🛡️ a EXTENSÃO também é condicionada — e perder a corrida não conta como estendido', async () => {
    mockGetSub.mockResolvedValue({ status: 'ACTIVE', nextDueDate: '2026-09-10' } as never)
    mockOverdue.mockResolvedValue({ overdue: false, oldestDueDate: null, ok: true })
    const { db, calls } = makeDb({
      profiles: [
        { data: [EXPIRADO], error: null },
        { data: [], error: null }, // extensão: 0 linhas
      ],
    })
    mockCreate.mockReturnValue(db as never)

    const body = await (await GET(REQ)).json() as { extended: number; skipped: number }

    const { eqs } = casDaEscrita(calls)
    expect(eqs).toContain('plan')
    expect(eqs).toContain('plan_expires_at')
    expect(body.extended).toBe(0)
    expect(body.skipped).toBe(1)
  })
})

describe('expire-plans — prova de pagamento e carência (comportamento existente, agora trancado)', () => {
  it('sub ACTIVE com pagamento em dia → ESTENDE, não derruba o pagante', async () => {
    mockGetSub.mockResolvedValue({ status: 'ACTIVE', nextDueDate: '2026-09-10' } as never)
    mockOverdue.mockResolvedValue({ overdue: false, oldestDueDate: null, ok: true })
    const { db, calls } = makeDb({
      profiles: [
        { data: [EXPIRADO], error: null },
        { data: [{ id: 'u1' }], error: null },
      ],
    })
    mockCreate.mockReturnValue(db as never)

    const body = await (await GET(REQ)).json() as { extended: number; reverted: number }

    expect(body.extended).toBe(1)
    expect(body.reverted).toBe(0)
    expect(casDaEscrita(calls).payload).toHaveProperty('plan_expires_at')
    expect(planMocks.handleDowngrade).not.toHaveBeenCalled()
  })

  it('cobrança VENCIDA dentro da carência de 5 dias → não estende, não derruba', async () => {
    mockGetSub.mockResolvedValue({ status: 'ACTIVE', nextDueDate: '2026-09-10' } as never)
    const ontem = new Date(Date.now() - 1 * 86_400_000).toISOString().slice(0, 10)
    mockOverdue.mockResolvedValue({ overdue: true, oldestDueDate: ontem, ok: true })
    const { db, calls } = makeDb({ profiles: [{ data: [EXPIRADO], error: null }] })
    mockCreate.mockReturnValue(db as never)

    const body = await (await GET(REQ)).json() as { skipped: number; reverted: number; extended: number }

    expect(body.skipped).toBe(1)
    expect(body.reverted).toBe(0)
    expect(body.extended).toBe(0)
    expect(calls.some((c) => c.method === 'update')).toBe(false)
  })

  it('cobrança VENCIDA além da carência → rebaixa (acesso pago sem receita acaba)', async () => {
    mockGetSub.mockResolvedValue({ status: 'ACTIVE', nextDueDate: '2026-09-10' } as never)
    const dezDias = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10)
    mockOverdue.mockResolvedValue({ overdue: true, oldestDueDate: dezDias, ok: true })
    const { db, calls } = makeDb({
      profiles: [
        { data: [EXPIRADO], error: null },
        { data: [{ id: 'u1' }], error: null },
      ],
    })
    mockCreate.mockReturnValue(db as never)

    const body = await (await GET(REQ)).json() as { reverted: number }

    expect(body.reverted).toBe(1)
    expect(planMocks.handleDowngrade).toHaveBeenCalled()
    expect(casDaEscrita(calls).payload).toMatchObject({
      asaas_subscription_id: null,
      overdue_subscription_id: 'sub_1',
      previous_plan: 'plus',
      previous_plan_cycle: 'MONTHLY',
    })
    expect(casDaEscrita(calls).payload.downgraded_at).toEqual(expect.any(String))
  })

  it('erro TRANSITÓRIO do Asaas → adia a decisão, nunca derruba pagante por falha de rede', async () => {
    mockGetSub.mockRejectedValue(new Error('ETIMEDOUT'))
    const { db, calls } = makeDb({ profiles: [{ data: [EXPIRADO], error: null }] })
    mockCreate.mockReturnValue(db as never)

    const body = await (await GET(REQ)).json() as { skipped: number; reverted: number }

    expect(body.skipped).toBe(1)
    expect(body.reverted).toBe(0)
    expect(calls.some((c) => c.method === 'update')).toBe(false)
  })

  it('downgrade falhou (formulários NÃO pausados) → não marca free; o próximo tick retenta', async () => {
    planMocks.handleDowngrade.mockRejectedValueOnce(new Error('pause falhou'))
    const { db, calls } = makeDb({
      profiles: [{ data: [{ ...EXPIRADO, asaas_subscription_id: null }], error: null }],
    })
    mockCreate.mockReturnValue(db as never)

    const body = await (await GET(REQ)).json() as { reverted: number; skipped: number }

    expect(body.reverted).toBe(0)
    expect(body.skipped).toBe(1)
    expect(calls.some((c) => c.method === 'update')).toBe(false)
  })
})
