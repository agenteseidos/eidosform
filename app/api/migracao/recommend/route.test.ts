/**
 * migracao/recommend — a guarda anti-mistura tem de valer no caso COMUM (varredura 11/08/2026).
 *
 * Achado da fronteira EidosForm↔Elen, ALTA nos dois passes da auditoria: a checagem de
 * identidade vivia inteira dentro de `if (doTelefone.length > 1)` — não rodava com submissão
 * ÚNICA, que é o caso de quase toda conversa. Quem informasse no chat o e-mail de um cliente
 * pagante recebia o cruzamento do USO da própria submissão com a CONTA do outro: plano anual
 * vigente → "manter_plano" → a Elen promete acionar a equipe → trabalho pago entregue a quem
 * não pagou.
 *
 * Primeira suíte desta rota.
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
vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimitAsync: vi.fn(async () => ({ allowed: true, resetIn: 0 })) }))
vi.mock('@/lib/resend', () => ({ sendBillingOpsAlert: vi.fn(async () => ({})) }))
// Config mockada: ids curtos legíveis no lugar dos UUIDs do form real; contrato sempre ok —
// o contrato tem teste próprio, aqui interessa a LÓGICA de identidade.
vi.mock('@/lib/migracao/config', () => ({
  MIGRACAO: {
    formId: 'form-mig', slug: 'migracao', eligibilityDays: 90, beneficioDias: 20,
    q: {
      nome: 'q_nome', telefone: 'q_tel', jaConta: 'q_jaconta',
      emailSim: 'q_email_s', emailNao: 'q_email_n',
      respostasMes: 'q_rm', recursos: 'q_rec', qtdForms: 'q_qf', maiorForm: 'q_mf',
    },
  },
  validarContratoForm: () => ({ ok: true, erros: [] }),
}))

import { POST } from './route'
import { createServerClient } from '@supabase/ssr'

const mockSb = vi.mocked(createServerClient)

function makeDb(results: Record<string, unknown[]>) {
  const calls: { table: string; method: string; args: unknown[] }[] = []
  function chain(table: string, result: unknown) {
    const proxy: Record<string, unknown> = new Proxy({}, {
      get(_t, prop: string | symbol) {
        if (prop === 'then') {
          return (res: (v: unknown) => void, rej: (e: unknown) => void) =>
            Promise.resolve(result).then(res, rej)
        }
        return (...args: unknown[]) => {
          calls.push({ table, method: String(prop), args })
          if (prop === 'single' || prop === 'maybeSingle') return Promise.resolve(result)
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

const FORM_ROW = { data: { id: 'form-mig', slug: 'migracao', questions: [] }, error: null }
const AGORA = new Date().toISOString()

/** submissão do form: telefone + e-mail + respostas de uso. */
function submissao(tel: string, email: string, extra: Record<string, unknown> = {}) {
  return {
    id: `r-${Math.random().toString(36).slice(2, 8)}`,
    submitted_at: AGORA,
    answers: {
      q_nome: 'Fulana Teste', q_tel: tel, q_jaconta: 'sim',
      q_email_s: email, q_rm: 'até 100', q_qf: '1', q_mf: '10', q_rec: [],
      ...extra,
    },
  }
}

function makeReq(body: Record<string, unknown>) {
  return {
    headers: { get: (k: string) => (k === 'authorization' ? 'Bearer segredo-interno' : null) },
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_API_SECRET = 'segredo-interno'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave'
})

describe('migracao/recommend — guarda anti-mistura de identidades', () => {
  it('🛡️ submissão ÚNICA com e-mail DIVERGENTE do chat → requer_analise, sem tocar em profiles', async () => {
    // O caso comum que ficava sem guarda: uma submissão, e-mail do form ≠ e-mail dito no chat.
    const { db, calls } = makeDb({
      forms: [FORM_ROW],
      responses: [{ data: [submissao('83999110173', 'dona-do-form@x.com')], error: null }],
    })
    mockSb.mockReturnValue(db as never)

    const res = await POST(makeReq({ phone: '83999110173', email: 'cliente-pagante@y.com' }))
    const body = await res.json() as { motivo?: string; flags?: string[] }

    expect(body.motivo).toBe('requer_analise')
    expect(body.flags).toContain('identidade_divergente')
    // A prova de que NÃO cruzou: a conta do e-mail do chat nunca foi consultada.
    expect(calls.some((c) => c.table === 'profiles')).toBe(false)
  })

  it('e-mails iguais (form = chat) → segue o fluxo normal e consulta a conta', async () => {
    const { db, calls } = makeDb({
      forms: [FORM_ROW],
      responses: [{ data: [submissao('83999110173', 'mesma@x.com')], error: null }],
      profiles: [{ data: null, error: null }], // conta não encontrada — ok
    })
    mockSb.mockReturnValue(db as never)

    const res = await POST(makeReq({ phone: '83999110173', email: 'mesma@x.com' }))
    const body = await res.json() as { ok: boolean; flags?: string[] }

    // O que a GUARDA garante: identidade igual não é divergência, e a conta É consultada.
    // (motivo pode ser outro por regra de negócio adiante — ex.: "diz ter conta e não achei".)
    expect(body.ok).toBe(true)
    expect(body.flags ?? []).not.toContain('identidade_divergente')
    expect(calls.some((c) => c.table === 'profiles')).toBe(true)
  })

  it('submissão SEM e-mail nenhum → sem evidência de divergência, fluxo normal', async () => {
    const { db } = makeDb({
      forms: [FORM_ROW],
      responses: [{ data: [submissao('83999110173', '')], error: null }],
      profiles: [{ data: null, error: null }],
    })
    mockSb.mockReturnValue(db as never)

    const res = await POST(makeReq({ phone: '83999110173', email: 'qualquer@y.com' }))
    const body = await res.json() as { ok: boolean; flags?: string[] }

    expect(body.ok).toBe(true)
    expect(body.flags ?? []).not.toContain('identidade_divergente')
  })

  it('VÁRIAS submissões, todas do MESMO e-mail ≠ chat → também requer_analise (a outra metade do buraco)', async () => {
    const { db, calls } = makeDb({
      forms: [FORM_ROW],
      responses: [{
        data: [
          submissao('83999110173', 'dona-do-form@x.com'),
          submissao('83999110173', 'dona-do-form@x.com'),
        ], error: null,
      }],
    })
    mockSb.mockReturnValue(db as never)

    const res = await POST(makeReq({ phone: '83999110173', email: 'cliente-pagante@y.com' }))
    const body = await res.json() as { motivo?: string }

    expect(body.motivo).toBe('requer_analise')
    expect(calls.some((c) => c.table === 'profiles')).toBe(false)
  })

  it('sem o segredo interno → 401', async () => {
    const req = { headers: { get: () => null }, json: async () => ({}) } as unknown as Parameters<typeof POST>[0]
    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})
